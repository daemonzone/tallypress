import Link from "next/link";
import { Icon } from "./icons";
import { buttonClass, inputClass } from "./ui";

/** A GET search form (works without JavaScript): submitting it goes back to page 1. */
export function SearchBox({
  action,
  q,
  placeholder,
  button,
  wide = false,
}: {
  action: string;
  q: string;
  placeholder: string;
  button: string;
  wide?: boolean;
}) {
  return (
    <form action={action} method="get" role="search" className="flex items-center gap-2">
      <input
        name="q"
        type="search"
        defaultValue={q}
        placeholder={placeholder}
        aria-label={placeholder}
        maxLength={80}
        className={`${inputClass} ${wide ? "w-72" : "w-56"}`}
      />
      <button type="submit" className={buttonClass}>
        <Icon name="search" className="h-4 w-4" />
        {button}
      </button>
    </form>
  );
}

/** Result count, the active search with a way to clear it, and previous / next page links. */
export function Pager({
  basePath,
  q,
  page,
  pages,
  total,
  locale,
  labels,
}: {
  basePath: string;
  q: string;
  page: number;
  pages: number;
  total: number;
  locale: string;
  labels: { results: string; clearSearch: string; pagination: string; prev: string; next: string; pageOf: string };
}) {
  const href = (p: number) => `${basePath}?${new URLSearchParams({ ...(q ? { q } : {}), page: String(p) })}`;
  const disabled = `${buttonClass} pointer-events-none opacity-40`;
  return (
    <div className="mt-4 flex flex-wrap items-center justify-between gap-3 text-sm">
      <span className="text-muted">
        {labels.results.replace("{n}", new Intl.NumberFormat(locale, { useGrouping: "always" }).format(total))}
        {q && (
          <>
            {" "}
            · “{q}”{" "}
            <Link href={basePath} className="underline">
              {labels.clearSearch}
            </Link>
          </>
        )}
      </span>
      {pages > 1 && (
        <nav aria-label={labels.pagination} className="flex items-center gap-2">
          {page > 1 ? (
            <Link href={href(page - 1)} className={buttonClass}>
              ← {labels.prev}
            </Link>
          ) : (
            <span className={disabled}>← {labels.prev}</span>
          )}
          <span className="px-1 tabular-nums">
            {labels.pageOf.replace("{p}", String(page)).replace("{pages}", String(pages))}
          </span>
          {page < pages ? (
            <Link href={href(page + 1)} className={buttonClass}>
              {labels.next} →
            </Link>
          ) : (
            <span className={disabled}>{labels.next} →</span>
          )}
        </nav>
      )}
    </div>
  );
}
