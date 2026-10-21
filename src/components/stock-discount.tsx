"use client";

import Link from "next/link";
import { useState } from "react";
import { discountResult, toCent } from "@/lib/discount";
import { Thumb } from "./thumb";

const LEVELS = [0, 10, 20, 30, 40, 50, 60, 70, 80, 90, 100];

interface Props {
  info: { cost: string; list: string; shop: string; discount: string }; // what the product row shows, already formatted
  name: string;
  imageUrl: string | null;
  price: number | null; // list price, VAT included
  cost: number | null; // unit cost, VAT excluded
  vatRate: number;
  taxPct: number; // share of an extra euro of profit that goes to income tax and contributions
  currentDiscount: number | null; // the discount the product is on sale at today (a ratio), null when none
  mixed: boolean; // the variations are not all at the same discount
  locale: string;
  currency: string;
  labels: Record<string, string>;
}

/** The body of the discount simulator popup: pick a discount, read what is left in the pocket and why. */
export function DiscountSimulator({ info, name, imageUrl, price, cost, vatRate, taxPct, currentDiscount, mixed, locale, currency, labels: t }: Props) {
  // A product already on sale starts at its current discount: a standard button when it matches one,
  // else an extra button (e.g. 65% or 65,5%) placed between its neighbours.
  const current = currentDiscount == null ? null : Math.round(currentDiscount * 1000) / 10;
  const matching = current == null ? undefined : LEVELS.find((l) => Math.abs(l - current) < 0.05);
  const extra = current != null && matching == null ? current : null;
  const levels = extra == null ? LEVELS : [...LEVELS, extra].sort((a, b) => a - b);
  const [pct, setPct] = useState(matching ?? current ?? 0);
  if (price == null || cost == null) return <p className="text-sm text-muted">{t.missing}</p>;

  const money = new Intl.NumberFormat(locale, { style: "currency", currency, useGrouping: "always" });
  const num = new Intl.NumberFormat(locale, { maximumFractionDigits: 1 });
  const input = { costGross: 0, priceGross: price, vatRate, marginalTaxPct: taxPct, shippingPaidGross: 0, shippingChargedGross: 0, otherCostsNet: cost };
  const full = discountResult(input, 0);
  const sim = discountResult(input, pct);
  const m = (n: number) => money.format(toCent(n));
  const tone = (n: number) => (toCent(n) < 0 ? "text-bad" : "");
  const fill = (text: string) =>
    text.replace(/\{n\}/g, num.format(pct)).replace(/\{v\}/g, num.format(vatRate)).replace(/\{t\}/g, num.format(taxPct));

  const th = "py-2 pr-3 text-right text-xs font-medium uppercase leading-tight tracking-wide text-muted";
  const step = (label: string, value: string, opts: { bold?: boolean; blue?: boolean; valueClass?: string } = {}) => (
    <div className="flex items-baseline justify-between gap-4 py-2">
      <span className={opts.blue ? "text-accent" : opts.bold ? "font-semibold" : "text-muted"}>{label}</span>
      <span className={`tabular-nums ${opts.blue ? "text-accent" : ""} ${opts.bold ? "font-semibold" : ""} ${opts.valueClass ?? ""}`}>{value}</span>
    </div>
  );

  return (
    <div className="space-y-6 text-sm">
      <div className="overflow-x-auto">
        <div className="grid min-w-[42rem] grid-cols-[minmax(10rem,1fr)_8rem_8rem_8rem_8.5rem] items-center gap-x-3 gap-y-2">
          <div />
          <div className={`${th} self-end`}>{t.cost}</div>
          <div className={`${th} self-end`}>{t.list}</div>
          <div className={`${th} self-end`}>{t.shopNow}</div>
          <div className={`${th} self-end pr-0`}>{t.discountNow}</div>
          <div className="flex items-center gap-4">
            <Thumb src={imageUrl} alt={name} size="lg" />
            <div className="text-xl font-semibold tracking-tight">{name}</div>
          </div>
          <div className="whitespace-nowrap pr-3 text-right tabular-nums">{info.cost}</div>
          <div className="whitespace-nowrap pr-3 text-right tabular-nums">{info.list}</div>
          <div className="whitespace-nowrap pr-3 text-right font-semibold tabular-nums">{info.shop}</div>
          <div className="whitespace-nowrap text-right tabular-nums">{info.discount}</div>
        </div>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full min-w-[28rem] table-fixed">
          <thead>
            <tr className="border-b border-ink/25 align-bottom">
              <th className={th}>{t.profit}</th>
              <th className={th}>{t.afterTax}</th>
              <th className={`${th} pr-0 text-accent`}>{fill(t.simulated)}</th>
            </tr>
          </thead>
          <tbody>
            <tr className="tabular-nums">
              <td className={`py-3 pr-3 text-right ${tone(full.profitBeforeTax)}`}>{m(full.profitBeforeTax)}</td>
              <td className={`py-3 pr-3 text-right font-semibold ${tone(full.profitAfterTax)}`}>{m(full.profitAfterTax)}</td>
              <td className={`py-3 text-right font-semibold ${toCent(sim.profitAfterTax) < 0 ? "text-bad" : "text-accent"}`}>{m(sim.profitAfterTax)}</td>
            </tr>
          </tbody>
        </table>
      </div>

      <div className="space-y-4 text-center">
        <p className="text-balance">
          <strong>{t.introBold}</strong>
          {t.introRest}
          <br />
          <em className="text-muted">{t.introNote}</em>
        </p>
        <div className="flex flex-wrap justify-center gap-1" role="group" aria-label={t.introBold}>
          {levels.map((d) => (
            <button
              key={d}
              type="button"
              onClick={() => setPct(d)}
              aria-pressed={pct === d}
              title={d === extra ? t.currentButton : undefined}
              className={`rounded-lg border px-3 py-1.5 tabular-nums transition ${
                pct === d ? "border-accent bg-accent-soft font-semibold text-ink" : "border-line bg-surface text-muted hover:text-ink"
              }`}
            >
              {num.format(d)}%
            </button>
          ))}
        </div>
        {current != null && (
          <p className="text-xs text-muted">
            {t.currentNote.replace("{n}", num.format(current))}
            {mixed ? ` ${t.currentMixed}` : ""}
          </p>
        )}
      </div>

      <div className="rounded-xl border border-ink/20 bg-surface-2 px-4 py-3">
        <h3 className="mb-2 text-lg font-semibold tracking-tight">{fill(t.stepsTitle)}</h3>
        <div className="divide-y divide-ink/20">
          {step(t.stepList, m(price), { bold: true })}
          {step(fill(t.stepDiscount), m(sim.priceGross), { blue: true })}
          {step(fill(t.stepNet), m(sim.netRevenue))}
          {step(t.stepCost, `− ${m(cost)}`)}
          {step(t.stepProfit, m(sim.profitBeforeTax), { valueClass: tone(sim.profitBeforeTax) })}
          {step(fill(t.stepTax), `${sim.tax < 0 ? "+" : "−"} ${m(Math.abs(sim.tax))}`)}
          {step(t.stepResult, m(sim.profitAfterTax), { bold: true, valueClass: toCent(sim.profitAfterTax) < 0 ? "text-bad" : "text-accent" })}
        </div>
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
