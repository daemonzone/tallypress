// Recomputes all purchase costs from the items' current estimates (see src/lib/rebuild-costs.ts).
//   npm run shop:rebuild-costs
import "dotenv/config";
import { pool } from "../src/db";
import { rebuildCosts } from "../src/lib/rebuild-costs";

async function main() {
  const shopId = process.env.DEFAULT_SHOP_ID;
  if (!shopId) throw new Error("DEFAULT_SHOP_ID is not set");
  const r = await rebuildCosts(shopId);
  console.log(`Opening lots re-priced: ${r.lots}; lines re-costed: ${r.lines}; months closed again: ${r.closedMonths.length}.`);
}

main()
  .then(() => pool.end())
  .catch(async (err) => {
    console.error(err instanceof Error ? err.message : err);
    await pool.end();
    process.exit(1);
  });
