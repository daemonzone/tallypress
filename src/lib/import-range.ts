import { and, count, eq, gte, inArray, lte, sql } from "drizzle-orm";
import { db } from "@/db";
import { items, ledgerEntries, monthClosings, orderLines, orders, restockLots, shops } from "@/db/schema";
import { ensureMonthsClosed } from "./closing";
import { COUNTED_STATUSES, freezeCosts, relinkLines } from "./costs";
import { withShopLock } from "./lock";
import { hasOpening } from "./opening";
import { syncMissingItems } from "./sync/items";
import { importOrdersBetween } from "./sync/orders";

export type ImportRangeError = "invalid" | "not_set_up" | "no_items" | "gap" | "closed" | "busy" | "failed";

export type ImportRangeResult =
  | {
      ok: true;
      orders: number; // orders read from WooCommerce in the period
      newStart: string | null; // set when the shop's starting date moved back
      historyFrom: string | null; // set when sales history was added before the starting date
      lotsRebuilt: number; // opening stock lots rebuilt at the new starting date
      closedMonths: string[];
    }
  | { ok: false; error: ImportRangeError; detail?: string };

const DAY = 86_400_000;
const ISO_DAY = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Imports the orders of a period (`from` to `to`, inclusive, "YYYY-MM-DD") without erasing anything.
 *
 * - A period inside the existing data just refreshes those orders.
 * - `historyOnly`: a period before the starting date is added as SALES HISTORY only. The starting
 *   date, the opening deposit, the opening stock and the closed months are not touched, and the
 *   months before the starting date show sales and profit but no account balance.
 * - Otherwise a period starting BEFORE the starting date extends the history backwards: the
 *   starting date moves to `from`, the opening stock is rebuilt for that date (WooCommerce stock
 *   now + units sold since, minus restocks recorded since) and the opening deposit moves with it.
 *   It refuses when months are already closed unless `rebuildClosings` is set, because closed
 *   months would no longer add up.
 *
 * Either way the period must reach the existing data (no gap). Products are not re-read, but any
 * product or variation the imported lines refer to that the catalogue lacks (trashed or deleted
 * ones) is looked up and recorded with its status, so every sold line stays linked.
 */
export async function importRange(
  shopId: string,
  input: { from: string; to?: string; rebuildClosings?: boolean; historyOnly?: boolean },
): Promise<ImportRangeResult> {
  if (!ISO_DAY.test(input.from) || (input.to && !ISO_DAY.test(input.to))) return { ok: false, error: "invalid" };
  const from = new Date(`${input.from}T00:00:00Z`);
  const toDay = input.to ? new Date(`${input.to}T00:00:00Z`) : null;
  if (Number.isNaN(from.getTime()) || (toDay && (Number.isNaN(toDay.getTime()) || toDay < from)) || from.getTime() > Date.now()) {
    return { ok: false, error: "invalid" };
  }

  const locked = await withShopLock(shopId, async (): Promise<ImportRangeResult> => {
    const [shop] = await db.select().from(shops).where(eq(shops.id, shopId));
    if (!shop?.baselineAt || !(await hasOpening(shopId))) return { ok: false, error: "not_set_up" };
    const [{ n: itemCount }] = await db.select({ n: count() }).from(items).where(eq(items.shopId, shopId));
    if (!itemCount) return { ok: false, error: "no_items" };

    const baseline = shop.baselineAt;
    // Where the data starts today: the baseline, or earlier when sales history was added.
    const dataStart = shop.historyStart && shop.historyStart < baseline ? shop.historyStart : baseline;
    const extendsBack = from < baseline;

    // ---- sales history only: nothing about cash or stock changes
    if (extendsBack && input.historyOnly) {
      const toExclusive = toDay ? new Date(toDay.getTime() + DAY) : dataStart;
      if (from < dataStart && toExclusive < dataStart) return { ok: false, error: "gap" };
      const imported = await importOrdersBetween(shop, from, toExclusive);
      await syncMissingItems(shop);
      if (from < dataStart) await db.update(shops).set({ historyStart: from }).where(eq(shops.id, shopId));
      await relinkLines(shopId);
      await freezeCosts(shopId);
      return { ok: true, orders: imported, newStart: null, historyFrom: from < dataStart ? input.from : null, lotsRebuilt: 0, closedMonths: [] };
    }

    // Default end: where the existing data begins when going back, otherwise now.
    const toExclusive = toDay ? new Date(toDay.getTime() + DAY) : extendsBack ? dataStart : new Date();
    if (extendsBack && toExclusive < dataStart) return { ok: false, error: "gap" };

    if (extendsBack) {
      const [{ n: closed }] = await db.select({ n: count() }).from(monthClosings).where(eq(monthClosings.shopId, shopId));
      if (closed > 0 && !input.rebuildClosings) return { ok: false, error: "closed" };
    }

    const imported = await importOrdersBetween(shop, from, toExclusive);
    await syncMissingItems(shop);
    if (!extendsBack) {
      await relinkLines(shopId);
      await freezeCosts(shopId);
      return { ok: true, orders: imported, newStart: null, historyFrom: null, lotsRebuilt: 0, closedMonths: await ensureMonthsClosed(shopId) };
    }

    // ---- extend the cash history backwards: rebuild the opening position at the new start
    const asOf = shop.lastSyncedAt; // WooCommerce stock was read at the last sync
    const soldRows = await db
      .select({ itemId: orderLines.itemId, qty: sql<string>`sum(${orderLines.quantity})` })
      .from(orderLines)
      .innerJoin(orders, eq(orders.id, orderLines.orderId))
      .where(
        and(
          eq(orderLines.shopId, shopId),
          inArray(orders.status, COUNTED_STATUSES),
          gte(orders.placedAt, from),
          asOf ? lte(orders.placedAt, asOf) : undefined,
        ),
      )
      .groupBy(orderLines.itemId);
    const sold = new Map(soldRows.filter((r) => r.itemId).map((r) => [r.itemId!, Number(r.qty)]));

    const lots = await db.select().from(restockLots).where(eq(restockLots.shopId, shopId));
    const oldOpeningCost = new Map(lots.filter((l) => l.source === "opening").map((l) => [l.itemId, Number(l.unitCost)]));
    const restocked = new Map<string, number>();
    for (const l of lots.filter((l) => l.source !== "opening")) {
      restocked.set(l.itemId, (restocked.get(l.itemId) ?? 0) + Number(l.quantity));
    }

    const itemRows = await db.select().from(items).where(eq(items.shopId, shopId));
    const newLots = itemRows.flatMap((item) => {
      if (!item.managesStock || item.stockQty == null) return [];
      const quantity = Number(item.stockQty) + (sold.get(item.id) ?? 0) - (restocked.get(item.id) ?? 0);
      const unitCost = oldOpeningCost.get(item.id) ?? (item.manualUnitCost == null ? null : Number(item.manualUnitCost));
      return quantity > 0 && unitCost != null
        ? [{ shopId, itemId: item.id, quantity: String(quantity), unitCost: unitCost.toFixed(4), purchasedAt: from, source: "opening" as const }]
        : [];
    });

    await db.transaction(async (tx) => {
      if (input.rebuildClosings) await tx.delete(monthClosings).where(eq(monthClosings.shopId, shopId));
      await tx.delete(restockLots).where(and(eq(restockLots.shopId, shopId), eq(restockLots.source, "opening")));
      for (let i = 0; i < newLots.length; i += 500) await tx.insert(restockLots).values(newLots.slice(i, i + 500));
      // Sales history that the new starting date now covers is no longer "history".
      const absorbed = shop.historyStart != null && from <= shop.historyStart;
      await tx.update(shops).set({ baselineAt: from, ...(absorbed ? { historyStart: null } : {}) }).where(eq(shops.id, shopId));
      await tx
        .update(ledgerEntries)
        .set({ occurredAt: from })
        .where(and(eq(ledgerEntries.shopId, shopId), eq(ledgerEntries.kind, "opening_balance")));
    });

    await relinkLines(shopId);
    await freezeCosts(shopId);
    return { ok: true, orders: imported, newStart: input.from, historyFrom: null, lotsRebuilt: newLots.length, closedMonths: await ensureMonthsClosed(shopId) };
  }).catch((err): { locked: true; value: ImportRangeResult } => ({
    locked: true,
    value: { ok: false, error: "failed", detail: err instanceof Error ? err.message : String(err) },
  }));

  return locked.locked ? locked.value : { ok: false, error: "busy" };
}
