"use client";

import { useState } from "react";
import type { SyncState } from "@/lib/sync/actions";
import { buttonClass } from "./ui";

interface Props {
  action: () => Promise<SyncState>;
  labels: {
    sync: string;
    syncing: string;
    failed: string;
  };
}

/** "Sync now" with feedback: a spinner while it runs, then the page reloads with the new figures. */
export function SyncButton({ action, labels }: Props) {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function run() {
    setPending(true);
    setError(null);
    try {
      const result = await action();
      if (result.status === "ok") return void window.location.reload();
      setError(result.status === "error" ? result.error : labels.failed);
    } catch (err) {
      setError(err instanceof Error ? err.message : labels.failed);
    }
    setPending(false);
  }

  return (
    <div className="flex items-center gap-3">
      {error && (
        <span className="text-sm text-bad">
          {labels.failed}: {error}
        </span>
      )}
      <button type="button" onClick={run} disabled={pending} aria-busy={pending} className={`${buttonClass} inline-flex items-center gap-2 disabled:opacity-60`}>
        {pending && (
          <svg className="h-4 w-4 animate-spin" viewBox="0 0 24 24" fill="none" aria-hidden="true">
            <circle cx="12" cy="12" r="9" stroke="currentColor" strokeWidth="3" opacity="0.25" />
            <path d="M21 12a9 9 0 0 0-9-9" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
          </svg>
        )}
        {pending ? labels.syncing : labels.sync}
      </button>
    </div>
  );
}
