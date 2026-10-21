"use client";

import { useActionState, useState } from "react";
import type { ProductRestockState } from "@/lib/actions";
import { inputClass, primaryButtonClass } from "./ui";

interface Props {
  productId: number;
  variants: { id: string; label: string }[];
  locale: string;
  currency: string;
  labels: Record<
    | "perUnit" | "total" | "amountUnit" | "amountTotal" | "qty" | "summary" | "submit" | "working"
    | "done" | "invalid" | "noQty" | "tooHigh" | "help",
    string
  >;
  action: (prev: ProductRestockState, formData: FormData) => Promise<ProductRestockState>;
}

/** A restock of one product: a cost per piece, or the total paid; the average is computed, never typed. */
export function ProductRestockForm({ productId, variants, locale, currency, labels, action }: Props) {
  const [state, formAction, pending] = useActionState(action, { status: "idle" } as ProductRestockState);
  const [mode, setMode] = useState<"unit" | "total">("unit");
  const [amount, setAmount] = useState("");
  const [qty, setQty] = useState<Record<string, string>>({});

  const pieces = Object.values(qty).reduce((sum, v) => sum + (Number(v) > 0 ? Math.floor(Number(v)) : 0), 0);
  const n = Number(amount.replace(",", "."));
  const total = mode === "total" ? n : n * pieces;
  const unit = pieces > 0 ? total / pieces : 0;
  const money = new Intl.NumberFormat(locale, { style: "currency", currency, useGrouping: "always" });
  const msg = state.status === "ok" ? labels.done : { invalid: labels.invalid, noQty: labels.noQty, tooHigh: labels.tooHigh, idle: "" }[state.status];

  return (
    <form action={formAction} className="space-y-3">
      <input type="hidden" name="productId" value={productId} />
      <input type="hidden" name="mode" value={mode} />
      <div className="flex flex-wrap items-end gap-3">
        <div className="inline-flex rounded-lg border border-line p-0.5 text-sm" role="group">
          {(["unit", "total"] as const).map((m) => (
            <button
              key={m}
              type="button"
              onClick={() => setMode(m)}
              className={`rounded-md px-3 py-1 ${mode === m ? "bg-surface-2 font-medium" : "text-muted"}`}
            >
              {m === "unit" ? labels.perUnit : labels.total}
            </button>
          ))}
        </div>
        <label className="flex flex-col gap-1 text-sm">
          {mode === "unit" ? labels.amountUnit : labels.amountTotal}
          <input
            name="amount"
            type="number"
            min="0.01"
            step="0.01"
            required
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            className={`${inputClass} w-40`}
          />
        </label>
      </div>
      <div className="grid max-w-xl grid-cols-[repeat(auto-fill,minmax(9rem,1fr))] gap-3">
        {variants.map((v) => (
          <label key={v.id} className="flex flex-col gap-1 text-sm">
            <span className="truncate">{v.label}</span>
            <input
              name={`qty_${v.id}`}
              type="number"
              min="0"
              step="1"
              placeholder="0"
              aria-label={`${labels.qty} ${v.label}`}
              value={qty[v.id] ?? ""}
              onChange={(e) => setQty({ ...qty, [v.id]: e.target.value })}
              className={inputClass}
            />
          </label>
        ))}
      </div>
      <div className="flex flex-wrap items-center gap-3">
        <button type="submit" disabled={pending} className={`${primaryButtonClass} disabled:opacity-50`}>
          {pending ? labels.working : labels.submit}
        </button>
        {pieces > 0 && n > 0 && (
          <span className="text-sm tabular-nums text-muted">
            {labels.summary.replace("{n}", String(pieces)).replace("{unit}", money.format(unit)).replace("{total}", money.format(total))}
          </span>
        )}
        {msg && !pending && <span className={`text-sm ${state.status === "ok" ? "text-good" : "text-bad"}`}>{msg}</span>}
      </div>
      <p className="max-w-xl text-xs text-muted">{labels.help}</p>
    </form>
  );
}
