import { and, eq, isNull, sql } from "drizzle-orm";
import { db } from "@/db";
import { items, type shops } from "@/db/schema";
import { mapLimit, wooGetAll } from "@/lib/woo";

type Shop = typeof shops.$inferSelect;

interface WooProduct {
  id: number;
  name: string;
  sku: string;
  type: string;
  price: string;
  images: { src: string }[];
  manage_stock: boolean;
  stock_quantity: number | null;
}

interface WooVariation {
  id: number;
  sku: string;
  price: string;
  image: { src: string } | null;
  manage_stock: boolean | "parent";
  stock_quantity: number | null;
  attributes: { name: string; option: string }[];
}

// Grouped and external products are never sold (or stocked) themselves.
const UNSOLD_TYPES = new Set(["grouped", "external"]);

// Only what is used, to keep responses small; variations are read a few at a time.
const PRODUCT_FIELDS = "id,name,sku,type,price,images,manage_stock,stock_quantity";
const VARIATION_FIELDS = "id,sku,price,image,manage_stock,stock_quantity,attributes";
const CONCURRENCY = 4;

const excluded = (column: string) => sql.raw(`excluded.${column}`);

/** Upserts one `items` row per simple product / variation. Returns how many were synced. */
export async function syncItems(shop: Shop): Promise<number> {
  const products = await wooGetAll<WooProduct>(shop, "products", { _fields: PRODUCT_FIELDS });
  const rows: (typeof items.$inferInsert)[] = [];

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
      for (const v of variationsOf.get(p.id) ?? []) {
        const managesStock = v.manage_stock === "parent" ? p.manage_stock : v.manage_stock;
        rows.push({
          shopId: shop.id,
          wooProductId: p.id,
          wooVariationId: v.id,
          productName: p.name,
          variationLabel: v.attributes.map((a) => a.option).join(" / ") || null,
          sku: v.sku || null,
          price: v.price || p.price || null, // a variation without its own price shows the parent's
          imageUrl: v.image?.src ?? p.images?.[0]?.src ?? null,
          managesStock,
          stockQty: managesStock && v.stock_quantity != null ? String(v.stock_quantity) : null,
        });
      }
    } else {
      rows.push({
        shopId: shop.id,
        wooProductId: p.id,
        wooVariationId: 0,
        productName: p.name,
        sku: p.sku || null,
        price: p.price || null,
        imageUrl: p.images?.[0]?.src ?? null,
        managesStock: p.manage_stock,
        stockQty: p.manage_stock && p.stock_quantity != null ? String(p.stock_quantity) : null,
      });
    }
  }

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
          price: excluded("price"),
          imageUrl: excluded("image_url"),
          managesStock: excluded("manages_stock"),
          stockQty: excluded("stock_qty"),
          syncedAt: new Date(),
        },
      });
  }
  return rows.length;
}

/**
 * Photos only, without touching anything else: the product list (photos only) fills every item
 * that has no photo yet with its product's photo, then each variable product's variations are
 * read (photo only, a few at a time) so a variation gets its own colour's photo.
 * Returns how many items were updated.
 */
export async function syncItemImages(shop: Shop): Promise<number> {
  const products = await wooGetAll<{ id: number; type: string; images: { src: string }[] }>(shop, "products", {
    _fields: "id,type,images",
  });
  let updated = 0;
  for (const p of products) {
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
