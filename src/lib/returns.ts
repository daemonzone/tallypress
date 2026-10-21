import { and, count, eq } from "drizzle-orm";
import { db } from "@/db";
import { ledgerEntries, orderLines, orders, type shops } from "@/db/schema";
import { COUNTED_STATUSES } from "./costs";
import { estimateRestocks } from "./estimate-restocks";
import { rebuildCosts } from "./rebuild-costs";
import { buildReport } from "./report";
import { wooGetAll } from "./woo";

type Shop = typeof shops.$inferSelect;

// WooCommerce writes this note when a refund puts items back in stock ("Item #123 stock increased from 1 to 3.").
// A cancelled order writes a different one ("Stock levels increased: ..."), which is not matched here:
// a cancelled order is not counted as a sale in the first place.
const RESTOCK_NOTE = /(?:Scorta dell'articolo|Item) #(\d+) (?:aumentata|stock increased) (?:da|from) (-?\d+) (?:a|to) (-?\d+)/i;

/**
 * For orders that have refunds, reads the order notes to see which units WooCommerce put back in stock
 * and records them on the lines (`returned_qty`): a returned unit is not a sale, so the stock and the
 * cost of goods sold both follow. Units refunded WITHOUT restocking leave no note and change nothing.
 * Recomputed from the notes every time, so it is idempotent. Returns how many lines changed.
 */
export async function applyReturns(shop: Shop, wooOrderIds: number[]): Promise<number> {
  let changed = 0;
  for (const wooId of wooOrderIds) {
    const [order] = await db
      .select({ id: orders.id, status: orders.status })
      .from(orders)
      .where(and(eq(orders.shopId, shop.id), eq(orders.wooOrderId, wooId)));
    if (!order) continue;

    // Orders that are not counted as sales (refunded in full, cancelled) have no sale to give back.
    const restocked = new Map<number, number>();
    if (COUNTED_STATUSES.includes(order.status)) {
      const notes = await wooGetAll<{ note: string }>(shop, `orders/${wooId}/notes`);
      for (const n of notes) {
        const m = RESTOCK_NOTE.exec(n.note);
        const gain = m ? Number(m[3]) - Number(m[2]) : 0;
        if (m && gain > 0) restocked.set(Number(m[1]), (restocked.get(Number(m[1])) ?? 0) + gain);
      }
    }

    const lines = await db.select().from(orderLines).where(eq(orderLines.orderId, order.id));
    for (const l of lines) {
      const key = l.wooVariationId ? l.wooVariationId : (l.wooProductId ?? 0);
      const take = Math.min(restocked.get(key) ?? 0, Number(l.quantity));
      restocked.set(key, (restocked.get(key) ?? 0) - take);
      if (take !== Number(l.returnedQty)) {
        await db.update(orderLines).set({ returnedQty: String(take) }).where(eq(orderLines.id, l.id));
        changed++;
      }
    }
  }
  return changed;
}

/**
 * Brings costs and months back in line after returns changed the units sold: the estimated purchases
 * (which mirror the units sold) are recomputed while the account is not aligned with the bank, else
 * only the costs and the closed months are.
 */
export async function refreshAfterReturns(shopId: string): Promise<void> {
  const [{ n: estimates }] = await db
    .select({ n: count() })
    .from(ledgerEntries)
    .where(and(eq(ledgerEntries.shopId, shopId), eq(ledgerEntries.estimated, true)));
  const report = await buildReport(shopId);
  if (!report?.hasOpening) return;
  if (estimates > 0 && !report.aligned) await estimateRestocks(shopId);
  else await rebuildCosts(shopId);
}
