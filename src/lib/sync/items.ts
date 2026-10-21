import { and, eq, inArray, isNull, lt, sql } from "drizzle-orm";
import { db } from "@/db";
import { items, type shops } from "@/db/schema";
import { mapLimit, wooGetAll, wooGetOne } from "@/lib/woo";

type Shop = typeof shops.$inferSelect;
type ItemRow = typeof items.$inferInsert;

interface WooProduct {
  id: number;
  name: string;
  sku: string;
  type: string;
  status: string;
  price: string;
  regular_price: string;
  images: { src: string }[];
  manage_stock: boolean;
  stock_quantity: number | null;
}

interface WooVariation {
  id: number;
  sku: string;
  status: string;
  price: string;
  regular_price: string;
  image: { src: string } | null;
  manage_stock: boolean | "parent";
  stock_quantity: number | null;
  attributes: { name: string; option: string }[];
}

// Grouped and external products are never sold (or stocked) themselves.
const UNSOLD_TYPES = new Set(["grouped", "external"]);

// Only what is used, to keep responses small; variations are read a few at a time.
const PRODUCT_FIELDS = "id,name,sku,type,status,price,regular_price,images,manage_stock,stock_quantity";
const VARIATION_FIELDS = "id,sku,status,price,regular_price,image,manage_stock,stock_quantity,attributes";
const CONCURRENCY = 4;

const excluded = (column: string) => sql.raw(`excluded.${column}`);

/** Items that are no longer in the shop's catalogue (trashed or deleted) hold no stock. */
const isGone = (status: string) => status === "trash" || status === "deleted";

/** The shop's cost estimate for a listed price (price includes VAT), or null when not configured. */
function estimateCost(shop: Shop, price: string | null): string | null {
  const value = price == null ? NaN : Number(price);
  if (shop.defaultCostPct == null || !(value > 0)) return null;
  return (((value / (1 + Number(shop.vatRate) / 100)) * Number(shop.defaultCostPct)) / 100).toFixed(4);
}

function variationRow(shop: Shop, p: WooProduct, v: WooVariation, status: string): ItemRow {
  const managesStock = !isGone(status) && (v.manage_stock === "parent" ? p.manage_stock : v.manage_stock);
  const price = v.price || p.price || null; // a variation without its own price shows the parent's
  const regularPrice = v.regular_price || p.regular_price || null;
  return {
    shopId: shop.id,
    wooProductId: p.id,
    wooVariationId: v.id,
    productName: p.name,
    variationLabel: v.attributes.map((a) => a.option).join(" / ") || null,
    sku: v.sku || null,
    status,
    price,
    regularPrice,
    imageUrl: v.image?.src ?? p.images?.[0]?.src ?? null,
    // The estimate follows the list price, so a sale price does not lower the cost.
    productSku: p.sku || null,
    manualUnitCost: estimateCost(shop, regularPrice ?? price),
    costSource: "estimate",
    managesStock,
    stockQty: managesStock && v.stock_quantity != null ? String(v.stock_quantity) : null,
  };
}

function productRow(shop: Shop, p: WooProduct, status: string): ItemRow {
  const managesStock = !isGone(status) && p.manage_stock;
  const price = p.price || null;
  const regularPrice = p.regular_price || null;
  return {
    shopId: shop.id,
    wooProductId: p.id,
    wooVariationId: 0,
    productName: p.name,
    sku: p.sku || null,
    status,
    price,
    regularPrice,
    imageUrl: p.images?.[0]?.src ?? null,
    productSku: p.sku || null,
    manualUnitCost: estimateCost(shop, regularPrice ?? price),
    costSource: "estimate",
    managesStock,
    stockQty: managesStock && p.stock_quantity != null ? String(p.stock_quantity) : null,
  };
}

/** Insert new items; existing ones are refreshed but their manual cost is never overwritten. */
async function upsertItems(rows: ItemRow[]): Promise<void> {
  for (let i = 0; i < rows.length; i += 200) {
    await db
      .insert(items)
      .values(rows.slice(i, i + 200))
      .onConflictDoUpdate({
        target: [items.shopId, items.wooProductId, items.wooVariationId],
        // manualUnitCost is ours, not WooCommerce's: never overwrite it.
        set: {
          productName: excluded("product_name"),
          variationLabel: excluded("variation_label"),
          sku: excluded("sku"),
          productSku: excluded("product_sku"),
          status: excluded("status"),
          price: excluded("price"),
          regularPrice: excluded("regular_price"),
          // An estimated cost follows the list price; a cost entered by hand is left alone.
          manualUnitCost: sql`CASE WHEN ${items.costSource} = 'estimate' THEN coalesce(excluded.manual_unit_cost, ${items.manualUnitCost}) ELSE ${items.manualUnitCost} END`,
          imageUrl: excluded("image_url"),
          managesStock: excluded("manages_stock"),
          stockQty: excluded("stock_qty"),
          syncedAt: new Date(),
        },
      });
  }
}

// Overlap with the previous run so a product modified mid-sync is never missed.
const OVERLAP_MS = 10 * 60 * 1000;

function rowsOf(shop: Shop, products: WooProduct[], variationsOf: Map<number, WooVariation[]>): ItemRow[] {
  const rows: ItemRow[] = [];
  for (const p of products) {
    if (UNSOLD_TYPES.has(p.type)) continue;
    if (p.type === "variable") {
      for (const v of variationsOf.get(p.id) ?? []) rows.push(variationRow(shop, p, v, v.status || p.status));
    } else {
      rows.push(productRow(shop, p, p.status));
    }
  }
  return rows;
}

async function readVariations(shop: Shop, products: WooProduct[]): Promise<Map<number, WooVariation[]>> {
  const variationsOf = new Map<number, WooVariation[]>();
  await mapLimit(
    products.filter((p) => p.type === "variable"),
    CONCURRENCY,
    async (p) => {
      variationsOf.set(p.id, await wooGetAll<WooVariation>(shop, `products/${p.id}/variations`, { _fields: VARIATION_FIELDS }));
    },
  );
  return variationsOf;
}

/**
 * Upserts one `items` row per simple product / variation. Returns how many were synced.
 *
 * Unless `full`, only what changed since the last completed sync is read: a sale, a restock or
 * a price change all update the product's modified date in WooCommerce, and the variations
 * (the slow part, one request per variable product) are read only for the products that
 * changed. A full run re-reads the whole catalogue, which also finds products deleted for good.
 */
export async function syncItems(shop: Shop, full = false): Promise<number> {
  const runStart = new Date();
  if (full || !shop.lastSyncedAt) {
    const products = await wooGetAll<WooProduct>(shop, "products", { _fields: PRODUCT_FIELDS });
    const rows = rowsOf(shop, products, await readVariations(shop, products));
    await upsertItems(rows);
    await refreshVanishedItems(shop, runStart);
    await alignLegacyItems(shop);
    return rows.length;
  }

  const since = { modified_after: new Date(shop.lastSyncedAt.getTime() - OVERLAP_MS).toISOString(), dates_are_gmt: true };
  const changed = await wooGetAll<WooProduct>(shop, "products", { _fields: PRODUCT_FIELDS, ...since });
  const rows = rowsOf(shop, changed, await readVariations(shop, changed));
  await upsertItems(rows);

  // Products moved to the trash are not in the list above: record them without reading their variations.
  const trashed = await wooGetAll<{ id: number }>(shop, "products", { _fields: "id", status: "trash", ...since });
  if (trashed.length) {
    await db
      .update(items)
      .set({ status: "trash", managesStock: false, stockQty: null, syncedAt: new Date() })
      .where(and(eq(items.shopId, shop.id), inArray(items.wooProductId, trashed.map((t) => t.id))));
  }

  // A variation removed from a product that changed is no longer in its list: find out what became of it.
  await refreshVanishedItems(shop, runStart, changed.map((p) => p.id));
  await alignLegacyItems(shop);
  return rows.length;
}

/**
 * Items that were in the catalogue before but are not in this sync's list were trashed or
 * deleted in the shop: look each one up and record what happened, instead of leaving it
 * looking published. Usually there are none.
 */
async function refreshVanishedItems(shop: Shop, runStart: Date, onlyProducts?: number[]): Promise<void> {
  if (onlyProducts && !onlyProducts.length) return;
  const vanished = await db
    .select()
    .from(items)
    .where(
      and(
        eq(items.shopId, shop.id),
        lt(items.syncedAt, runStart),
        onlyProducts ? inArray(items.wooProductId, onlyProducts) : undefined,
      ),
    );
  const live = vanished.filter((i) => !isGone(i.status));
  await mapLimit(live, CONCURRENCY, async (item) => {
    const prod = await wooGetOne<WooProduct>(shop, `products/${item.wooProductId}`, PRODUCT_FIELDS);
    let status = prod ? prod.status : "deleted";
    // A product that was simple and became variable no longer sells as itself, only through its variations.
    if (prod && item.wooVariationId === 0 && prod.type === "variable") status = "deleted";
    if (prod && item.wooVariationId > 0) {
      const v = await wooGetOne<WooVariation>(shop, `products/${item.wooProductId}/variations/${item.wooVariationId}`, VARIATION_FIELDS);
      status = !v ? "deleted" : prod.status === "trash" ? "trash" : v.status;
    }
    await db
      .update(items)
      .set({ status, ...(isGone(status) ? { managesStock: false, stockQty: null } : {}), syncedAt: new Date() })
      .where(eq(items.id, item.id));
  });
}

/**
 * Brings into the catalogue the products and variations that order lines refer to but that the
 * product list does not return: trashed ones are recorded with status "trash", ones that no longer
 * exist at all with status "deleted" (named after the order line). This keeps every sold line
 * linked to an item, so nothing breaks the relationship. Returns how many items were added.
 */
export async function syncMissingItems(shop: Shop): Promise<number> {
  const found = await db.execute(sql`
    SELECT woo_product_id AS p, woo_variation_id AS v, max(name) AS name
    FROM order_lines
    WHERE shop_id = ${shop.id} AND item_id IS NULL AND woo_product_id > 0
    GROUP BY 1, 2`);
  const missing = (found.rows as { p: string; v: string | null; name: string | null }[]).map((r) => ({
    p: Number(r.p),
    v: Number(r.v ?? 0),
    name: r.name,
  }));
  if (!missing.length) return 0;

  const rows: ItemRow[] = [];
  const deleted = (p: number, v: number, name: string | null, productName?: string): ItemRow => ({
    shopId: shop.id,
    wooProductId: p,
    wooVariationId: v,
    productName: productName ?? name ?? `#${p}`,
    variationLabel: productName && name ? name : null,
    status: "deleted",
    managesStock: false,
  });

  await mapLimit(missing, CONCURRENCY, async ({ p, v, name }) => {
    const prod = await wooGetOne<WooProduct>(shop, `products/${p}`, PRODUCT_FIELDS);
    if (!prod) return void rows.push(deleted(p, v, name));
    if (v === 0) return void rows.push(prod.type === "variable" ? deleted(p, v, name) : productRow(shop, prod, prod.status));

    const variation = await wooGetOne<WooVariation>(shop, `products/${p}/variations/${v}`, VARIATION_FIELDS);
    if (!variation) return void rows.push(deleted(p, v, null, prod.name));
    rows.push(variationRow(shop, prod, variation, prod.status === "trash" ? "trash" : variation.status));
  });

  await upsertItems(rows);
  await alignLegacyItems(shop);
  return rows.length;
}

/**
 * The row of a product that used to be simple and is now variable ("no variant", status deleted) keeps
 * the old sales but has no price of its own any more: it takes its variations' list price, so its
 * cost estimate agrees with theirs instead of following a sale price. Returns how many rows changed.
 */
export async function alignLegacyItems(shop: Shop): Promise<number> {
  const factor = shop.defaultCostPct == null ? null : Number(shop.defaultCostPct) / 100 / (1 + Number(shop.vatRate) / 100);
  const res = await db.execute(sql`
    UPDATE items l SET
      regular_price = s.rp,
      manual_unit_cost = CASE WHEN l.cost_source = 'estimate' AND ${factor}::numeric IS NOT NULL
        THEN round(s.rp * ${factor}::numeric, 4) ELSE l.manual_unit_cost END
    FROM (
      SELECT woo_product_id, max(regular_price) AS rp FROM items
      WHERE shop_id = ${shop.id} AND woo_variation_id > 0 AND regular_price IS NOT NULL GROUP BY 1
    ) s
    WHERE l.shop_id = ${shop.id} AND l.woo_variation_id = 0 AND l.status = 'deleted'
      AND l.woo_product_id = s.woo_product_id AND l.regular_price IS DISTINCT FROM s.rp`);
  return res.rowCount ?? 0;
}

/**
 * Photos only, without touching anything else: the product list (photos only) fills every item
 * that has no photo yet with its product's photo, then each variable product's variations are
 * read (photo only, a few at a time) so a variation gets its own colour's photo.
 * Returns how many items were updated.
 */
export async function syncItemImages(shop: Shop): Promise<number> {
  const products = await wooGetAll<{ id: number; type: string; sku: string; images: { src: string }[] }>(shop, "products", {
    _fields: "id,type,sku,images",
  });
  let updated = 0;
  for (const p of products) {
    if (p.sku) await db.update(items).set({ productSku: p.sku }).where(and(eq(items.shopId, shop.id), eq(items.wooProductId, p.id)));
    const src = p.images?.[0]?.src;
    if (!src) continue;
    const res = await db
      .update(items)
      .set({ imageUrl: src })
      .where(and(eq(items.shopId, shop.id), eq(items.wooProductId, p.id), isNull(items.imageUrl)));
    updated += res.rowCount ?? 0;
  }

  await mapLimit(
    products.filter((p) => p.type === "variable"),
    CONCURRENCY,
    async (p) => {
      const variations = await wooGetAll<{ id: number; image: { src: string } | null }>(shop, `products/${p.id}/variations`, {
        _fields: "id,image",
      });
      for (const v of variations) {
        if (!v.image?.src) continue;
        const res = await db
          .update(items)
          .set({ imageUrl: v.image.src })
          .where(and(eq(items.shopId, shop.id), eq(items.wooProductId, p.id), eq(items.wooVariationId, v.id)));
        updated += res.rowCount ?? 0;
      }
    },
  );
  return updated;
}
