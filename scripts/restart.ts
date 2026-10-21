// Moves the starting point to a new day with the real bank balance of that day. Sales are not touched;
// everything dated before the new start (ledger entries, lots, month closings) is removed and the
// opening stock is recomputed. Take a database backup first. Run from the host:
//
//   START_DATE=2026-10-20 START_BALANCE=0 CONFIRM=yes npm run shop:restart
//
// Without CONFIRM=yes it only shows what would be removed.
import "dotenv/config";
import { and, count, eq, inArray, lt, or } from "drizzle-orm";
import { db, pool } from "../src/db";
import { ledgerEntries, restockLots } from "../src/db/schema";
import { restartAt } from "../src/lib/restart";

async function main() {
  const shopId = process.env.DEFAULT_SHOP_ID;
  const start = process.env.START_DATE;
  if (!shopId) throw new Error("DEFAULT_SHOP_ID is required");
  if (!start || !/^\d{4}-\d{2}-\d{2}$/.test(start)) throw new Error("START_DATE must be YYYY-MM-DD");
  const startsAt = new Date(`${start}T00:00:00Z`);
  const balanceCents = Math.round(Number(process.env.START_BALANCE ?? "0") * 100);

  const byKind = await db
    .select({ kind: ledgerEntries.kind, estimated: ledgerEntries.estimated, n: count() })
    .from(ledgerEntries)
    .where(and(eq(ledgerEntries.shopId, shopId), lt(ledgerEntries.occurredAt, startsAt)))
    .groupBy(ledgerEntries.kind, ledgerEntries.estimated);
  const [{ n: lots }] = await db
    .select({ n: count() })
    .from(restockLots)
    .where(and(eq(restockLots.shopId, shopId), or(inArray(restockLots.source, ["opening", "estimate"]), lt(restockLots.purchasedAt, startsAt))));
  console.log(`Starting point ${start}, balance ${(balanceCents / 100).toFixed(2)}.`);
  console.log("Ledger entries that would be removed:", byKind.map((r) => `${r.kind}${r.estimated ? " (estimated)" : ""}: ${r.n}`).join(", ") || "none");
  console.log(`Stock lots that would be removed (opening, estimated, or before the start): ${lots}`);
  if (process.env.CONFIRM !== "yes") return console.log("Nothing changed. Set CONFIRM=yes to proceed.");

  const result = await restartAt(shopId, startsAt, balanceCents);
  console.log(`Removed ${result.ledgerRemoved} ledger entries and ${result.lotsRemoved} lots; ${result.openingLots} opening lots created; months closed: ${result.closedMonths.length}.`);
}

main()
  .then(() => pool.end())
  .catch(async (err) => {
    console.error(err instanceof Error ? err.message : err);
    await pool.end();
    process.exit(1);
  });
