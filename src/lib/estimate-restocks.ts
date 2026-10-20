import { and, eq, sql } from "drizzle-orm";
import { db } from "@/db";
import { ledgerEntries, monthClosings, restockLots, shops } from "@/db/schema";
import { ensureMonthsClosed } from "./closing";
import { COUNTED_STATUSES } from "./costs";
import { rebuildOpeningLots } from "./opening";
import { rebuildCosts } from "./rebuild-costs";
import { buildReport } from "./report";

export interface EstimateResult {
  months: number;
  lots: number;
  total: number; // cents spent, in all
  openingLots: number;
  closedMonths: number;
  vat: number; // cents of estimated VAT payments
  tax: number; // cents of estimated income tax / contribution payments
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
 * VAT AND TAXES (unless `payments: false`). Each month, the VAT of its sales is booked as a VAT
 * payment and the income tax and contributions its profit adds (IRPEF brackets and INPS, as the shop's
 * tax profile computes them over the calendar year) as a tax payment, as if paid in the month
 * they accrue. This is steady-state: payments made in a year mostly settle earlier income, but if
 * income is stable they come out about the same. The VAT on purchases is left out on purpose: it would
 * raise the purchase outflow and lower the VAT payment by the same amount.
 *
 * Idempotent: earlier estimates are replaced. They are marked as estimated, never mixed with
 * restocks the owner recorded, and `removeEstimatedRestocks` takes them all out again.
 */
export async function estimateRestocks(shopId: string, opts: { payments?: boolean } = {}): Promise<EstimateResult> {
  const [shop] = await db.select().from(shops).where(eq(shops.id, shopId));
  if (!shop?.baselineAt) throw new Error("The shop has no starting point");
  const tz = shop.timezone.replace(/'/g, "");
  const pct = shop.defaultCostPct == null ? null : Number(shop.defaultCostPct);

  await clearEstimates(shopId);

  // Cost of what was sold, per item and month (lines already carry their frozen cost).
  const sold = (
    await db.execute(sql`
      SELECT l.item_id AS item, to_char(date_trunc('month', o.placed_at AT TIME ZONE ${tz}), 'YYYY-MM-01') AS month,
             sum(l.quantity)::text AS qty, sum(l.quantity * l.unit_cost_snapshot)::text AS cost
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

  const openingLots = await rebuildOpeningLots(shopId);
  const rebuilt = await rebuildCosts(shopId);

  // VAT and taxes come from the months as they now stand (costs are final at this point).
  let vat = 0;
  let tax = 0;
  let closedMonths = rebuilt.closedMonths.length;
  if (opts.payments !== false) {
    const report = await buildReport(shopId);
    for (const m of report?.months.filter((x) => !x.history) ?? []) {
      for (const [kind, amount, note] of [
        ["vat_payment", m.vat, "IVA stimata (vendite del mese)"],
        ["tax_payment", m.taxReserve, "Imposte e contributi stimati (IRPEF + INPS sull'utile del mese)"],
      ] as const) {
        if (amount <= 0) continue;
        if (kind === "vat_payment") vat += amount;
        else tax += amount;
        await db.insert(ledgerEntries).values({
          shopId,
          kind,
          amount: (-amount / 100).toFixed(2),
          occurredAt: monthStart(m.key) as unknown as Date,
          estimated: true,
          note,
        });
      }
    }
    // The flows of the months changed: close them again.
    await db.delete(monthClosings).where(eq(monthClosings.shopId, shopId));
    closedMonths = (await ensureMonthsClosed(shopId)).length;
  }
  return { months: byMonth.size, lots: lots.length, total, openingLots, closedMonths, vat, tax };
}

/** Takes every estimated purchase out again and recomputes the opening stock and costs. */
export async function removeEstimatedRestocks(shopId: string): Promise<{ entries: number; openingLots: number }> {
  const entries = await clearEstimates(shopId);
  const openingLots = await rebuildOpeningLots(shopId);
  await rebuildCosts(shopId);
  return { entries, openingLots };
}
