// Reads the order notes of every refunded order and records the units WooCommerce put back in stock,
// then recomputes costs and months. Read-only against the shop. Run from the host:
//   npm run shop:returns
import "dotenv/config";
import { and, eq, gt, inArray } from "drizzle-orm";
import { db, pool } from "../src/db";
import { orders, shops } from "../src/db/schema";
import { COUNTED_STATUSES } from "../src/lib/costs";
import { applyReturns, refreshAfterReturns } from "../src/lib/returns";

async function main() {
  const shopId = process.env.DEFAULT_SHOP_ID;
  if (!shopId) throw new Error("DEFAULT_SHOP_ID is required");
  const [shop] = await db.select().from(shops).where(eq(shops.id, shopId));
  if (!shop) throw new Error("Shop not found");
  const rows = await db
    .select({ id: orders.wooOrderId })
    .from(orders)
    .where(and(eq(orders.shopId, shopId), gt(orders.refundedTotal, "0"), inArray(orders.status, COUNTED_STATUSES)));
  console.log(`${rows.length} refunded orders still counted as sales.`);
  const changed = await applyReturns(shop, rows.map((r) => r.id));
  console.log(`${changed} order lines now carry returned units.`);
  if (changed > 0) {
    await refreshAfterReturns(shopId);
    console.log("Costs, estimated purchases and months recomputed.");
  }
}

main()
  .then(() => pool.end())
  .catch(async (err) => {
    console.error(err instanceof Error ? err.message : err);
    await pool.end();
    process.exit(1);
  });
