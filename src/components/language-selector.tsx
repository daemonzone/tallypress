import { locales, type Locale } from "@/db/schema";
import type { Dictionary } from "@/i18n";
import { setLocale } from "@/i18n/actions";

export function LanguageSelector({ current, t }: { current: Locale; t: Dictionary }) {
  return (
    <form action={setLocale} className="flex items-center gap-2 text-sm">
      <label htmlFor="locale">{t.language.label}</label>
      <select
        id="locale"
        name="locale"
        defaultValue={current}
        className="rounded border border-black/20 bg-transparent px-2 py-1 dark:border-white/20"
      >
        {locales.map((l) => (
          <option key={l} value={l}>
            {t.language[l]}
          </option>
        ))}
      </select>
      <button type="submit" className="rounded border border-black/20 px-2 py-1 dark:border-white/20">
        {t.language.apply}
      </button>
    </form>
  );
}
