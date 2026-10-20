import type { ReactNode } from "react";

export const inputClass =
  "rounded border border-black/20 bg-transparent px-2 py-1 text-sm dark:border-white/20";
export const buttonClass =
  "rounded border border-black/30 px-3 py-1 text-sm hover:bg-black/5 dark:border-white/30 dark:hover:bg-white/10";

export function Section({
  title,
  children,
  aside,
}: {
  title: string;
  children: ReactNode;
  aside?: ReactNode;
}) {
  return (
    <section className="mb-10">
      <div className="mb-3 flex items-center justify-between gap-4">
        <h2 className="text-lg font-semibold">{title}</h2>
        {aside}
      </div>
      {children}
    </section>
  );
}

export function Notice({
  tone = "info",
  children,
}: {
  tone?: "info" | "warn" | "error";
  children: ReactNode;
}) {
  const border = { info: "border-black/20 dark:border-white/20", warn: "border-amber-500/60", error: "border-red-500/60" }[tone];
  return <p className={`mb-4 rounded border ${border} p-3 text-sm`}>{children}</p>;
}

/** Label/value rows. `strong` rows are emphasised (totals). */
export function KeyValues({
  rows,
}: {
  rows: { label: string; value: ReactNode; note?: string; strong?: boolean }[];
}) {
  return (
    <table className="w-full text-left text-sm">
      <tbody className="divide-y divide-black/10 dark:divide-white/10">
        {rows.map((r) => (
          <tr key={r.label} className={r.strong ? "font-semibold" : undefined}>
            <th scope="row" className="w-2/3 py-2 pr-4 font-normal">
              {r.label}
              {r.note && <span className="block text-xs opacity-60">{r.note}</span>}
            </th>
            <td className="py-2 text-right tabular-nums">{r.value}</td>
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
}: {
  head: string[];
  children: ReactNode;
  numericFrom?: number;
}) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[40rem] text-left text-sm">
        <thead>
          <tr className="border-b border-black/30 dark:border-white/30">
            {head.map((h, i) => (
              <th key={h} className={`py-2 pr-3 font-medium ${i >= numericFrom ? "text-right" : ""}`}>
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-black/10 dark:divide-white/10">{children}</tbody>
      </table>
    </div>
  );
}

export const Td = ({ children, strong, className = "" }: { children?: ReactNode; strong?: boolean; className?: string }) => (
  <td className={`py-2 pr-3 text-right tabular-nums ${strong ? "font-semibold" : ""} ${className}`}>{children}</td>
);
