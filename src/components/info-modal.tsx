"use client";

import { useRef, type ReactNode } from "react";
import { Icon } from "./icons";
import { primaryButtonClass } from "./ui";

/** An "i" button that opens its children in a native modal dialog (Esc or a click outside closes it). */
export function InfoModal({
  label,
  title,
  subtitle,
  closeLabel,
  icon = "info",
  children,
}: {
  icon?: "info" | "alert";
  label: string;
  title: string;
  subtitle?: string;
  closeLabel: string;
  children: ReactNode;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  return (
    <>
      <button
        type="button"
        onClick={() => ref.current?.showModal()}
        aria-label={label}
        title={label}
        className="inline-flex h-5 w-5 items-center justify-center rounded-full text-muted transition hover:bg-surface-2 hover:text-ink"
      >
        <Icon name={icon} className="h-4 w-4" />
      </button>
      <dialog
        ref={ref}
        onClick={(e) => {
          if (e.target === ref.current) ref.current?.close(); // click on the backdrop
        }}
        className="m-auto w-[min(34rem,calc(100vw-2rem))] overflow-hidden rounded-2xl border border-line bg-surface p-0 text-ink shadow-card backdrop:bg-black/50"
      >
        <header className="flex items-center justify-between gap-4 border-b border-line bg-accent-soft px-5 py-3">
          <h2 className="text-lg font-semibold tracking-tight">
            {title}
            {subtitle && <span className="ml-2 text-sm font-normal capitalize text-muted">· {subtitle}</span>}
          </h2>
          <button
            type="button"
            onClick={() => ref.current?.close()}
            aria-label={closeLabel}
            className="-mr-1 rounded-full px-2 text-2xl leading-none text-muted transition hover:bg-surface hover:text-ink"
          >
            ×
          </button>
        </header>
        <div className="p-5">
          {children}
          {/* a form with method="dialog" closes the dialog without any script */}
          <form method="dialog" className="mt-5 flex justify-end">
            <button type="submit" className={primaryButtonClass}>
              {closeLabel}
            </button>
          </form>
        </div>
      </dialog>
    </>
  );
}
