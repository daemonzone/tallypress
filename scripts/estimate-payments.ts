// Estimates the VAT and income tax payments (see src/lib/estimate-payments.ts); purchases are not touched.
//   npm run shop:estimate-payments             # compute (replaces earlier estimated payments)
//   npm run shop:estimate-payments -- --remove # take them out again
//   --vat-due=month-end   quarterly VAT due the last day of the month after the quarter
//   --tax=june            the tax of the previous year in one payment on 30 June
//   --tax=july            the same, on 31 July
import "dotenv/config";
import { pool } from "../src/db";
import { clearEstimatedPayments, estimatePayments } from "../src/lib/estimate-payments";

async function main() {
  const shopId = process.env.DEFAULT_SHOP_ID;
  if (!shopId) throw new Error("DEFAULT_SHOP_ID is not set");
  if (process.argv.includes("--remove")) {
    console.log(`Removed ${await clearEstimatedPayments(shopId)} estimated payments.`);
    return;
  }
  const r = await estimatePayments(shopId, {
    vatDue: process.argv.includes("--vat-due=month-end") ? "month-end" : "italian",
    taxPayments: process.argv.includes("--tax=july") ? "july" : process.argv.includes("--tax=june") ? "june" : "two",
  });
  console.log(
    `${r.entries} estimated payments: VAT ${(r.vat / 100).toFixed(2)}, earlier-year taxes ${(r.tax / 100).toFixed(2)}; months closed again: ${r.closedMonths}.`,
  );
}

main()
  .then(() => pool.end())
  .catch(async (err) => {
    console.error(err instanceof Error ? err.message : err);
    await pool.end();
    process.exit(1);
  });
