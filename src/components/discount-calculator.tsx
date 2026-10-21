"use client";

import { useState } from "react";
import { breakEvenDiscount, discountResult, giftResult, marginalTaxPct } from "@/lib/discount";
import { Card, inputClass } from "./ui";

export interface Bracket {
  rate: number; // percent
  upTo: number | null; // yearly income, null = no ceiling
}

interface Props {
  locale: string;
  currency: string;
  defaults: { vatRate: number; socialRate: number; socialDeductible: boolean; brackets: Bracket[] };
  labels: Record<string, string>;
}

const LEVELS = [0, 20, 30, 50, 70];

const num = (v: string) => {
  const n = Number(v.replace(",", "."));
  return Number.isFinite(n) && n >= 0 ? n : 0;
};

/** What is left in the shop's pocket from one item at different discounts, and whether giving it away would be better. */
export function DiscountCalculator({ locale, currency, defaults, labels: t }: Props) {
  const [cost, setCost] = useState("10");
  const [price, setPrice] = useState("30");
  const [vat, setVat] = useState(String(defaults.vatRate));
  const [bracket, setBracket] = useState(0);
  const [shipPaid, setShipPaid] = useState("0");
  const [shipCharged, setShipCharged] = useState("0");
  const [other, setOther] = useState("0");
  const [deductible, setDeductible] = useState(false);
  const [custom, setCustom] = useState(50);

  const money = new Intl.NumberFormat(locale, { style: "currency", currency, useGrouping: "always" });
  const pct = new Intl.NumberFormat(locale, { maximumFractionDigits: 1 });
  const tax = marginalTaxPct(defaults.socialRate, defaults.brackets[bracket]?.rate ?? 0, defaults.socialDeductible);
  const input = {
    costGross: num(cost),
    priceGross: num(price),
    vatRate: num(vat),
    marginalTaxPct: tax,
    shippingPaidGross: num(shipPaid),
    shippingChargedGross: num(shipCharged),
    otherCostsNet: num(other),
  };
  const levels = [...new Set([...LEVELS, custom])].sort((a, b) => a - b);
  const rows = levels.map((d) => discountResult(input, d));
  const sel = discountResult(input, custom);
  const gift = giftResult(input, deductible);
  const breakEven = breakEvenDiscount(input);
  const neg = (n: number) => (n < -0.005 ? "text-bad" : "");

  const field = (label: string, value: string, set: (v: string) => void, step = "0.01") => (
    <label className="flex flex-col gap-1 text-sm">
      {label}
      <input type="number" min="0" step={step} value={value} onChange={(e) => set(e.target.value)} className={inputClass} />
    </label>
  );

  return (
    <div className="space-y-6">
      <Card>
        <div className="grid grid-cols-[repeat(auto-fill,minmax(14rem,1fr))] gap-4">
          {field(t.cost, cost, setCost)}
          {field(t.price, price, setPrice)}
          {field(t.vat, vat, setVat, "0.1")}
          <label className="flex flex-col gap-1 text-sm">
            {t.bracket}
            <select value={bracket} onChange={(e) => setBracket(Number(e.target.value))} className={inputClass}>
              {defaults.brackets.map((b, n) => (
                <option key={n} value={n}>
                  {b.rate}% {b.upTo == null ? t.noCeiling : t.upTo.replace("{n}", new Intl.NumberFormat(locale, { useGrouping: "always" }).format(b.upTo))}
                </option>
              ))}
            </select>
          </label>
          {field(t.shipPaid, shipPaid, setShipPaid)}
          {field(t.shipCharged, shipCharged, setShipCharged)}
          {field(t.other, other, setOther)}
        </div>
        <p className="mt-3 text-xs text-muted">{t.taxNote.replace("{n}", pct.format(tax))}</p>
      </Card>

      <Card>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[40rem] text-sm">
            <thead>
              <tr className="border-b border-line text-xs uppercase tracking-wide text-muted">
                <th className="py-2 pr-3 text-left font-medium">{t.discount}</th>
                <th className="py-2 pr-3 text-right font-medium">{t.priceCol}</th>
                <th className="py-2 pr-3 text-right font-medium">{t.vatCol}</th>
                <th className="py-2 pr-3 text-right font-medium">{t.revenueCol}</th>
                <th className="py-2 pr-3 text-right font-medium">{t.costCol}</th>
                <th className="py-2 pr-3 text-right font-medium">{t.profitCol}</th>
                <th className="py-2 pr-3 text-right font-medium">{t.taxCol}</th>
                <th className="py-2 text-right font-medium">{t.pocketCol}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line tabular-nums">
              {rows.map((r) => (
                <tr key={r.discountPct} className={r.discountPct === custom && !LEVELS.includes(custom) ? "bg-accent-soft" : ""}>
                  <td className="py-2 pr-3 font-medium">{r.discountPct === 0 ? t.fullPrice : `−${pct.format(r.discountPct)}%`}</td>
                  <td className="py-2 pr-3 text-right">{money.format(r.priceGross)}</td>
                  <td className="py-2 pr-3 text-right text-muted">{money.format(r.vat)}</td>
                  <td className="py-2 pr-3 text-right">{money.format(r.netRevenue)}</td>
                  <td className="py-2 pr-3 text-right">{money.format(r.netCost)}</td>
                  <td className={`py-2 pr-3 text-right ${neg(r.profitBeforeTax)}`}>{money.format(r.profitBeforeTax)}</td>
                  <td className="py-2 pr-3 text-right text-muted">{money.format(r.tax)}</td>
                  <td className={`py-2 text-right font-semibold ${neg(r.profitAfterTax)}`}>{money.format(r.profitAfterTax)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>

      <Card>
        <div className="grid gap-6 md:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
          <div>
            <label className="flex flex-col gap-2 text-sm">
              <span>
                {t.customDiscount}: <strong className="tabular-nums">−{custom}%</strong>
              </span>
              <input type="range" min="0" max="100" step="1" value={custom} onChange={(e) => setCustom(Number(e.target.value))} />
            </label>
            <p className="mt-3 text-sm">
              {t.breakEven.replace("{n}", pct.format(breakEven))}
            </p>
            <label className="mt-3 flex items-center gap-2 text-sm">
              <input type="checkbox" checked={deductible} onChange={(e) => setDeductible(e.target.checked)} />
              {t.giftDeductible}
            </label>
          </div>
          <div className="space-y-2 text-sm">
            <div className="flex items-baseline justify-between gap-3">
              <span>{t.sellAt.replace("{n}", String(custom))}</span>
              <strong className={`text-xl tabular-nums ${neg(sel.profitAfterTax)}`}>{money.format(sel.profitAfterTax)}</strong>
            </div>
            <div className="flex items-baseline justify-between gap-3">
              <span>{t.giveAway}</span>
              <strong className={`text-xl tabular-nums ${neg(gift)}`}>{money.format(gift)}</strong>
            </div>
            <p className="border-t border-line pt-2 text-muted">
              {sel.profitAfterTax > gift
                ? t.sellWins.replace("{n}", money.format(sel.profitAfterTax - gift))
                : t.giftWins.replace("{n}", money.format(gift - sel.profitAfterTax))}
            </p>
          </div>
        </div>
        <p className="mt-4 text-xs text-muted">{t.giftNote}</p>
      </Card>
    </div>
  );
}
