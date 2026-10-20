import { eq, sql } from "drizzle-orm";
import { db } from "@/db";
import { monthClosings, orderLines } from "@/db/schema";
import { ensureMonthsClosed } from "./closing";
import { freezeCosts } from "./costs";

/**
 * Recomputes every purchase cost from the items' current estimates: the opening stock lots take
 * their item's estimate, every line's frozen cost is cleared and re-frozen, and the closed months
 * are closed again. For when the ESTIMATES change (a new percentage, a corrected price base).
 * Items with a cost entered by hand are left as they are, and so are lots from recorded restocks.
 * Everything cleared here is derived data, so nothing entered by hand is lost.
 */
export async function rebuildCosts(shopId: string): Promise<{ lots: number; lines: number; closedMonths: string[] }> {
  const lots = await db.execute(sql`
    UPDATE restock_lots r SET unit_cost = i.manual_unit_cost
    FROM items i
    WHERE r.shop_id = ${shopId} AND r.item_id = i.id AND r.source = 'opening'
      AND i.cost_source = 'estimate' AND i.manual_unit_cost IS NOT NULL`);
  const lines = await db.update(orderLines).set({ unitCostSnapshot: null }).where(eq(orderLines.shopId, shopId));
  await db.delete(monthClosings).where(eq(monthClosings.shopId, shopId));
  await freezeCosts(shopId);
  const closedMonths = await ensureMonthsClosed(shopId);
  return { lots: lots.rowCount ?? 0, lines: lines.rowCount ?? 0, closedMonths };
}
