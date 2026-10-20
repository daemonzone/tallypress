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
  incomeTaxRate: number; // percent, set aside as a reserve
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

export function figures(gross: number, cogs: number, p: TaxProfile): Figures {
  const vat = Math.round((gross * p.vatRate) / (100 + p.vatRate));
  const netRevenue = gross - vat;
  const profit = netRevenue - cogs;
  const base = p.taxBase === "profit" ? Math.max(profit, 0) : netRevenue;
  const taxReserve = Math.round((base * p.incomeTaxRate) / 100);
  return { gross, vat, netRevenue, cogs, profit, taxReserve, netEarnings: profit - taxReserve };
}

export function profileOf(shop: {
  vatRate: string;
  incomeTaxRate: string;
  taxBase: "revenue" | "profit";
}): TaxProfile {
  return {
    vatRate: Number(shop.vatRate),
    incomeTaxRate: Number(shop.incomeTaxRate),
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
