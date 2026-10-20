import { db } from "@/db";
import { monthClosings } from "@/db/schema";
import { freezeCosts } from "./costs";
import { centsToString } from "./money";
import { buildReport } from "./report";

/**
 * Closes every finished month that is still open, oldest first, writing an immutable
 * snapshot whose balance the next month starts from. Safe to call any time and from
 * several places (cron, page load, after a sync): the (shop, month) key makes it
 * idempotent. Does nothing until the starting point has been recorded.
 */
export async function ensureMonthsClosed(shopId: string): Promise<string[]> {
  const before = await buildReport(shopId);
  if (!before?.hasOpening) return [];

  const due = before.months.filter((m) => !m.closed && m.key < before.currentKey);
  if (!due.length) return [];

  // Costs must be frozen first, or a closed month would be missing COGS.
  await freezeCosts(shopId);
  const report = await buildReport(shopId);
  if (!report) return [];

  const closed: string[] = [];
  for (const m of report.months) {
    if (m.closed || m.key >= report.currentKey) continue;
    await db
      .insert(monthClosings)
      .values({
        shopId,
        month: m.key,
        ordersCount: m.orders,
        grossTotal: centsToString(m.gross - m.lateAdjustments),
        adjustments: centsToString(m.lateAdjustments),
        vatTotal: centsToString(m.vat),
        cogsTotal: centsToString(m.cogs),
        taxReserve: centsToString(m.taxReserve),
        netTotal: centsToString(m.netEarnings),
        balance: centsToString(m.end),
      })
      .onConflictDoNothing();
    closed.push(m.key);
  }
  return closed;
}
