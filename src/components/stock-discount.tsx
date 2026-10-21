"use client";

import Link from "next/link";
import { useState } from "react";
import { discountResult, toCent } from "@/lib/discount";

const LEVELS = [0, 10, 20, 30, 40, 50, 60, 70, 80, 90, 100];

interface Props {
  price: number | null; // list price, VAT included
  cost: number | null; // unit cost, VAT excluded
  vatRate: number;
  taxPct: number; // share of an extra euro of profit that goes to income tax and contributions
  locale: string;
  currency: string;
  labels: Record<string, string>;
}

/** The body of the discount simulator popup: pick a discount, read what is left in the pocket and why. */
export function DiscountSimulator({ price, cost, vatRate, taxPct, locale, currency, labels: t }: Props) {
  const [pct, setPct] = useState(0);
  if (price == null || cost == null) return <p className="text-sm text-muted">{t.missing}</p>;

  const money = new Intl.NumberFormat(locale, { style: "currency", currency, useGrouping: "always" });
  const num = new Intl.NumberFormat(locale, { maximumFractionDigits: 1 });
  const input = { costGross: 0, priceGross: price, vatRate, marginalTaxPct: taxPct, shippingPaidGross: 0, shippingChargedGross: 0, otherCostsNet: cost };
  const full = discountResult(input, 0);
  const sim = discountResult(input, pct);
  const m = (n: number) => money.format(toCent(n));
  const tone = (n: number) => (toCent(n) < 0 ? "text-bad" : "");
  const fill = (text: string) =>
    text.replace(/\{n\}/g, String(pct)).replace(/\{v\}/g, num.format(vatRate)).replace(/\{t\}/g, num.format(taxPct));

  const th = "py-2 pr-3 text-right text-xs font-medium uppercase leading-tight tracking-wide text-muted";
  const step = (label: string, value: string, opts: { strong?: boolean; negative?: boolean; className?: string } = {}) => (
    <div className={`flex items-baseline justify-between gap-4 py-1.5 ${opts.strong ? "border-t border-line font-semibold" : ""}`}>
      <span className={opts.strong ? "" : "text-muted"}>{label}</span>
      <span className={`tabular-nums ${opts.className ?? ""}`}>{value}</span>
    </div>
  );

  return (
    <div className="space-y-6 text-sm">
      <p className="text-muted">{t.intro}</p>

      <div>
        <div className="mb-2 font-medium">{t.discount}</div>
        <div className="flex flex-wrap gap-1" role="group" aria-label={t.discount}>
          {LEVELS.map((d) => (
            <button
              key={d}
              type="button"
              onClick={() => setPct(d)}
              aria-pressed={pct === d}
              className={`rounded-lg border px-3 py-1.5 tabular-nums transition ${
                pct === d ? "border-accent bg-accent-soft font-semibold text-ink" : "border-line bg-surface text-muted hover:text-ink"
              }`}
            >
              {d}%
            </button>
          ))}
        </div>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full min-w-[40rem] table-fixed">
          <thead>
            <tr className="border-b border-line align-bottom">
              <th className={th}>{t.cost}</th>
              <th className={th}>{t.list}</th>
              <th className={th}>{t.profit}</th>
              <th className={th}>{t.afterTax}</th>
              <th className={`${th} pr-0 text-accent`}>{fill(t.simulated)}</th>
            </tr>
          </thead>
          <tbody>
            <tr className="tabular-nums">
              <td className="py-3 pr-3 text-right">{m(cost)}</td>
              <td className="py-3 pr-3 text-right">{m(price)}</td>
              <td className={`py-3 pr-3 text-right ${tone(full.profitBeforeTax)}`}>{m(full.profitBeforeTax)}</td>
              <td className={`py-3 pr-3 text-right font-semibold ${tone(full.profitAfterTax)}`}>{m(full.profitAfterTax)}</td>
              <td className={`py-3 text-right font-semibold ${toCent(sim.profitAfterTax) < 0 ? "text-bad" : "text-accent"}`}>{m(sim.profitAfterTax)}</td>
            </tr>
          </tbody>
        </table>
      </div>

      <div className="rounded-xl border border-line bg-surface-2 p-4">
        <h3 className="mb-2 font-semibold">{fill(t.stepsTitle)}</h3>
        {step(t.stepList, m(price))}
        {step(fill(t.stepDiscount), m(sim.priceGross))}
        {step(fill(t.stepNet), m(sim.netRevenue))}
        {step(t.stepCost, `− ${m(cost)}`)}
        {step(t.stepProfit, m(sim.profitBeforeTax), { strong: true, className: tone(sim.profitBeforeTax) })}
        {step(fill(t.stepTax), `${sim.tax < 0 ? "+" : "−"} ${m(Math.abs(sim.tax))}`)}
        {step(t.stepResult, m(sim.profitAfterTax), { strong: true, className: toCent(sim.profitAfterTax) < 0 ? "text-bad" : "text-accent" })}
      </div>

      <ul className="list-disc space-y-1.5 pl-5 text-xs text-muted">
        <li>{t.noteVat}</li>
        <li>{fill(t.noteTax)}</li>
        <li>{t.noteCost}</li>
        <li>{t.noteGift}</li>
        <li>
          {t.noteScope}{" "}
          <Link href="/calculator" className="underline">
            {t.noteCalculator}
          </Link>
        </li>
      </ul>
    </div>
  );
}
