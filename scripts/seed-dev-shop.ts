// Creates (or refreshes) the fixed dev shop pointing at the Docker WooCommerce.
import "dotenv/config";
import { db } from "../src/db";
import { shops } from "../src/db/schema";

const id = process.env.DEFAULT_SHOP_ID;
if (!id) throw new Error("DEFAULT_SHOP_ID is not set");

const config = {
  name: "Tallypress Demo Shop",
  wooUrl: process.env.DEV_WOO_URL ?? "http://localhost:9080",
  wooConsumerKey: process.env.DEV_WOO_CONSUMER_KEY ?? "ck_tallypress_dev_0001",
  wooConsumerSecret: process.env.DEV_WOO_CONSUMER_SECRET ?? "cs_tallypress_dev_0001",
  currency: "EUR",
  defaultLocale: "it" as const,
  timezone: "Europe/Rome",
  vatRate: "22",
  incomeTaxRate: "56",
  taxBase: "profit" as const,
  ownerSharePct: "30",
};

// Dev baseline: the first of the month two months back, so the demo orders are all in range.
// Set on first insert only; re-seeding never moves a shop's zero time.
const now = new Date();
const baselineAt = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 2, 1));

async function main() {
  await db.insert(shops).values({ id, baselineAt, ...config }).onConflictDoUpdate({ target: shops.id, set: config });
  console.log(`Dev shop ready: ${id}`);
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
