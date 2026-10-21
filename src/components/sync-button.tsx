"use client";

import { useActionState } from "react";
import type { SyncState } from "@/lib/sync/actions";
import { buttonClass } from "./ui";

interface Props {
  action: () => Promise<SyncState>;
  labels: {
    sync: string;
    syncing: string;
    done: string; // "{orders}"
    failed: string;
  };
}

/** "Sync now" with feedback: a spinner while it runs, then what came of it. */
export function SyncButton({ action, labels }: Props) {
  const [state, formAction, pending] = useActionState(action, { status: "idle" } as SyncState);

  return (
    <form action={formAction} className="flex items-center gap-3">
      {!pending && state.status === "ok" && (
        <span className="text-sm text-good">{labels.done.replace("{orders}", String(state.orders))}</span>
      )}
      {!pending && state.status === "error" && <span className="text-sm text-bad">{labels.failed}: {state.error}</span>}
      <button type="submit" disabled={pending} aria-busy={pending} className={`${buttonClass} inline-flex items-center gap-2 disabled:opacity-60`}>
        {pending && (
          <svg className="h-4 w-4 animate-spin" viewBox="0 0 24 24" fill="none" aria-hidden="true">
            <circle cx="12" cy="12" r="9" stroke="currentColor" strokeWidth="3" opacity="0.25" />
            <path d="M21 12a9 9 0 0 0-9-9" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
          </svg>
        )}
        {pending ? labels.syncing : labels.sync}
      </button>
    </form>
  );
}
