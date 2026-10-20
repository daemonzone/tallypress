import type { TaxBracket } from "@/db/schema";

export type { TaxBracket };

// All report maths runs on integer cents; the database keeps numeric strings.

export const toCents = (v: string | number | null | undefined): number =>
  Math.round(Number(v ?? 0) * 100);

export const centsToString = (cents: number): string => (cents / 100).toFixed(2);

/** Parses a form field; accepts "12,50". Returns NaN for empty/invalid input. */
export function parseDecimal(v: FormDataEntryValue | null): number {
  const s = String(v ?? "").trim().replace(",", ".");
  return s === "" ? NaN : Number(s);
}

export interface TaxProfile {
  vatRate: number; // percent, included in gross prices
  incomeTaxRate: number; // flat percent, used when there are no brackets
  brackets: TaxBracket[] | null; // progressive yearly income tax (e.g. IRPEF)
  socialRate: number; // flat percent of profit (e.g. INPS)
  taxBase: "revenue" | "profit";
}

export interface Figures {
  gross: number;
  vat: number;
  netRevenue: number; // gross minus VAT
  cogs: number;
  profit: number; // net revenue minus purchase cost
  taxReserve: number;
  netEarnings: number; // profit minus the tax reserve
}

function progressiveTax(baseCents: number, brackets: TaxBracket[]): number {
  let tax = 0;
  let lower = 0;
  for (const b of brackets) {
    const upper = b.upTo == null ? Infinity : b.upTo * 100;
    if (baseCents > lower) tax += ((Math.min(baseCents, upper) - lower) * b.rate) / 100;
    lower = upper;
    if (baseCents <= upper) break;
  }
  return tax;
}

/** Income tax plus social contributions owed on a year's cumulative profit (cents). */
export function annualTax(profitCents: number, p: TaxProfile): number {
  const base = Math.max(profitCents, 0);
  const income = p.brackets?.length ? progressiveTax(base, p.brackets) : (base * p.incomeTaxRate) / 100;
  return Math.round(income + (base * p.socialRate) / 100);
}

/**
 * Monthly figures. With a profit-based profile the reserve for a month is the extra tax
 * that month's profit adds to the year so far (`priorProfit` = profit of the earlier
 * months of the same calendar year), so brackets apply to the yearly total, not to each
 * month on its own.
 */
export function figures(gross: number, cogs: number, p: TaxProfile, priorProfit = 0): Figures {
  const vat = Math.round((gross * p.vatRate) / (100 + p.vatRate));
  const netRevenue = gross - vat;
  const profit = netRevenue - cogs;
  const taxReserve =
    p.taxBase === "profit"
      ? annualTax(priorProfit + profit, p) - annualTax(priorProfit, p)
      : Math.round((Math.max(netRevenue, 0) * (p.incomeTaxRate + p.socialRate)) / 100);
  return { gross, vat, netRevenue, cogs, profit, taxReserve, netEarnings: profit - taxReserve };
}

export function profileOf(shop: {
  vatRate: string;
  incomeTaxRate: string;
  incomeTaxBrackets: TaxBracket[] | null;
  socialSecurityRate: string;
  taxBase: "revenue" | "profit";
}): TaxProfile {
  return {
    vatRate: Number(shop.vatRate),
    incomeTaxRate: Number(shop.incomeTaxRate),
    brackets: shop.incomeTaxBrackets,
    socialRate: Number(shop.socialSecurityRate),
    taxBase: shop.taxBase,
  };
}

/** First-of-month key ("2026-10-01") of an instant, in the given timezone. */
export function monthKeyOf(date: Date, timeZone: string): string {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit" })
    .formatToParts(date);
  const get = (t: string) => parts.find((p) => p.type === t)!.value;
  return `${get("year")}-${get("month")}-01`;
}

/** Inclusive list of month keys between two keys. */
export function monthRange(from: string, to: string): string[] {
  const out: string[] = [];
  let [y, m] = from.split("-").map(Number);
  const [ty, tm] = to.split("-").map(Number);
  while (y < ty || (y === ty && m <= tm)) {
    out.push(`${y}-${String(m).padStart(2, "0")}-01`);
    if (++m > 12) {
      m = 1;
      y++;
    }
  }
  return out;
}
