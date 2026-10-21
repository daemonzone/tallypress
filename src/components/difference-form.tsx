"use client";

import { useActionState, useState } from "react";
import type { DifferenceState } from "@/lib/actions";
import { buttonClass, inputClass, primaryButtonClass } from "./ui";

interface Props {
  productId: number;
  pieces: number;
  locale: string;
  currency: string;
  labels: Record<"total" | "summary" | "restock" | "adjust" | "working" | "done" | "invalid" | "tooHigh" | "gone", string>;
  action: (prev: DifferenceState, formData: FormData) => Promise<DifferenceState>;
}

/** Pieces that came in unrecorded: the quantities are read-only; only the total paid is entered. */
export function DifferenceForm({ productId, pieces, locale, currency, labels, action }: Props) {
  const [state, formAction, pending] = useActionState(action, { status: "idle" } as DifferenceState);
  const [total, setTotal] = useState("");
  const n = Number(total.replace(",", "."));
  const money = new Intl.NumberFormat(locale, { style: "currency", currency, useGrouping: "always" });
  const msg = state.status === "ok" ? labels.done : { invalid: labels.invalid, tooHigh: labels.tooHigh, gone: labels.gone, idle: "" }[state.status];

  return (
    <form action={formAction} className="space-y-2">
      <input type="hidden" name="productId" value={productId} />
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
        <button type="submit" name="kind" value="restock" disabled={pending || !(n > 0)} className={`${primaryButtonClass} disabled:opacity-50`}>
          {pending ? labels.working : labels.restock}
        </button>
        <button type="submit" name="kind" value="adjust" disabled={pending} className={`${buttonClass} disabled:opacity-50`} formNoValidate>
          {labels.adjust}
        </button>
      </div>
      <div className="text-sm empty:hidden">
        {n > 0 && pieces > 0 && (
          <span className="tabular-nums text-muted">
            {labels.summary.replace("{n}", String(pieces)).replace("{unit}", money.format(n / pieces))}
          </span>
        )}
        {msg && !pending && <span className={`ml-3 ${state.status === "ok" ? "text-good" : "text-bad"}`}>{msg}</span>}
      </div>
    </form>
  );
}
