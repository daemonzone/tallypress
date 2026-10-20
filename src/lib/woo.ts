import type { shops } from "@/db/schema";

type WooCredentials = Pick<
  typeof shops.$inferSelect,
  "wooUrl" | "wooConsumerKey" | "wooConsumerSecret"
>;

/** GET every page of a WooCommerce REST collection (wc/v3). */
export async function wooGetAll<T>(
  shop: WooCredentials,
  path: string,
  params: Record<string, string | number | boolean> = {},
): Promise<T[]> {
  const auth = Buffer.from(`${shop.wooConsumerKey}:${shop.wooConsumerSecret}`).toString("base64");
  const out: T[] = [];

  for (let page = 1; ; page++) {
    const url = new URL(`${shop.wooUrl.replace(/\/$/, "")}/wp-json/wc/v3/${path}`);
    for (const [k, v] of Object.entries({ ...params, per_page: 100, page })) {
      url.searchParams.set(k, String(v));
    }

    const res = await fetch(url, {
      headers: { Authorization: `Basic ${auth}` },
      cache: "no-store",
    });
    if (!res.ok) {
      throw new Error(`WooCommerce ${res.status} on ${path}: ${(await res.text()).slice(0, 200)}`);
    }

    out.push(...((await res.json()) as T[]));
    if (page >= Number(res.headers.get("x-wp-totalpages") ?? 1)) break;
  }
  return out;
}

/** Sum of WooCommerce decimal strings, exact to the cent. */
export function sumMoney(...values: string[]): string {
  const cents = values.reduce((acc, v) => acc + Math.round(parseFloat(v || "0") * 100), 0);
  return (cents / 100).toFixed(2);
}
