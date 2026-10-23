"use client";

import { useState } from "react";
import { StackedBar, VIZ } from "./charts";
import { formatters } from "./format";
import { Icon } from "./icons";
import { buttonClass, inputClass } from "./ui";

interface Props {
  locale: string;
  currency: string;
  defaultPct: number;
  /** All amounts in cents. */
  net: number;
  withdrawn: number;
  cash: number;
  vat: number;
  tax: number;
  labels: {
    title: string;
    help: string;
    pct: string;
    allowance: string;
    withdrawn: string;
    remaining: string;
    restock: string;
    restockHelp: string;
    shortfall: string;
    locked: string;
    maxNote: string; // "{pct}"
    saveDefault: string;
    default: string;
    allocTitle: string;
    vat: string;
    tax: string;
  };
  saveAction: (formData: FormData) => void | Promise<void>;
}

/**
 * A live "what if" calculator: the percentage only changes what is shown here. It is
 * written to the shop only when "Save as default" is pressed.
 */
export function Simulator({ locale, currency, defaultPct, net, withdrawn, cash, vat, tax, labels, saveAction }: Props) {
  const { money, pct: pctFmt } = formatters(locale, currency);

  // Money can only be taken from what is really there: what is left once VAT and taxes are set aside.
  // The share can't go above what that covers (counting what was already withdrawn); with nothing left
  // there is no share to choose at all.
  const free = cash - vat - tax;
  const maxPct = net > 0 && free + withdrawn > 0 ? Math.min(100, Math.floor(((free + withdrawn) / net) * 100)) : 0;
  const locked = maxPct === 0;
  const [chosen, setPct] = useState(defaultPct);
  const pct = Math.min(chosen, maxPct);

  const allowance = Math.round((Math.max(net, 0) * pct) / 100);
  const remaining = Math.max(allowance - withdrawn, 0);
  const restock = cash - vat - tax - remaining;

  const segments = [
    { key: "available", label: labels.restock, value: Math.max(restock, 0), slot: VIZ.mine, display: money(Math.max(restock, 0)) },
    { key: "vat", label: labels.vat, value: vat, slot: VIZ.vat, display: money(vat) },
    { key: "tax", label: labels.tax, value: tax, slot: VIZ.tax, display: money(tax) },
    { key: "personal", label: labels.remaining, value: remaining, slot: VIZ.personal, display: money(remaining) },
  ];

  return (
    <details open className="group rounded-2xl border border-line bg-surface p-5 shadow-card">
      <summary className="flex cursor-pointer list-none items-center justify-between gap-3 [&::-webkit-details-marker]:hidden">
        <h3 className="text-base font-semibold tracking-tight">{labels.title}</h3>
        <Icon name="chevron" className="h-4 w-4 shrink-0 text-muted transition group-open:rotate-180" />
      </summary>
      <p className="mb-4 mt-0.5 text-xs text-muted">{labels.help}</p>

      <form action={saveAction} className="mb-5">
        <label htmlFor="pct" className="mb-2 block text-sm text-muted">
          {labels.pct}
        </label>
        <input
          type="range"
          min={0}
          max={Math.max(maxPct, 1)}
          step={1}
          value={pct}
          disabled={locked}
          onChange={(e) => setPct(Number(e.target.value))}
          className="mb-3 h-2 w-full cursor-pointer accent-[var(--accent)] disabled:cursor-not-allowed disabled:opacity-40"
          aria-label={labels.pct}
        />
        <div className="flex items-center gap-2">
          <input
            id="pct"
            name="pct"
            type="number"
            min={0}
            max={maxPct}
            step="0.5"
            value={pct}
            disabled={locked}
            onChange={(e) => setPct(Math.min(maxPct, Math.max(0, Number(e.target.value) || 0)))}
            className={`${inputClass} w-20 text-right disabled:opacity-50`}
          />
          <span className="text-sm text-muted">%</span>
          <button type="submit" className={`${buttonClass} ml-auto`} disabled={locked || pct === defaultPct}>
            {labels.saveDefault}
          </button>
        </div>
        <p className="mt-1.5 text-xs text-muted">
          {labels.default}: {defaultPct}%
        </p>
        {locked ? (
          <p className="mt-2 text-xs font-medium text-bad">{labels.locked}</p>
        ) : (
          maxPct < 100 && <p className="mt-2 text-xs text-muted">{labels.maxNote.replace("{pct}", String(maxPct))}</p>
        )}
      </form>

      <div className="mb-5 rounded-xl bg-surface-2 p-4">
        <div className="text-xs font-medium text-muted">
          {restock < 0 ? labels.shortfall : labels.restock}
        </div>
        <div
          className={`mt-1 flex items-center gap-2 text-3xl font-semibold tracking-tight ${restock < 0 ? "text-bad" : ""}`}
        >
          {restock < 0 && <Icon name="alert" className="h-6 w-6" />}
          {money(Math.abs(restock))}
        </div>
        <p className="mt-1 text-xs text-muted">{labels.restockHelp}</p>
      </div>

      <h4 className="mb-2 text-sm font-medium">{labels.allocTitle}</h4>
      <StackedBar segments={segments} title={labels.allocTitle} percent={pctFmt} compact />

      <table className="mt-4 w-full text-sm">
        <tbody className="divide-y divide-line">
          {[
            [labels.allowance, money(allowance)],
            [labels.withdrawn, money(withdrawn)],
            [labels.remaining, money(remaining)],
          ].map(([label, value]) => (
            <tr key={label}>
              <th scope="row" className="py-2 pr-4 text-left font-normal text-muted">
                {label}
              </th>
              <td className="py-2 text-right tabular-nums">{value}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </details>
  );
}
