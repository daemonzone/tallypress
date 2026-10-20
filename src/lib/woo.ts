import type { shops } from "@/db/schema";

type WooCredentials = Pick<
  typeof shops.$inferSelect,
  "wooUrl" | "wooConsumerKey" | "wooConsumerSecret"
>;

/**
 * In Docker the shop's public address (http://localhost:9080) is not reachable from
 * the app container. WOO_URL_REWRITE="<public url>=<internal url>" maps one to the other.
 */
function resolveBaseUrl(url: string): string {
  const trimmed = url.replace(/\/$/, "");
  const [from, to] = (process.env.WOO_URL_REWRITE ?? "").split("=");
  return from && to && trimmed === from.replace(/\/$/, "") ? to.replace(/\/$/, "") : trimmed;
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * fetch with retries for what is usually transient on a live shop: dropped connections,
 * timeouts, 429 and 5xx. Waits 1s, 2s, 4s, 8s between attempts. Other statuses (401, 403,
 * 404...) are returned as they are, for the caller to report.
 */
async function fetchWithRetry(url: URL, init: RequestInit, attempts = 5): Promise<Response> {
  for (let i = 1; ; i++) {
    try {
      const res = await fetch(url, { ...init, signal: AbortSignal.timeout(60_000) });
      if ((res.status === 429 || res.status >= 500) && i < attempts) {
        await sleep(1000 * 2 ** (i - 1));
        continue;
      }
      return res;
    } catch (err) {
      if (i >= attempts) throw err;
      await sleep(1000 * 2 ** (i - 1));
    }
  }
}

/** GET every page of a WooCommerce REST collection (wc/v3). */
export async function wooGetAll<T>(
  shop: WooCredentials,
  path: string,
  params: Record<string, string | number | boolean> = {},
): Promise<T[]> {
  const auth = Buffer.from(`${shop.wooConsumerKey}:${shop.wooConsumerSecret}`).toString("base64");
  const out: T[] = [];

  for (let page = 1; ; page++) {
    const url = new URL(`${resolveBaseUrl(shop.wooUrl)}/wp-json/wc/v3/${path}`);
    for (const [k, v] of Object.entries({ ...params, per_page: 100, page })) {
      url.searchParams.set(k, String(v));
    }

    const res = await fetchWithRetry(url, {
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
