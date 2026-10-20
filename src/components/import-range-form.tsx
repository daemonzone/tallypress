"use client";

import { useActionState } from "react";
import type { ImportRangeResult } from "@/lib/import-range";
import { inputClass, primaryButtonClass } from "./ui";

interface Props {
  labels: {
    from: string;
    to: string;
    rebuild: string;
    rebuildHelp: string;
    submit: string;
    working: string;
    ok: string; // "{orders}"
    moved: string; // "{date}" "{lots}"
    closedMonths: string; // "{months}"
    errors: Record<string, string>;
  };
  action: (prev: ImportRangeResult | null, formData: FormData) => Promise<ImportRangeResult>;
}

export function ImportRangeForm({ labels, action }: Props) {
  const [result, formAction, pending] = useActionState(action, null);

  return (
    <form action={formAction} className="flex max-w-lg flex-col gap-3">
      <div className="flex flex-wrap gap-4">
        <label className="flex flex-col gap-1 text-sm">
          {labels.from}
          <input name="from" type="date" required className={inputClass} />
        </label>
        <label className="flex flex-col gap-1 text-sm">
          {labels.to}
          <input name="to" type="date" className={inputClass} />
        </label>
      </div>
      <label className="flex items-start gap-2 text-sm">
        <input name="rebuild" type="checkbox" className="mt-1" />
        <span>
          {labels.rebuild}
          <span className="block text-xs text-muted">{labels.rebuildHelp}</span>
        </span>
      </label>
      <div className="flex flex-wrap items-center gap-3">
        <button type="submit" disabled={pending} className={`${primaryButtonClass} disabled:opacity-50`}>
          {pending ? labels.working : labels.submit}
        </button>
      </div>

      {result?.ok && (
        <div className="space-y-1 text-sm text-good">
          <p>{labels.ok.replace("{orders}", String(result.orders))}</p>
          {result.newStart && <p>{labels.moved.replace("{date}", result.newStart).replace("{lots}", String(result.lotsRebuilt))}</p>}
          {result.closedMonths.length > 0 && (
            <p>{labels.closedMonths.replace("{months}", result.closedMonths.map((m) => m.slice(0, 7)).join(", "))}</p>
          )}
        </div>
      )}
      {result && !result.ok && (
        <p className="text-sm text-bad">
          {labels.errors[result.error] ?? result.error}
          {result.detail ? ` (${result.detail})` : ""}
        </p>
      )}
    </form>
  );
}
