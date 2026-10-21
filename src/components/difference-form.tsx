"use client";

import { useActionState, useState } from "react";
import type { DifferenceState } from "@/lib/actions";
import { buttonClass, inputClass, primaryButtonClass } from "./ui";

interface Props {
  productId: number;
  pieces: number;
  locale: string;
  currency: string;
  vatRate: number; // the shop's rate, the default for purchases
  labels: Record<"vatWith" | "vatWithout" | "rate" | "total" | "summary" | "restock" | "adjust" | "working" | "done" | "invalid" | "tooHigh" | "gone", string>;
  action: (prev: DifferenceState, formData: FormData) => Promise<DifferenceState>;
}

/** Pieces that came in unrecorded: the quantities are read-only; only the total paid is entered. */
export function DifferenceForm({ productId, pieces, locale, currency, vatRate, labels, action }: Props) {
  const [state, formAction, pending] = useActionState(action, { status: "idle" } as DifferenceState);
  const [total, setTotal] = useState("");
  const [withVat, setWithVat] = useState(true);
  const [rate, setRate] = useState(String(vatRate));
  const n = Number(total.replace(",", "."));
  const r = Number(rate.replace(",", "."));
  const rateOk = r >= 0 && r <= 100;
  // What is typed is with or without VAT: the cash out is the gross, the cost per piece the net.
  const gross = withVat ? n : n * (1 + r / 100);
  const net = withVat ? n / (1 + r / 100) : n;
  const money = new Intl.NumberFormat(locale, { style: "currency", currency, useGrouping: "always" });
  const msg = state.status === "ok" ? labels.done : { invalid: labels.invalid, tooHigh: labels.tooHigh, gone: labels.gone, idle: "" }[state.status];

  return (
    <form action={formAction} className="space-y-2">
      <input type="hidden" name="productId" value={productId} />
      <input type="hidden" name="vatMode" value={withVat ? "with" : "without"} />
      <div className="flex flex-wrap items-center gap-3">
        <div className="inline-flex rounded-lg border border-line p-0.5 text-sm" role="group">
          {([true, false] as const).map((v) => (
            <button
              key={String(v)}
              type="button"
              onClick={() => setWithVat(v)}
              className={`rounded-md px-3 py-1 ${withVat === v ? "bg-surface-2 font-medium" : "text-muted"}`}
            >
              {v ? labels.vatWith : labels.vatWithout}
            </button>
          ))}
        </div>
        <label className="flex shrink-0 items-center gap-1.5 whitespace-nowrap text-sm">
          <span className="text-muted">{labels.rate}</span>
          <input
            name="vatRate"
            type="number"
            min="0"
            max="100"
            step="0.01"
            required
            value={rate}
            onChange={(e) => setRate(e.target.value)}
            className={`${inputClass} w-20`}
          />
        </label>
      </div>
      <label className="flex max-w-xs flex-col gap-1 text-sm">
        {labels.total}
        <input
          name="total"
          type="number"
          min="0.01"
          step="0.01"
          value={total}
          onChange={(e) => setTotal(e.target.value)}
          className={inputClass}
        />
      </label>
      <div className="flex flex-wrap items-center gap-2">
        <button type="submit" name="kind" value="restock" disabled={pending || !(n > 0) || !rateOk} className={`${primaryButtonClass} disabled:opacity-50`}>
          {pending ? labels.working : labels.restock}
        </button>
        <button type="submit" name="kind" value="adjust" disabled={pending} className={`${buttonClass} disabled:opacity-50`} formNoValidate>
          {labels.adjust}
        </button>
      </div>
      <div className="text-sm empty:hidden">
        {n > 0 && rateOk && pieces > 0 && (
          <span className="tabular-nums text-muted">
            {labels.summary
              .replace("{n}", String(pieces))
              .replace("{unit}", money.format(net / pieces))
              .replace("{net}", money.format(net))
              .replace("{vat}", money.format(gross - net))
              .replace("{gross}", money.format(gross))}
          </span>
        )}
        {msg && !pending && <span className={`ml-3 ${state.status === "ok" ? "text-good" : "text-bad"}`}>{msg}</span>}
      </div>
    </form>
  );
}
