import { and, eq, sql } from "drizzle-orm";
import { db } from "@/db";
import { ledgerEntries, restockLots, shops } from "@/db/schema";
import { COUNTED_STATUSES, getItemStates } from "./costs";
import { estimatePayments } from "./estimate-payments";
import { rebuildOpeningLots } from "./opening";
import { rebuildCosts } from "./rebuild-costs";

export interface EstimateResult {
  months: number;
  lots: number;
  total: number; // cents spent, in all
  openingLots: number;
  closedMonths: number;
  vat: number; // cents of estimated VAT payments
  tax: number; // cents of estimated income tax / contribution payments
}

/**
 * Differences between WooCommerce and the tracked stock that nobody has classified yet. They must
 * survive a rebuild of the opening stock, which would otherwise absorb them without a trace.
 */
export async function pendingDifferences(shopId: string): Promise<Map<string, number>> {
  return new Map((await getItemStates(shopId)).filter((s) => s.diff).map((s) => [s.id, s.diff!]));
}

/** Removes every estimated purchase (lots and ledger entries). Returns how many ledger entries went. */
async function clearEstimates(shopId: string): Promise<number> {
  await db.delete(restockLots).where(and(eq(restockLots.shopId, shopId), eq(restockLots.source, "estimate")));
  const gone = await db.delete(ledgerEntries).where(and(eq(ledgerEntries.shopId, shopId), eq(ledgerEntries.estimated, true)));
  return gone.rowCount ?? 0;
}

/**
 * Estimates the outflows the owner has not recorded, since the starting point:
 *
 * PURCHASES. What was spent buying the goods sold, assuming each month
 * the shop bought back what it sold (so its stock stayed about the same): per month, one estimated
 * restock ledger entry for the month's cost of goods sold, and per item an estimated lot for the
 * units sold. Because those purchases are now known, the opening stock is rebuilt (it shrinks to
 * about today's stock) and every cost and closed month is recomputed.
 *
 * VAT AND TAXES (unless `payments: false`). The VAT of each month's sales is paid in the FOLLOWING
 * month (so the last month's VAT is still due; the first month pays the VAT of the month before the
 * starting point). Income tax and contributions (IRPEF brackets and INPS, as the shop's tax profile
 * computes them over the calendar year) are paid with a delay: the tax of the previous year comes out
 * in two instalments, June and November. What accrues in the current year is not paid yet. VAT on
 * purchases is left out on purpose: it would raise the purchase outflow and lower the VAT
 * payment by the same amount.
 *
 * `upfrontUntil` ("YYYY-MM") makes the months up to and including that one a single purchase made
 * on the starting day (one ledger entry, one lot per item), as when the stock for the first months is
 * bought at the start; later months are bought month by month as usual.
 *
 * Idempotent: earlier estimates are replaced. They are marked as estimated, never mixed with
 * restocks the owner recorded, and `removeEstimatedRestocks` takes them all out again.
 */
export async function estimateRestocks(
  shopId: string,
  opts: { payments?: boolean; upfrontUntil?: string } = {},
): Promise<EstimateResult> {
  const [shop] = await db.select().from(shops).where(eq(shops.id, shopId));
  if (!shop?.baselineAt) throw new Error("The shop has no starting point");
  const tz = shop.timezone.replace(/'/g, "");
  const pct = shop.defaultCostPct == null ? null : Number(shop.defaultCostPct);

  const keep = await pendingDifferences(shopId);
  // The purchases mirror the frozen cost of the sales: bring those up to date with the items' current costs first.
  await rebuildCosts(shopId);
  await clearEstimates(shopId);

  // Cost of what was sold, per item and month (lines already carry their frozen cost).
  const sold = (
    await db.execute(sql`
      SELECT l.item_id AS item, to_char(date_trunc('month', o.placed_at AT TIME ZONE ${tz}), 'YYYY-MM-01') AS month,
             sum(l.quantity - l.returned_qty)::text AS qty, sum((l.quantity - l.returned_qty) * l.unit_cost_snapshot)::text AS cost
      FROM order_lines l JOIN orders o ON o.id = l.order_id
      WHERE l.shop_id = ${shopId} AND o.status IN (${sql.join(COUNTED_STATUSES.map((s) => sql`${s}`), sql`, `)})
        AND o.placed_at >= ${shop.baselineAt.toISOString()}::timestamptz AND l.unit_cost_snapshot IS NOT NULL
      GROUP BY 1, 2`)
  ).rows as { item: string | null; month: string; qty: string; cost: string }[];

  const monthStart = (month: string) => sql`(${month}::date::timestamp AT TIME ZONE ${tz})`;
  // The upfront purchase happens right after the opening balance entry, which has the starting day's timestamp.
  const upfrontAt = new Date(shop.baselineAt.getTime() + 1000);
  const isUpfront = (month: string) => opts.upfrontUntil != null && month.slice(0, 7) <= opts.upfrontUntil;
  const byMonth = new Map<string, number>();
  const upfrontByItem = new Map<string, { qty: number; cost: number }>();
  let upfrontCost = 0;
  const lots: (typeof restockLots.$inferInsert)[] = [];
  for (const r of sold) {
    const qty = Number(r.qty);
    const cost = Number(r.cost);
    if (isUpfront(r.month)) {
      upfrontCost += cost;
      if (r.item && qty > 0) {
        const cur = upfrontByItem.get(r.item) ?? { qty: 0, cost: 0 };
        upfrontByItem.set(r.item, { qty: cur.qty + qty, cost: cur.cost + cost });
      }
      continue;
    }
    byMonth.set(r.month, (byMonth.get(r.month) ?? 0) + cost);
    if (r.item && qty > 0) {
      lots.push({
        shopId,
        itemId: r.item,
        quantity: String(qty),
        unitCost: (cost / qty).toFixed(4),
        purchasedAt: monthStart(r.month) as unknown as Date, // first day of the month, local time
        source: "estimate",
        note: "Acquisto stimato",
      });
    }
  }
  for (const [itemId, u] of upfrontByItem) {
    lots.push({ shopId, itemId, quantity: String(u.qty), unitCost: (u.cost / u.qty).toFixed(4), purchasedAt: upfrontAt, source: "estimate", note: "Acquisto stimato" });
  }

  for (let i = 0; i < lots.length; i += 500) await db.insert(restockLots).values(lots.slice(i, i + 500));

  let total = 0;
  const label = pct == null ? "Acquisti stimati (costo del venduto)" : `Acquisti stimati (costo del venduto, ${pct}% del listino)`;
  if (upfrontCost > 0) {
    const cents = Math.round(upfrontCost * 100);
    total += cents;
    await db.insert(ledgerEntries).values({
      shopId,
      kind: "restock",
      amount: (-cents / 100).toFixed(2),
      occurredAt: upfrontAt,
      estimated: true,
      note: `Acquisto iniziale dello stock fino a ${opts.upfrontUntil} (costo del venduto)`,
    });
  }
  for (const [month, cost] of [...byMonth.entries()].sort()) {
    const cents = Math.round(cost * 100);
    total += cents;
    await db.insert(ledgerEntries).values({
      shopId,
      kind: "restock",
      amount: (-cents / 100).toFixed(2),
      occurredAt: monthStart(month) as unknown as Date,
      estimated: true,
      note: label,
    });
  }

  const openingLots = await rebuildOpeningLots(shopId, keep);
  const rebuilt = await rebuildCosts(shopId);

  // VAT and taxes come from the months as they now stand (costs are final at this point).
  let vat = 0;
  let tax = 0;
  let closedMonths = rebuilt.closedMonths.length;
  if (opts.payments !== false) {
    const paid = await estimatePayments(shopId);
    vat = paid.vat;
    tax = paid.tax;
    closedMonths = paid.closedMonths;
  }
  return { months: byMonth.size + (upfrontCost > 0 ? 1 : 0), lots: lots.length, total, openingLots, closedMonths, vat, tax };
}

/** Takes every estimated purchase out again and recomputes the opening stock and costs. */
export async function removeEstimatedRestocks(shopId: string): Promise<{ entries: number; openingLots: number }> {
  const keep = await pendingDifferences(shopId);
  const entries = await clearEstimates(shopId);
  const openingLots = await rebuildOpeningLots(shopId, keep);
  await rebuildCosts(shopId);
  return { entries, openingLots };
}
