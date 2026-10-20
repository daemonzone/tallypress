// Fills product photos fast (the product list only, no per-product requests).
//   npm run shop:images
import "dotenv/config";
import { eq } from "drizzle-orm";
import { db, pool } from "../src/db";
import { shops } from "../src/db/schema";
import { syncItemImages } from "../src/lib/sync/items";

async function main() {
  const shopId = process.env.DEFAULT_SHOP_ID;
  if (!shopId) throw new Error("DEFAULT_SHOP_ID is not set");
  const [shop] = await db.select().from(shops).where(eq(shops.id, shopId));
  if (!shop) throw new Error("Shop not found");
  console.log(`Photos filled for ${await syncItemImages(shop)} items.`);
}

main()
  .then(() => pool.end())
  .catch(async (err) => {
    console.error(err instanceof Error ? err.message : err);
    await pool.end();
    process.exit(1);
  });
