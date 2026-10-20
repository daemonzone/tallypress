import { locales, type Locale } from "@/db/schema";
import type { Dictionary } from "@/i18n";
import { setLocale } from "@/i18n/actions";

/** Segmented switch: always shows the active language and changes it on click. */
export function LanguageSelector({ current, t }: { current: Locale; t: Dictionary }) {
  return (
    <form
      action={setLocale}
      role="group"
      aria-label={t.language.label}
      className="inline-flex rounded-full border border-line bg-surface p-0.5 text-xs font-semibold shadow-sm"
    >
      {locales.map((l) => (
        <button
          key={l}
          type="submit"
          name="locale"
          value={l}
          title={t.language[l]}
          aria-pressed={l === current}
          className={`rounded-full px-3 py-1 transition ${
            l === current ? "bg-accent text-accent-ink" : "text-muted hover:text-ink"
          }`}
        >
          {l.toUpperCase()}
        </button>
      ))}
    </form>
  );
}
