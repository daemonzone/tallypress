"use client";

import { useActionState } from "react";
import type { ProductCostState } from "@/lib/actions";
import { inputClass, primaryButtonClass } from "./ui";

interface Props {
  productId: number;
  current: number | null; // the cost when every variation shares one, else null
  labels: { cost: string; submit: string; working: string; help: string; done: string; invalid: string };
  action: (prev: ProductCostState, formData: FormData) => Promise<ProductCostState>;
}

/** One purchase cost for the whole product: every size and colour, in a single operation. */
export function ProductCostForm({ productId, current, labels, action }: Props) {
  const [state, formAction, pending] = useActionState(action, { status: "idle" } as ProductCostState);

  return (
    <form action={formAction} className="space-y-2">
      <input type="hidden" name="productId" value={productId} />
      <div className="flex flex-wrap items-end gap-3">
        <label className="flex flex-col gap-1 text-sm">
          {labels.cost}
          <input
            name="unitCost"
            type="number"
            min="0"
            step="0.01"
            required
            defaultValue={current == null ? "" : current.toFixed(2)}
            className={`${inputClass} w-40`}
          />
        </label>
        <button type="submit" disabled={pending} className={`${primaryButtonClass} disabled:opacity-50`}>
          {pending ? labels.working : labels.submit}
        </button>
        {state.status === "ok" && !pending && <span className="text-sm text-good">{labels.done}</span>}
        {state.status === "invalid" && !pending && <span className="text-sm text-bad">{labels.invalid}</span>}
      </div>
      <p className="max-w-xl text-xs text-muted">{labels.help}</p>
    </form>
  );
}
