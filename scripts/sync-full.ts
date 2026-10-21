// Re-reads the whole catalogue from WooCommerce (the normal sync reads only what changed).
// Slow, about a minute and a half: use it when something looks stale, e.g. a product deleted
// for good or a change made straight in the WordPress database.
//   npm run shop:sync-full
import "dotenv/config";
import { pool } from "../src/db";
import { syncShop } from "../src/lib/sync";

async function main() {
  const shopId = process.env.DEFAULT_SHOP_ID;
  if (!shopId) throw new Error("DEFAULT_SHOP_ID is not set");
  const result = await syncShop(shopId, { full: true });
  if (!result.ok) throw new Error(result.error);
  console.log(`Synced ${result.items} items and ${result.orders} orders.`);
}

main()
  .then(() => pool.end())
  .catch(async (err) => {
    console.error(err instanceof Error ? err.message : err);
    await pool.end();
    process.exit(1);
  });
