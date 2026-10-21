import { and, eq, inArray } from "drizzle-orm";
import { db } from "@/db";
import { ledgerEntries, monthClosings, shops } from "@/db/schema";
import { ensureMonthsClosed } from "./closing";
import { buildReport } from "./report";

export interface PaymentRules {
  /** Quarterly VAT due dates: the Italian ones (16 May, 20 Aug, 16 Nov, 16 Mar) or the last day of the month after the quarter. */
  vatDue?: "italian" | "month-end";
  /** Tax of the previous year: two instalments (30 June, 30 November) or all at once on 30 June. */
  taxPayments?: "two" | "june";
}

export interface PaymentsResult {
  vat: number; // cents of estimated VAT payments
  tax: number; // cents of estimated income tax / contribution payments
  entries: number;
  closedMonths: number;
}

/** Local date at midday, so the entry lands in the right day and month whatever the timezone. */
const at = (year: number, month: number, day: number) => new Date(Date.UTC(year, month - 1, day, 12));

/** Removes the estimated VAT and tax payments (purchases are left alone). Returns how many entries went. */
export async function clearEstimatedPayments(shopId: string): Promise<number> {
  const gone = await db
    .delete(ledgerEntries)
    .where(
      and(
        eq(ledgerEntries.shopId, shopId),
        eq(ledgerEntries.estimated, true),
        inArray(ledgerEntries.kind, ["vat_payment", "tax_payment", "prior_payment"]),
      ),
    );
  return gone.rowCount ?? 0;
}

/**
 * Estimates the VAT and income tax payments the owner has not recorded, from the months as they stand.
 * Idempotent: earlier estimated payments are replaced; purchases and anything the owner recorded stay.
 *
 * VAT is paid the month after the sales (shop.vatPeriod "monthly") or each quarter (16 May for Q1,
 * 20 August for Q2, 16 November for Q3, 16 March of the next year for Q4). The VAT of a period before
 * the starting point is an obligation from an earlier period (kind prior_payment). A due date still in
 * the future is not booked (it stays "still to pay"), and neither is one before the starting point.
 *
 * Income tax and contributions (as the tax profile computes them over the calendar year) are paid with
 * a delay: the tax of year Y-1 comes out in two equal instalments, 30 June and 30 November of year Y.
 *
 * `rules` swaps the due dates for simpler ones (see PaymentRules); the defaults are the ones above.
 */
export async function estimatePayments(shopId: string, rules: PaymentRules = {}): Promise<PaymentsResult> {
  const [shop] = await db.select().from(shops).where(eq(shops.id, shopId));
  if (!shop?.baselineAt) throw new Error("The shop has no starting point");
  await clearEstimatedPayments(shopId);

  const report = await buildReport(shopId);
  const all = report?.months ?? [];
  const now = new Date();
  const start = shop.baselineAt;

  type Entry = { what: "vat" | "tax"; kind: "vat_payment" | "tax_payment" | "prior_payment"; amount: number; on: Date; note: string };
  const entries: Entry[] = [];

  if (shop.vatPeriod === "quarterly") {
    const quarters = new Map<string, { vat: number; cash: boolean }>();
    for (const m of all) {
      const q = `${m.key.slice(0, 4)}-${Math.floor((Number(m.key.slice(5, 7)) - 1) / 3) + 1}`;
      const cur = quarters.get(q) ?? { vat: 0, cash: false };
      quarters.set(q, { vat: cur.vat + m.vat, cash: cur.cash || !m.history });
    }
    for (const [q, { vat, cash }] of [...quarters.entries()].sort()) {
      const year = Number(q.slice(0, 4));
      const n = Number(q.slice(5));
      const on =
        rules.vatDue === "month-end"
          ? n === 1 ? at(year, 4, 30) : n === 2 ? at(year, 7, 31) : n === 3 ? at(year, 10, 31) : at(year + 1, 1, 31)
          : n === 1 ? at(year, 5, 16) : n === 2 ? at(year, 8, 20) : n === 3 ? at(year, 11, 16) : at(year + 1, 3, 16);
      if (vat <= 0 || on > now || on < start) continue;
      entries.push({
        what: "vat",
        kind: cash ? "vat_payment" : "prior_payment",
        amount: vat,
        on,
        note: `IVA stimata del ${n}° trimestre ${year}${cash ? "" : " (periodo precedente al punto di partenza)"}`,
      });
    }
  } else {
    // The month after the sales; the first cash month pays the month before the starting point.
    for (const m of all.filter((x) => !x.history)) {
      const prev = all[all.findIndex((x) => x.key === m.key) - 1];
      if (!prev || prev.vat <= 0) continue;
      const on = at(Number(m.key.slice(0, 4)), Number(m.key.slice(5, 7)), 1);
      entries.push(
        prev.history
          ? { what: "vat", kind: "prior_payment", amount: prev.vat, on, note: `IVA stimata di ${prev.key.slice(0, 7)} (periodo precedente al punto di partenza)` }
          : { what: "vat", kind: "vat_payment", amount: prev.vat, on, note: "IVA stimata (vendite del mese precedente)" },
      );
    }
  }

  // Income tax accrued per calendar year, history years included.
  const yearTax = new Map<string, number>();
  for (const m of all) yearTax.set(m.key.slice(0, 4), (yearTax.get(m.key.slice(0, 4)) ?? 0) + Math.max(m.taxReserve, 0));
  for (const year of new Set(all.filter((m) => !m.history).map((m) => m.key.slice(0, 4)))) {
    const owed = yearTax.get(String(Number(year) - 1)) ?? 0;
    if (owed <= 0) continue;
    const first = Math.round(owed / 2);
    const instalments =
      rules.taxPayments === "june"
        ? ([[6, 30, owed, "saldo al 30 giugno"]] as const)
        : ([[6, 30, first, "rata di giugno"], [11, 30, owed - first, "rata di novembre"]] as const);
    for (const [month, day, amount, label] of instalments) {
      const on = at(Number(year), month, day);
      if (on > now || on < start) continue;
      // A payment for a year whose months are part of the cash figures settles what was set aside for it;
      // one for a year before the starting point is an obligation from an earlier period.
      const settles = all.some((m) => m.key.startsWith(String(Number(year) - 1)) && !m.history);
      entries.push({ what: "tax", kind: settles ? "tax_payment" : "prior_payment", amount, on, note: `Imposte ${Number(year) - 1} stimate (IRPEF + INPS), ${label}` });
    }
  }

  let vat = 0;
  let tax = 0;
  for (const e of entries) {
    if (e.what === "vat") vat += e.amount;
    else tax += e.amount;
    await db.insert(ledgerEntries).values({
      shopId,
      kind: e.kind,
      amount: (-e.amount / 100).toFixed(2),
      occurredAt: e.on,
      estimated: true,
      note: e.note,
    });
  }
  // The flows of the months changed: close them again.
  await db.delete(monthClosings).where(eq(monthClosings.shopId, shopId));
  const closed = await ensureMonthsClosed(shopId);
  return { vat, tax, entries: entries.length, closedMonths: closed.length };
}
