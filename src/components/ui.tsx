import type { ReactNode } from "react";
import { Icon, type IconName } from "./icons";

export const inputClass =
  "rounded-lg border border-line bg-surface px-3 py-2 text-sm text-ink shadow-sm outline-none transition focus:border-accent focus:ring-2 focus:ring-accent/30";
export const buttonClass =
  "inline-flex items-center gap-2 rounded-lg border border-line bg-surface px-3.5 py-2 text-sm font-medium shadow-sm transition hover:bg-surface-2 disabled:cursor-not-allowed disabled:opacity-50";
export const primaryButtonClass =
  "inline-flex items-center gap-2 rounded-lg bg-accent px-3.5 py-2 text-sm font-medium text-accent-ink shadow-sm transition hover:brightness-110";

export function Card({
  children,
  className = "",
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <div className={`rounded-2xl border border-line bg-surface p-5 shadow-card ${className}`}>
      {children}
    </div>
  );
}

export function Section({
  title,
  children,
  aside,
  help,
}: {
  title: string;
  children: ReactNode;
  aside?: ReactNode;
  help?: string;
}) {
  return (
    <Card className="mb-6">
      <div className="mb-4 flex items-start justify-between gap-4">
        <div>
          <h2 className="text-base font-semibold tracking-tight">{title}</h2>
          {help && <p className="mt-0.5 text-xs text-muted">{help}</p>}
        </div>
        {aside}
      </div>
      {children}
    </Card>
  );
}

export function Notice({
  tone = "info",
  children,
}: {
  tone?: "info" | "warn" | "error";
  children: ReactNode;
}) {
  const style = {
    info: "border-line bg-surface-2",
    warn: "border-[var(--warn-line)] bg-[var(--warn-bg)]",
    error: "border-bad/50 bg-[var(--bad-bg)]",
  }[tone];
  return (
    <p className={`mb-4 flex items-start gap-2.5 rounded-xl border p-3 text-sm ${style}`}>
      {tone !== "info" && <Icon name="alert" className="mt-0.5 h-4 w-4 shrink-0" />}
      <span>{children}</span>
    </p>
  );
}

export function Badge({ children, icon }: { children: ReactNode; icon?: ReactNode }) {
  return (
    <span className="inline-flex items-center gap-1.5 rounded-full border border-line bg-surface-2 px-2.5 py-1 text-xs font-medium">
      {icon}
      {children}
    </span>
  );
}

/** A labelled figure. `hero` is the one big number a view leads with. */
export function StatTile({
  label,
  value,
  icon,
  note,
  hero,
  labelExtra,
  align = "left",
}: {
  label: string;
  value: ReactNode;
  icon?: IconName;
  note?: ReactNode;
  hero?: boolean;
  labelExtra?: ReactNode;
  align?: "left" | "right";
}) {
  return (
    <div className={align === "right" ? "text-right" : undefined}>
      <div className={`flex min-h-5 items-center gap-1.5 text-xs font-medium text-muted ${align === "right" ? "justify-end" : ""}`}>
        {icon && <Icon name={icon} className="h-3.5 w-3.5" />}
        {label}
        {labelExtra}
      </div>
      <div className={hero ? "mt-1 text-5xl font-semibold tracking-tight" : "mt-1 text-2xl font-semibold tracking-tight"}>
        {value}
      </div>
      {note && <div className="mt-1 text-xs text-muted">{note}</div>}
    </div>
  );
}

/** Label/value rows. `strong` rows are emphasised (totals). */
export function KeyValues({
  rows,
}: {
  rows: { label: string; value: ReactNode; note?: string; strong?: boolean; labelExtra?: ReactNode; indent?: boolean }[];
}) {
  return (
    <table className="w-full text-left text-sm">
      <tbody className="divide-y divide-line">
        {rows.map((r) => (
          <tr key={r.label} className={r.strong ? "font-semibold" : undefined}>
            <th scope="row" className={`w-2/3 py-2.5 pr-4 align-top font-normal ${r.indent ? "pl-6" : ""}`}>
              <span className={`inline-flex items-center gap-1.5 ${r.strong ? "" : "text-muted"}`}>
                {r.label}
                {r.labelExtra}
              </span>
              {r.note && <span className="block text-xs font-normal text-muted">{r.note}</span>}
            </th>
            <td className="py-2.5 text-right align-top tabular-nums">{r.value}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

export function DataTable({
  head,
  children,
  numericFrom = 1,
  align,
  minWidth = "40rem",
}: {
  head: string[];
  children: ReactNode;
  numericFrom?: number;
  /** Explicit alignment per column; overrides numericFrom. */
  align?: ("left" | "right")[];
  minWidth?: string;
}) {
  return (
    <div className="-mx-1 overflow-x-auto px-1">
      <table className="w-full text-left text-sm" style={{ minWidth }}>
        <thead>
          <tr className="border-b border-line text-xs uppercase tracking-wide text-muted">
            {head.map((h, i) => (
              <th key={h} className={`py-2 pr-3 font-medium ${(align ? align[i] === "right" : i >= numericFrom) ? "text-right" : ""}`}>
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-line [&>tr:hover]:bg-surface-2/60">{children}</tbody>
      </table>
    </div>
  );
}

export const Td = ({
  children,
  strong,
  className = "",
}: {
  children?: ReactNode;
  strong?: boolean;
  className?: string;
}) => (
  <td className={`py-2.5 pr-3 text-right tabular-nums ${strong ? "font-semibold" : ""} ${className}`}>
    {children}
  </td>
);
