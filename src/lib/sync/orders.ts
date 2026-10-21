import { and, eq, notInArray } from "drizzle-orm";
import { db } from "@/db";
import { items, orderCoupons, orderLines, orders, type shops } from "@/db/schema";
import { sumMoney, wooGetAll } from "@/lib/woo";

type Shop = typeof shops.$inferSelect;

interface WooOrder {
  id: number;
  status: string;
  date_created_gmt: string;
  total: string;
  total_tax: string;
  shipping_total: string;
  discount_total: string;
  discount_tax: string;
  payment_method: string;
  payment_method_title: string;
  transaction_id: string;
  created_via: string;
  coupon_lines: { code: string; discount: string; discount_tax: string }[];
  meta_data: { key: string; value: unknown }[];
  refunds: { total: string }[];
  line_items: {
    id: number;
    name: string;
    product_id: number;
    variation_id: number;
    quantity: number;
    subtotal: string; // before coupons, excluding tax
    subtotal_tax: string;
    total: string; // after discounts, excluding tax
    total_tax: string;
  }[];
}

/** Text from an order's metadata (e.g. WooCommerce's order attribution), trimmed; null when absent. */
function meta(o: WooOrder, key: string): string | null {
  const value = o.meta_data?.find((m) => m.key === key)?.value;
  return typeof value === "string" && value.trim() ? value.trim().slice(0, 120) : null;
}

/** "MasterCard ending in 2163" -> "MasterCard": the last digits of a card are not kept. */
function paymentTitle(title: string | undefined): string | null {
  const clean = (title ?? "")
    .replace(/\s*(ending in|terminante in|finisce con)\s*\d+/i, "")
    .replace(/[•*·]+\s*\d{2,4}/g, "")
    .trim();
  return clean ? clean.slice(0, 120) : null;
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
        paymentMethod: o.payment_method?.trim() || null,
        paymentMethodTitle: paymentTitle(o.payment_method_title),
        transactionId: o.transaction_id?.trim() || null,
        createdVia: o.created_via?.trim() || null,
        sourceType: meta(o, "_wc_order_attribution_source_type"),
        utmSource: meta(o, "_wc_order_attribution_utm_source"),
        utmMedium: meta(o, "_wc_order_attribution_utm_medium"),
        discountTotal: sumMoney(o.discount_total, o.discount_tax),
        refundedTotal: sumMoney(...o.refunds.map((r) => String(Math.abs(parseFloat(r.total))))),
        syncedAt: new Date(),
      };
      const [order] = await tx
        .insert(orders)
        .values(values)
        .onConflictDoUpdate({ target: [orders.shopId, orders.wooOrderId], set: values })
        .returning({ id: orders.id });

      // Coupons: the order's current set replaces what was stored.
      await tx.delete(orderCoupons).where(eq(orderCoupons.orderId, order.id));
      const coupons = (o.coupon_lines ?? []).filter((c) => c.code);
      if (coupons.length) {
        await tx.insert(orderCoupons).values(
          coupons.map((c) => ({ shopId: shop.id, orderId: order.id, code: c.code.slice(0, 80), discount: sumMoney(c.discount, c.discount_tax) })),
        ).onConflictDoNothing();
      }

      for (const line of o.line_items) {
        const lineValues = {
          shopId: shop.id,
          orderId: order.id,
          wooLineId: line.id,
          name: line.name,
          wooProductId: line.product_id,
          wooVariationId: line.variation_id,
          itemId: itemIdByWooIds.get(`${line.product_id}:${line.variation_id}`) ?? null,
          quantity: String(line.quantity),
          grossTotal: sumMoney(line.total, line.total_tax),
          taxTotal: line.total_tax,
          subtotalGross: sumMoney(line.subtotal, line.subtotal_tax),
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
  // Sales history can reach back before the baseline.
  const baseline = shop.historyStart && shop.historyStart < shop.baselineAt ? shop.historyStart : shop.baselineAt;

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
