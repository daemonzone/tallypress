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
 * Idempotent: earlier estimates are replaced. They are marked as estimated, never mixed with
 * restocks the owner recorded, and `removeEstimatedRestocks` takes them all out again.
 */
export async function estimateRestocks(shopId: string, opts: { payments?: boolean } = {}): Promise<EstimateResult> {
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
  const byMonth = new Map<string, number>();
  const lots: (typeof restockLots.$inferInsert)[] = [];
  for (const r of sold) {
    const qty = Number(r.qty);
    const cost = Number(r.cost);
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

  for (let i = 0; i < lots.length; i += 500) await db.insert(restockLots).values(lots.slice(i, i + 500));

  let total = 0;
  for (const [month, cost] of [...byMonth.entries()].sort()) {
    const cents = Math.round(cost * 100);
    total += cents;
    await db.insert(ledgerEntries).values({
      shopId,
      kind: "restock",
      amount: (-cents / 100).toFixed(2),
      occurredAt: monthStart(month) as unknown as Date,
      estimated: true,
      note: pct == null ? "Acquisti stimati (costo del venduto)" : `Acquisti stimati (costo del venduto, ${pct}% del listino)`,
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
  return { months: byMonth.size, lots: lots.length, total, openingLots, closedMonths, vat, tax };
}

/** Takes every estimated purchase out again and recomputes the opening stock and costs. */
export async function removeEstimatedRestocks(shopId: string): Promise<{ entries: number; openingLots: number }> {
  const keep = await pendingDifferences(shopId);
  const entries = await clearEstimates(shopId);
  const openingLots = await rebuildOpeningLots(shopId, keep);
  await rebuildCosts(shopId);
  return { entries, openingLots };
}
