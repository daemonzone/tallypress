// Imports the orders of a period without erasing anything. If the period starts before the
// shop's starting date, the history is extended backwards (see src/lib/import-range.ts).
//
//   npm run shop:import-range -- --from 2026-09-01            # up to where the history begins
//   npm run shop:import-range -- --from 2026-09-01 --to 2026-09-30
//   add --rebuild-closings to go back before months that are already closed
import "dotenv/config";
import { pool } from "../src/db";
import { importRange } from "../src/lib/import-range";

const arg = (name: string) => {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
};

async function main() {
  const shopId = process.env.DEFAULT_SHOP_ID;
  const from = arg("from");
  if (!shopId) throw new Error("DEFAULT_SHOP_ID is not set");
  if (!from) throw new Error("--from YYYY-MM-DD is required");

  const result = await importRange(shopId, {
    from,
    to: arg("to"),
    rebuildClosings: process.argv.includes("--rebuild-closings"),
  });
  if (!result.ok) throw new Error(`Import refused: ${result.error}${result.detail ? ` (${result.detail})` : ""}`);

  console.log(`Imported ${result.orders} orders.`);
  if (result.newStart) console.log(`Starting date moved to ${result.newStart}; opening stock rebuilt for ${result.lotsRebuilt} items.`);
  if (result.closedMonths.length) console.log(`Closed months: ${result.closedMonths.map((m) => m.slice(0, 7)).join(", ")}.`);
}

main()
  .then(() => pool.end())
  .catch(async (err) => {
    console.error(err instanceof Error ? err.message : err);
    await pool.end();
    process.exit(1);
  });
