import { cookies } from "next/headers";
import { locales, type Locale } from "@/db/schema";
import { getCurrentShop } from "@/lib/shop";
import en from "./dictionaries/en.json";
import it from "./dictionaries/it.json";

export const LOCALE_COOKIE = "tp_locale";

const dictionaries = { en, it } satisfies Record<Locale, unknown>;
export type Dictionary = typeof en;

export const isLocale = (value: string | undefined): value is Locale =>
  !!value && (locales as readonly string[]).includes(value);

/** A visitor's choice (cookie) wins; otherwise the shop's configured default. */
export async function getLocale(): Promise<Locale> {
  const chosen = (await cookies()).get(LOCALE_COOKIE)?.value;
  if (isLocale(chosen)) return chosen;
  const shop = await getCurrentShop();
  return shop?.defaultLocale ?? "en";
}

export async function getDictionary(): Promise<{ locale: Locale; t: Dictionary }> {
  const locale = await getLocale();
  return { locale, t: dictionaries[locale] };
}
