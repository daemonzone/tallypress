"use client";

import { createContext, useContext, useState, type ReactNode } from "react";
import { discountResult, toCent } from "@/lib/discount";

const LEVELS = [0, 10, 20, 30, 40, 50, 60, 70, 80, 90, 100];

interface Ctx {
  pct: number;
  set: (pct: number) => void;
  vatRate: number;
  taxPct: number;
  locale: string;
  currency: string;
}

const DiscountContext = createContext<Ctx | null>(null);
const useDiscount = () => {
  const c = useContext(DiscountContext);
  if (!c) throw new Error("DiscountProvider is missing");
  return c;
};

/** Holds the discount picked for the list: the buttons set it, the "discounted" column reads it. */
export function DiscountProvider({
  vatRate,
  taxPct,
  locale,
  currency,
  initial = 0,
  children,
}: Omit<Ctx, "pct" | "set"> & { initial?: number; children: ReactNode }) {
  const [pct, set] = useState(initial);
  return <DiscountContext.Provider value={{ pct, set, vatRate, taxPct, locale, currency }}>{children}</DiscountContext.Provider>;
}

export function DiscountButtons({ label, note }: { label: string; note: string }) {
  const { pct, set } = useDiscount();
  return (
    <div className="mb-4 flex flex-wrap items-center gap-x-4 gap-y-2">
      <span className="text-sm font-medium">{label}</span>
      <div className="inline-flex flex-wrap gap-1" role="group" aria-label={label}>
        {LEVELS.map((d) => (
          <button
            key={d}
            type="button"
            onClick={() => set(d)}
            aria-pressed={pct === d}
            className={`rounded-lg border px-3 py-1.5 text-sm tabular-nums transition ${
              pct === d ? "border-accent bg-accent-soft font-semibold text-ink" : "border-line bg-surface text-muted hover:text-ink"
            }`}
          >
            {d === 0 ? "0%" : `−${d}%`}
          </button>
        ))}
      </div>
      <span className="text-xs text-muted">{note}</span>
    </div>
  );
}

/** A column title that carries the discount picked: "{n}" in the label is replaced by the percentage. */
export function DiscountHeader({ label }: { label: string }) {
  const { pct } = useDiscount();
  return <div className="text-right text-accent">{label.replace("{n}", String(pct))}</div>;
}

/** The list price after the chosen discount (VAT included): a simulation, in the accent colour. */
export function DiscountedPriceCell({ price }: { price: number | null }) {
  const { pct, locale, currency } = useDiscount();
  if (price == null) return <div className="text-right text-muted">—</div>;
  const money = new Intl.NumberFormat(locale, { style: "currency", currency, useGrouping: "always" });
  return <div className="text-right tabular-nums text-accent">{money.format(toCent(price * (1 - pct / 100)))}</div>;
}

/** What one piece leaves in the pocket at the chosen discount (VAT and tax out): a simulation, so it has its own colour. */
export function DiscountedCell({ price, cost }: { price: number | null; cost: number | null }) {
  const { pct, vatRate, taxPct, locale, currency } = useDiscount();
  if (price == null || cost == null) return <div className="text-right text-muted">—</div>;
  const r = discountResult(
    { costGross: 0, priceGross: price, vatRate, marginalTaxPct: taxPct, shippingPaidGross: 0, shippingChargedGross: 0, otherCostsNet: cost },
    pct,
  );
  const money = new Intl.NumberFormat(locale, { style: "currency", currency, useGrouping: "always" });
  const value = toCent(r.profitAfterTax);
  return (
    <div className={`text-right font-medium tabular-nums ${value < 0 ? "text-bad" : "text-accent"}`}>{money.format(value)}</div>
  );
}
