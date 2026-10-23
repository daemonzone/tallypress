"use client";

import { useState } from "react";
import type { SyncState } from "@/lib/sync/actions";
import { Icon } from "./icons";
import { buttonClass } from "./ui";

interface Props {
  action: () => Promise<SyncState>;
  labels: {
    sync: string;
    syncing: string;
    busy: string;
    failed: string;
  };
}

type Notice = { tone: "warn" | "error"; text: string };

/** "Sync now": the button pulses while it runs, then the page reloads with the new figures; a problem shows as a badge. */
export function SyncButton({ action, labels }: Props) {
  const [pending, setPending] = useState(false);
  const [notice, setNotice] = useState<Notice | null>(null);

  function show(n: Notice) {
    setNotice(n);
    setTimeout(() => setNotice(null), 8000);
  }

  async function run() {
    setPending(true);
    setNotice(null);
    try {
      const result = await action();
      if (result.status === "ok") return void window.location.reload();
      if (result.status === "busy") show({ tone: "warn", text: labels.busy });
      else if (result.status === "error") show({ tone: "error", text: `${labels.failed}: ${result.error}` });
    } catch (err) {
      show({ tone: "error", text: `${labels.failed}: ${err instanceof Error ? err.message : ""}` });
    }
    setPending(false);
  }

  return (
    <div className="flex items-center gap-3">
      {notice && (
        <span
          role="status"
          title={notice.text}
          className={`inline-flex max-w-xs items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-medium ${
            notice.tone === "warn" ? "border-[var(--warn-line)] bg-[var(--warn-bg)]" : "border-bad/40 bg-surface text-bad"
          }`}
        >
          <Icon name="alert" className="h-3.5 w-3.5 shrink-0" />
          <span className="truncate">{notice.text}</span>
        </span>
      )}
      <button
        type="button"
        onClick={run}
        disabled={pending}
        aria-busy={pending}
        className={`${buttonClass} ${pending ? "sync-pulse !border-accent/60" : "disabled:opacity-60"}`}
      >
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
