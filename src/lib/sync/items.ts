import { and, eq, isNull, lt, sql } from "drizzle-orm";
import { db } from "@/db";
import { items, productCosts, type shops } from "@/db/schema";
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

/** Product-level costs (set once per product): variations inherit them, even new ones. */
async function loadProductCosts(shop: Shop): Promise<Map<number, string>> {
  const rows = await db.select().from(productCosts).where(eq(productCosts.shopId, shop.id));
  return new Map(rows.map((r) => [r.wooProductId, r.unitCost]));
}

type Inherited = Map<number, string>;

function variationRow(shop: Shop, p: WooProduct, v: WooVariation, status: string, inherited: Inherited): ItemRow {
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
    // A cost set for the whole product wins over the estimate.
    manualUnitCost: inherited.get(p.id) ?? estimateCost(shop, regularPrice ?? price),
    costSource: inherited.has(p.id) ? "manual" : "estimate",
    managesStock,
    stockQty: managesStock && v.stock_quantity != null ? String(v.stock_quantity) : null,
  };
}

function productRow(shop: Shop, p: WooProduct, status: string, inherited: Inherited): ItemRow {
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
    manualUnitCost: inherited.get(p.id) ?? estimateCost(shop, regularPrice ?? price),
    costSource: inherited.has(p.id) ? "manual" : "estimate",
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

/** Upserts one `items` row per simple product / variation. Returns how many were synced. */
export async function syncItems(shop: Shop): Promise<number> {
  const runStart = new Date();
  const inherited = await loadProductCosts(shop);
  const products = await wooGetAll<WooProduct>(shop, "products", { _fields: PRODUCT_FIELDS });
  const rows: ItemRow[] = [];

  const variationsOf = new Map<number, WooVariation[]>();
  await mapLimit(
    products.filter((p) => p.type === "variable"),
    CONCURRENCY,
    async (p) => {
      variationsOf.set(p.id, await wooGetAll<WooVariation>(shop, `products/${p.id}/variations`, { _fields: VARIATION_FIELDS }));
    },
  );

  for (const p of products) {
    if (UNSOLD_TYPES.has(p.type)) continue;
    if (p.type === "variable") {
      for (const v of variationsOf.get(p.id) ?? []) rows.push(variationRow(shop, p, v, v.status || p.status, inherited));
    } else {
      rows.push(productRow(shop, p, p.status, inherited));
    }
  }
  await upsertItems(rows);

  await refreshVanishedItems(shop, runStart);
  return rows.length;
}

/**
 * Items that were in the catalogue before but are not in this sync's list were trashed or
 * deleted in the shop: look each one up and record what happened, instead of leaving it
 * looking published. Usually there are none.
 */
async function refreshVanishedItems(shop: Shop, runStart: Date): Promise<void> {
  const vanished = await db
    .select()
    .from(items)
    .where(and(eq(items.shopId, shop.id), lt(items.syncedAt, runStart)));
  const live = vanished.filter((i) => !isGone(i.status));
  await mapLimit(live, CONCURRENCY, async (item) => {
    const prod = await wooGetOne<WooProduct>(shop, `products/${item.wooProductId}`, PRODUCT_FIELDS);
    let status = prod ? prod.status : "deleted";
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

  const inherited = await loadProductCosts(shop);
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
    if (v === 0) return void rows.push(productRow(shop, prod, prod.status, inherited));

    const variation = await wooGetOne<WooVariation>(shop, `products/${p}/variations/${v}`, VARIATION_FIELDS);
    if (!variation) return void rows.push(deleted(p, v, null, prod.name));
    rows.push(variationRow(shop, prod, variation, prod.status === "trash" ? "trash" : variation.status, inherited));
  });

  await upsertItems(rows);
  return rows.length;
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
