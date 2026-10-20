"use client";

import { useActionState } from "react";
import type { AlignState } from "@/lib/actions";
import { formatters } from "./format";
import { inputClass, primaryButtonClass } from "./ui";

interface Props {
  locale: string;
  currency: string;
  computed: number; // cents: the balance Tallypress has worked out
  labels: {
    computed: string;
    real: string;
    submit: string;
    invalid: string;
    same: string;
    done: string; // "{difference}"
  };
  action: (prev: AlignState, formData: FormData) => Promise<AlignState>;
}

/** One number in, one adjustment out: align the computed balance with the real bank balance. */
export function AlignForm({ locale, currency, computed, labels, action }: Props) {
  const [state, formAction, pending] = useActionState(action, { status: "idle" } as AlignState);
  const { money } = formatters(locale, currency);

  return (
    <form action={formAction} className="flex max-w-lg flex-col gap-3">
      <div className="text-sm">
        <span className="text-muted">{labels.computed}: </span>
        <span className="font-semibold tabular-nums">{money(computed)}</span>
      </div>
      <label className="flex flex-col gap-1 text-sm">
        {labels.real} ({currency})
        <input name="balance" type="number" step="0.01" required className={inputClass} />
      </label>
      <div className="flex flex-wrap items-center gap-3">
        <button type="submit" disabled={pending} className={`${primaryButtonClass} disabled:opacity-50`}>
          {labels.submit}
        </button>
        {state.status === "ok" && (
          <span className="text-sm text-good">{labels.done.replace("{difference}", money(state.difference))}</span>
        )}
        {state.status === "invalid" && <span className="text-sm text-bad">{labels.invalid}</span>}
        {state.status === "same" && <span className="text-sm text-muted">{labels.same}</span>}
      </div>
    </form>
  );
}
