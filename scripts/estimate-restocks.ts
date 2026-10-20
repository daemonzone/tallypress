// Estimates the purchases behind the goods sold (see src/lib/estimate-restocks.ts).
//   npm run shop:estimate-restocks             # compute (replaces earlier estimates)
//   npm run shop:estimate-restocks -- --purchases-only # skip the VAT and tax payments
//   npm run shop:estimate-restocks -- --remove # take them all out again
import "dotenv/config";
import { pool } from "../src/db";
import { estimateRestocks, removeEstimatedRestocks } from "../src/lib/estimate-restocks";

async function main() {
  const shopId = process.env.DEFAULT_SHOP_ID;
  if (!shopId) throw new Error("DEFAULT_SHOP_ID is not set");
  if (process.argv.includes("--remove")) {
    const r = await removeEstimatedRestocks(shopId);
    console.log(`Removed ${r.entries} estimated purchases; opening stock rebuilt for ${r.openingLots} items.`);
    return;
  }
  const r = await estimateRestocks(shopId, { payments: !process.argv.includes("--purchases-only") });
  console.log(
    `Estimated purchases: ${(r.total / 100).toFixed(2)} over ${r.months} months (${r.lots} item lots); ` +
      `VAT paid ${(r.vat / 100).toFixed(2)}, earlier-year taxes paid ${(r.tax / 100).toFixed(2)}; ` +
      `opening stock rebuilt for ${r.openingLots} items; months closed again: ${r.closedMonths}.`,
  );
}

main()
  .then(() => pool.end())
  .catch(async (err) => {
    console.error(err instanceof Error ? err.message : err);
    await pool.end();
    process.exit(1);
  });
