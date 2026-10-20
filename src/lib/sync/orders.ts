import { and, eq, notInArray } from "drizzle-orm";
import { db } from "@/db";
import { items, orderLines, orders, type shops } from "@/db/schema";
import { sumMoney, wooGetAll } from "@/lib/woo";

type Shop = typeof shops.$inferSelect;

interface WooOrder {
  id: number;
  status: string;
  date_created_gmt: string;
  total: string;
  total_tax: string;
  shipping_total: string;
  refunds: { total: string }[];
  line_items: {
    id: number;
    product_id: number;
    variation_id: number;
    quantity: number;
    total: string; // after discounts, excluding tax
    total_tax: string;
  }[];
}

// Overlap with the previous run so an order modified mid-sync is never missed.
const OVERLAP_MS = 10 * 60 * 1000;

/**
 * Saves orders and their lines (idempotent: existing ones are updated in place, lines
 * removed in WooCommerce disappear here too). Orders placed before `notBefore` are skipped.
 * Never touches the frozen purchase cost on a line. Returns how many orders were saved.
 */
async function upsertOrders(shop: Shop, wooOrders: WooOrder[], notBefore: Date): Promise<number> {
  const itemRows = await db.select().from(items).where(eq(items.shopId, shop.id));
  const itemIdByWooIds = new Map(
    itemRows.map((i) => [`${i.wooProductId}:${i.wooVariationId}`, i.id]),
  );

  let saved = 0;
  for (const o of wooOrders) {
    const placedAt = new Date(`${o.date_created_gmt}Z`);
    if (placedAt < notBefore) continue;

    await db.transaction(async (tx) => {
      const values = {
        shopId: shop.id,
        wooOrderId: o.id,
        status: o.status,
        placedAt,
        grossTotal: o.total,
        taxTotal: o.total_tax,
        shippingTotal: o.shipping_total,
        refundedTotal: sumMoney(...o.refunds.map((r) => String(Math.abs(parseFloat(r.total))))),
        syncedAt: new Date(),
      };
      const [order] = await tx
        .insert(orders)
        .values(values)
        .onConflictDoUpdate({ target: [orders.shopId, orders.wooOrderId], set: values })
        .returning({ id: orders.id });

      for (const line of o.line_items) {
        const lineValues = {
          shopId: shop.id,
          orderId: order.id,
          wooLineId: line.id,
          itemId: itemIdByWooIds.get(`${line.product_id}:${line.variation_id}`) ?? null,
          quantity: String(line.quantity),
          grossTotal: sumMoney(line.total, line.total_tax),
          taxTotal: line.total_tax,
        };
        await tx
          .insert(orderLines)
          .values(lineValues)
          .onConflictDoUpdate({
            target: [orderLines.shopId, orderLines.orderId, orderLines.wooLineId],
            set: lineValues, // unitCostSnapshot is deliberately left untouched
          });
      }

      const keep = o.line_items.map((l) => l.id);
      await tx
        .delete(orderLines)
        .where(
          and(
            eq(orderLines.orderId, order.id),
            keep.length ? notInArray(orderLines.wooLineId, keep) : undefined,
          ),
        );
    });
    saved++;
  }
  return saved;
}

/**
 * Upserts orders (all statuses) placed on/after the shop's baseline. The first run
 * pulls everything since the baseline; later runs only what changed since the last
 * completed sync. Returns how many orders were synced.
 */
export async function syncOrders(shop: Shop): Promise<number> {
  if (!shop.baselineAt) throw new Error("Shop has no baseline date: set the starting point first");
  const baseline = shop.baselineAt;

  const wooOrders = await wooGetAll<WooOrder>(shop, "orders", {
    status: "any",
    dates_are_gmt: true,
    ...(shop.lastSyncedAt
      ? { modified_after: new Date(shop.lastSyncedAt.getTime() - OVERLAP_MS).toISOString() }
      : { after: baseline.toISOString() }),
  });
  return upsertOrders(shop, wooOrders, baseline);
}

/** Imports the orders placed from `from` (inclusive) up to `to` (exclusive), whatever the shop's baseline. */
export async function importOrdersBetween(shop: Shop, from: Date, to: Date): Promise<number> {
  const wooOrders = await wooGetAll<WooOrder>(shop, "orders", {
    status: "any",
    dates_are_gmt: true,
    after: from.toISOString(),
    before: to.toISOString(),
  });
  return upsertOrders(shop, wooOrders, from);
}
