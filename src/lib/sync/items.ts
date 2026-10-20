import { sql } from "drizzle-orm";
import { db } from "@/db";
import { items, type shops } from "@/db/schema";
import { wooGetAll } from "@/lib/woo";

type Shop = typeof shops.$inferSelect;

interface WooProduct {
  id: number;
  name: string;
  sku: string;
  type: string;
  price: string;
  manage_stock: boolean;
  stock_quantity: number | null;
}

interface WooVariation {
  id: number;
  sku: string;
  price: string;
  manage_stock: boolean | "parent";
  stock_quantity: number | null;
  attributes: { name: string; option: string }[];
}

// Grouped and external products are never sold (or stocked) themselves.
const UNSOLD_TYPES = new Set(["grouped", "external"]);

const excluded = (column: string) => sql.raw(`excluded.${column}`);

/** Upserts one `items` row per simple product / variation. Returns how many were synced. */
export async function syncItems(shop: Shop): Promise<number> {
  const products = await wooGetAll<WooProduct>(shop, "products");
  const rows: (typeof items.$inferInsert)[] = [];

  for (const p of products) {
    if (UNSOLD_TYPES.has(p.type)) continue;

    if (p.type === "variable") {
      const variations = await wooGetAll<WooVariation>(shop, `products/${p.id}/variations`);
      for (const v of variations) {
        const managesStock = v.manage_stock === "parent" ? p.manage_stock : v.manage_stock;
        rows.push({
          shopId: shop.id,
          wooProductId: p.id,
          wooVariationId: v.id,
          productName: p.name,
          variationLabel: v.attributes.map((a) => a.option).join(" / ") || null,
          sku: v.sku || null,
          price: v.price || p.price || null, // a variation without its own price shows the parent's
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
          managesStock: excluded("manages_stock"),
          stockQty: excluded("stock_qty"),
          syncedAt: new Date(),
        },
      });
  }
  return rows.length;
}
