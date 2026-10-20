// Plain functions so both server and client components can use them.

export function formatters(locale: string, currency: string) {
  const cur = new Intl.NumberFormat(locale, { style: "currency", currency });
  const num = new Intl.NumberFormat(locale, { maximumFractionDigits: 3 });
  const pct = new Intl.NumberFormat(locale, { style: "percent", maximumFractionDigits: 1 });
  return {
    money: (cents: number) => cur.format(cents / 100),
    num: (n: number) => num.format(n),
    pct: (ratio: number) => pct.format(ratio),
  };
}

export type Formatters = ReturnType<typeof formatters>;

/** "2026-09-01" -> "September 2026" (or "settembre 2026"). */
export function monthLabel(key: string, locale: string): string {
  return new Intl.DateTimeFormat(locale, { month: "long", year: "numeric", timeZone: "UTC" }).format(
    new Date(`${key}T00:00:00Z`),
  );
}

/** Route for a month: the current one lives at "/". */
export const monthHref = (key: string, currentKey: string) =>
  key === currentKey ? "/" : `/month/${key.slice(0, 7)}`;
