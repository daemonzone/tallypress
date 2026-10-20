// Points the app's shop at a real WooCommerce site: wipes the shop's data, stores the
// connection and tax profile, syncs orders/products since the start date, then records the
// starting point (bank balance + opening stock) with purchase costs derived from the
// selling price. Run it from the host:
//
//   SHOP_URL=https://example.com SHOP_KEY=ck_... SHOP_SECRET=cs_... \
//   SHOP_START=2026-10-01 SHOP_BALANCE=2000 SHOP_COST_PCT=30 SHOP_WIPE=yes \
//   SHOP_TAX='{"vatRate":22,"brackets":[{"upTo":28000,"rate":23},{"upTo":null,"rate":43}],"socialRate":26.07}' \
//   npm run shop:connect
//
// SHOP_RESUME=yes skips the wipe, the settings and the download and only records the starting
// point on the data already imported (use it when a previous run stopped at the last step).
//
// The credentials come from the environment only; they end up in the database (see the
// README's note on secrets) and nowhere in the repository.
import "dotenv/config";
import { and, count, eq, gte, inArray, sql } from "drizzle-orm";
import { db, pool } from "../src/db";
import {
  items,
  ledgerEntries,
  monthClosings,
  orderLines,
  orders,
  restockLots,
  shops,
  type TaxBracket,
} from "../src/db/schema";
import { ensureMonthsClosed } from "../src/lib/closing";
import { COUNTED_STATUSES, freezeCosts } from "../src/lib/costs";
import { recordOpening, type OpeningLot } from "../src/lib/opening";
import { syncShop } from "../src/lib/sync";

const env = (name: string) => process.env[name]?.trim() || undefined;
const need = (name: string) => {
  const v = env(name);
  if (!v) throw new Error(`${name} is required`);
  return v;
};

async function main() {
  const shopId = need("DEFAULT_SHOP_ID");
  const wooUrl = need("SHOP_URL").replace(/\/$/, "");
  const key = need("SHOP_KEY");
  const secret = need("SHOP_SECRET");
  const start = need("SHOP_START");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(start)) throw new Error("SHOP_START must be YYYY-MM-DD");
  const baselineAt = new Date(`${start}T00:00:00Z`);
  const balanceCents = Math.round(Number(env("SHOP_BALANCE") ?? "0") * 100);
  const costPct = env("SHOP_COST_PCT") ? Number(env("SHOP_COST_PCT")) : null;
  const tax = JSON.parse(env("SHOP_TAX") ?? "{}") as {
    vatRate?: number;
    incomeTaxRate?: number;
    brackets?: TaxBracket[] | null;
    socialRate?: number;
    taxBase?: "profit" | "revenue";
  };

  // The shop's currency is read from WooCommerce itself, never guessed.
  const auth = Buffer.from(`${key}:${secret}`).toString("base64");
  const res = await fetch(`${wooUrl}/wp-json/wc/v3/settings/general/woocommerce_currency`, {
    headers: { Authorization: `Basic ${auth}` },
  });
  if (!res.ok) throw new Error(`Could not read the shop's currency: HTTP ${res.status}`);
  const currency = String(((await res.json()) as { value: string }).value);

  const resume = env("SHOP_RESUME") === "yes";
  if (resume) {
    const [{ n }] = await db.select({ n: count() }).from(orders).where(eq(orders.shopId, shopId));
    if (!n) throw new Error("SHOP_RESUME needs data already imported: nothing found, run the full import first");
    console.log(`Resuming on the ${n} orders already in the database.`);
  } else {
    // Wipe: only this app's copy, never the WooCommerce site (the key is read-only anyway).
    const [{ n: existing }] = await db.select({ n: count() }).from(orders).where(eq(orders.shopId, shopId));
    const [{ n: ledger }] = await db.select({ n: count() }).from(ledgerEntries).where(eq(ledgerEntries.shopId, shopId));
    if ((existing > 0 || ledger > 0) && env("SHOP_WIPE") !== "yes") {
      throw new Error(`The shop already has ${existing} orders and ${ledger} ledger entries. Set SHOP_WIPE=yes to erase them.`);
    }
    await db.transaction(async (tx) => {
      await tx.delete(monthClosings).where(eq(monthClosings.shopId, shopId));
      await tx.delete(ledgerEntries).where(eq(ledgerEntries.shopId, shopId));
      await tx.delete(restockLots).where(eq(restockLots.shopId, shopId));
      await tx.delete(orderLines).where(eq(orderLines.shopId, shopId));
      await tx.delete(orders).where(eq(orders.shopId, shopId));
      await tx.delete(items).where(eq(items.shopId, shopId));
    });
    console.log(`Erased ${existing} orders and ${ledger} ledger entries (and products, lots, closings).`);

    const settings = {
      name: env("SHOP_NAME") ?? new URL(wooUrl).hostname.replace(/^www\./, ""),
      active: true,
      wooUrl,
      wooConsumerKey: key,
      wooConsumerSecret: secret,
      currency,
      defaultLocale: (env("SHOP_LOCALE") === "en" ? "en" : "it") as "en" | "it",
      timezone: env("SHOP_TZ") ?? "Europe/Rome",
      vatRate: String(tax.vatRate ?? 0),
      incomeTaxRate: String(tax.incomeTaxRate ?? 0),
      incomeTaxBrackets: tax.brackets ?? null,
      socialSecurityRate: String(tax.socialRate ?? 0),
      taxBase: tax.taxBase ?? "profit",
      ...(env("SHOP_OWNER_PCT") ? { ownerSharePct: env("SHOP_OWNER_PCT")! } : {}),
      baselineAt,
      lastSyncedAt: null,
      lastSyncError: null,
    };
    await db.insert(shops).values({ id: shopId, ...settings }).onConflictDoUpdate({ target: shops.id, set: settings });
    console.log(`Shop set to ${wooUrl} (${currency}, starts ${start}).`);

    console.log("Syncing products and orders from WooCommerce...");
    const result = await syncShop(shopId);
    if (!result.ok) throw new Error(`Sync failed: ${result.error}`);
    console.log(`Synced ${result.items} items and ${result.orders} orders.`);
  }

  // Opening stock = what WooCommerce holds now + what sold since the start date.
  const sold = new Map<string, number>();
  const soldRows = await db
    .select({ itemId: orderLines.itemId, qty: sql<string>`sum(${orderLines.quantity})` })
    .from(orderLines)
    .innerJoin(orders, eq(orders.id, orderLines.orderId))
    .where(and(eq(orderLines.shopId, shopId), inArray(orders.status, COUNTED_STATUSES), gte(orders.placedAt, baselineAt)))
    .groupBy(orderLines.itemId);
  for (const r of soldRows) if (r.itemId) sold.set(r.itemId, Number(r.qty));

  const vatRate = Number(tax.vatRate ?? 0);
  const allItems = await db.select().from(items).where(eq(items.shopId, shopId));
  const lots: OpeningLot[] = [];
  const manualCosts: Record<string, number> = {};
  let noPrice = 0;
  for (const item of allItems) {
    const price = item.price == null ? NaN : Number(item.price);
    // Cost as a share of the selling price without VAT (prices here include VAT).
    const cost = costPct != null && price > 0 ? ((price / (1 + vatRate / 100)) * costPct) / 100 : null;
    if (cost == null) {
      noPrice++;
      continue;
    }
    manualCosts[item.id] = cost;
    if (item.managesStock && item.stockQty != null) {
      const quantity = Number(item.stockQty) + (sold.get(item.id) ?? 0);
      if (quantity > 0) lots.push({ itemId: item.id, quantity, unitCost: cost });
    }
  }

  const recorded = await recordOpening(shopId, { baselineAt, balanceCents, lots, manualCosts, resetSync: false });
  if (!recorded) {
    throw new Error(
      "The shop already has a starting point (an opening balance entry exists), so nothing was recorded. " +
        "Remove that entry or run the full import with SHOP_WIPE=yes.",
    );
  }
  await freezeCosts(shopId);
  await ensureMonthsClosed(shopId);

  const stockValue = lots.reduce((s, l) => s + l.quantity * l.unitCost, 0);
  console.log(
    `Starting point: ${(balanceCents / 100).toFixed(2)} ${currency}; ${lots.length} opening lots ` +
      `(${stockValue.toFixed(2)} ${currency} of stock); costs set on ${Object.keys(manualCosts).length} items; ` +
      `${noPrice} items without a price (no cost).`,
  );
}

main()
  .then(() => pool.end())
  .catch(async (err) => {
    console.error(err instanceof Error ? err.message : err);
    await pool.end();
    process.exit(1);
  });
