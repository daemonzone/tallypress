"use client";

import { useState } from "react";
import { formatters } from "./format";
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
    saveDefault: string;
    default: string;
  };
  saveAction: (formData: FormData) => void | Promise<void>;
}

/**
 * A live "what if" calculator: the percentage only changes what is shown here. It is
 * written to the shop only when "Save as default" is pressed.
 */
export function Simulator({ locale, currency, defaultPct, net, withdrawn, cash, vat, tax, labels, saveAction }: Props) {
  const [pct, setPct] = useState(defaultPct);
  const { money } = formatters(locale, currency);

  const allowance = Math.round((Math.max(net, 0) * pct) / 100);
  const remaining = Math.max(allowance - withdrawn, 0);
  const restock = cash - vat - tax - remaining;

  const rows: [string, string, boolean?][] = [
    [labels.allowance, money(allowance)],
    [labels.withdrawn, money(withdrawn)],
    [labels.remaining, money(remaining)],
    [restock < 0 ? labels.shortfall : labels.restock, money(Math.abs(restock)), true],
  ];

  return (
    <div className="rounded border border-black/20 p-4 dark:border-white/20">
      <h3 className="font-medium">{labels.title}</h3>
      <p className="mb-3 text-xs opacity-70">{labels.help}</p>

      <form action={saveAction} className="mb-4 flex flex-wrap items-center gap-3">
        <label htmlFor="pct" className="text-sm">
          {labels.pct}
        </label>
        <input
          type="range"
          min={0}
          max={100}
          step={1}
          value={pct}
          onChange={(e) => setPct(Number(e.target.value))}
          className="w-40"
          aria-label={labels.pct}
        />
        <input
          id="pct"
          name="pct"
          type="number"
          min={0}
          max={100}
          step="0.5"
          value={pct}
          onChange={(e) => setPct(Math.min(100, Math.max(0, Number(e.target.value) || 0)))}
          className={`${inputClass} w-20 text-right`}
        />
        <span className="text-sm">%</span>
        <button type="submit" className={buttonClass} disabled={pct === defaultPct}>
          {labels.saveDefault}
        </button>
        <span className="text-xs opacity-60">
          {labels.default}: {defaultPct}%
        </span>
      </form>

      <table className="w-full text-sm">
        <tbody className="divide-y divide-black/10 dark:divide-white/10">
          {rows.map(([label, value, strong]) => (
            <tr key={label} className={strong ? "font-semibold" : undefined}>
              <th scope="row" className="py-2 pr-4 text-left font-normal">
                {label}
              </th>
              <td className={`py-2 text-right tabular-nums ${strong && restock < 0 ? "text-red-600 dark:text-red-400" : ""}`}>
                {value}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="mt-2 text-xs opacity-60">{labels.restockHelp}</p>
    </div>
  );
}
