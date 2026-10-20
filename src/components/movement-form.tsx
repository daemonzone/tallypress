"use client";

import { useActionState, useState } from "react";
import type { MovementState } from "@/lib/movements";
import { inputClass, primaryButtonClass } from "./ui";

interface Props {
  types: { value: string; label: string; sign: 1 | -1; needsNote: boolean }[];
  labels: {
    type: string;
    amount: string;
    noteOptional: string;
    noteRequired: string;
    submit: string;
    ok: string;
    invalid: string;
    noteMissing: string;
    inflow: string;
    outflow: string;
  };
  action: (prev: MovementState, formData: FormData) => Promise<MovementState>;
}

/** One form for every manual movement: the type picks the direction, "other" needs a description. */
export function MovementForm({ types, labels, action }: Props) {
  const [state, formAction, pending] = useActionState(action, { status: "idle" } as MovementState);
  const [value, setValue] = useState(types[0].value);
  const current = types.find((t) => t.value === value) ?? types[0];

  return (
    <form action={formAction} className="flex max-w-lg flex-col gap-3">
      <label className="flex flex-col gap-1 text-sm">
        {labels.type}
        <select name="type" value={value} onChange={(e) => setValue(e.target.value)} className={inputClass}>
          {types.map((t) => (
            <option key={t.value} value={t.value}>
              {t.label}
            </option>
          ))}
        </select>
      </label>

      <label className="flex flex-col gap-1 text-sm">
        {labels.amount}
        <div className="flex items-center gap-2">
          <span
            aria-hidden="true"
            className={`w-5 text-center text-lg font-semibold ${current.sign > 0 ? "text-good" : "text-bad"}`}
          >
            {current.sign > 0 ? "+" : "−"}
          </span>
          <input name="amount" type="number" min="0.01" step="0.01" required className={`${inputClass} flex-1`} />
        </div>
        <span className="pl-7 text-xs text-muted">{current.sign > 0 ? labels.inflow : labels.outflow}</span>
      </label>

      <label className="flex flex-col gap-1 text-sm">
        {current.needsNote ? labels.noteRequired : labels.noteOptional}
        <input name="note" type="text" maxLength={200} required={current.needsNote} className={inputClass} />
      </label>

      <div className="flex items-center gap-3">
        <button type="submit" disabled={pending} className={`${primaryButtonClass} disabled:opacity-50`}>
          {labels.submit}
        </button>
        {state.status === "ok" && <span className="text-sm text-good">{labels.ok}</span>}
        {state.status === "invalid" && <span className="text-sm text-bad">{labels.invalid}</span>}
        {state.status === "note" && <span className="text-sm text-bad">{labels.noteMissing}</span>}
      </div>
    </form>
  );
}
