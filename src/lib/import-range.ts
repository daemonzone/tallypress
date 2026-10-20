import { and, count, eq, gte, inArray, lte, sql } from "drizzle-orm";
import { db } from "@/db";
import { items, ledgerEntries, monthClosings, orderLines, orders, restockLots, shops } from "@/db/schema";
import { ensureMonthsClosed } from "./closing";
import { COUNTED_STATUSES, freezeCosts } from "./costs";
import { withShopLock } from "./lock";
import { hasOpening } from "./opening";
import { importOrdersBetween } from "./sync/orders";

export type ImportRangeError = "invalid" | "not_set_up" | "no_items" | "gap" | "closed" | "busy" | "failed";

export type ImportRangeResult =
  | {
      ok: true;
      orders: number; // orders read from WooCommerce in the period
      newStart: string | null; // set when the shop's starting date moved back
      lotsRebuilt: number; // opening stock lots rebuilt at the new starting date
      closedMonths: string[];
    }
  | { ok: false; error: ImportRangeError; detail?: string };

const DAY = 86_400_000;
const ISO_DAY = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Imports the orders of a period (`from` to `to`, inclusive, "YYYY-MM-DD") without erasing anything.
 *
 * - A period inside the shop's existing history just refreshes those orders.
 * - A period starting BEFORE the shop's starting date extends the history backwards: the
 *   starting date moves to `from`, the opening stock is rebuilt for that date (WooCommerce stock
 *   now + units sold since, minus restocks recorded since) and the opening deposit moves
 *   with it. It must reach the existing history (no gap), and it refuses to run when months are
 *   already closed unless `rebuildClosings` is set, because closed months would no longer add up.
 *
 * Products are not re-read from WooCommerce, so the shop must already have its items.
 */
export async function importRange(
  shopId: string,
  input: { from: string; to?: string; rebuildClosings?: boolean },
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
    const extendsBack = from < baseline;
    // Default end: the day before the existing history when going back, otherwise now.
    const toExclusive = toDay ? new Date(toDay.getTime() + DAY) : extendsBack ? baseline : new Date();
    if (extendsBack && toExclusive < baseline) return { ok: false, error: "gap" };

    if (extendsBack) {
      const [{ n: closed }] = await db.select({ n: count() }).from(monthClosings).where(eq(monthClosings.shopId, shopId));
      if (closed > 0 && !input.rebuildClosings) return { ok: false, error: "closed" };
    }

    const imported = await importOrdersBetween(shop, from, toExclusive);
    if (!extendsBack) {
      await freezeCosts(shopId);
      return { ok: true, orders: imported, newStart: null, lotsRebuilt: 0, closedMonths: await ensureMonthsClosed(shopId) };
    }

    // ---- extend the history backwards: rebuild the opening position at the new start
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
      await tx.update(shops).set({ baselineAt: from }).where(eq(shops.id, shopId));
      await tx
        .update(ledgerEntries)
        .set({ occurredAt: from })
        .where(and(eq(ledgerEntries.shopId, shopId), eq(ledgerEntries.kind, "opening_balance")));
    });

    await freezeCosts(shopId);
    return { ok: true, orders: imported, newStart: input.from, lotsRebuilt: newLots.length, closedMonths: await ensureMonthsClosed(shopId) };
  }).catch((err): { locked: true; value: ImportRangeResult } => ({
    locked: true,
    value: { ok: false, error: "failed", detail: err instanceof Error ? err.message : String(err) },
  }));

  return locked.locked ? locked.value : { ok: false, error: "busy" };
}

