import { and, eq, inArray, lt, or } from "drizzle-orm";
import { db } from "@/db";
import { ledgerEntries, monthClosings, restockLots, shops } from "@/db/schema";
import { pendingDifferences } from "./estimate-restocks";
import { centsToString } from "./money";
import { computeOpeningLots } from "./opening";
import { rebuildCosts } from "./rebuild-costs";

export interface RestartResult {
  ledgerRemoved: number;
  lotsRemoved: number;
  openingLots: number;
  closedMonths: string[];
}

/**
 * Moves the starting point ("zero time") to `startsAt` with the real bank balance on that day.
 * Everything before it stops counting: ledger entries dated before it (estimated purchases, VAT and
 * tax payments included) are removed, the month closings are redone, the stock lots are replaced by an
 * opening stock computed at that date (what WooCommerce holds now, plus what sold since, minus what
 * was restocked since). Months before it become sales history. Entries and lots dated on or after it
 * (real movements, real restocks) are kept, and so are the differences nobody has classified yet.
 * Sales are never touched.
 */
export async function restartAt(shopId: string, startsAt: Date, balanceCents: number): Promise<RestartResult> {
  const keep = await pendingDifferences(shopId);

  const removed = await db.transaction(async (tx) => {
    await tx.delete(monthClosings).where(eq(monthClosings.shopId, shopId));
    const ledger = await tx
      .delete(ledgerEntries)
      // The old opening entry goes whatever its date: the new one replaces it.
      .where(and(eq(ledgerEntries.shopId, shopId), or(lt(ledgerEntries.occurredAt, startsAt), eq(ledgerEntries.kind, "opening_balance"))));
    const lots = await tx
      .delete(restockLots)
      .where(
        and(
          eq(restockLots.shopId, shopId),
          or(inArray(restockLots.source, ["opening", "estimate"]), lt(restockLots.purchasedAt, startsAt)),
        ),
      );
    await tx.update(shops).set({ baselineAt: startsAt }).where(eq(shops.id, shopId));
    return { ledger: ledger.rowCount ?? 0, lots: lots.rowCount ?? 0 };
  });

  const [shop] = await db.select().from(shops).where(eq(shops.id, shopId));
  const newLots = await computeOpeningLots(shopId, startsAt, shop.lastSyncedAt, keep);
  await db.transaction(async (tx) => {
    for (let i = 0; i < newLots.length; i += 500) await tx.insert(restockLots).values(newLots.slice(i, i + 500));
    await tx.insert(ledgerEntries).values({
      shopId,
      kind: "opening_balance",
      amount: centsToString(balanceCents),
      occurredAt: startsAt,
      note: "Starting point",
    });
  });

  const rebuilt = await rebuildCosts(shopId);
  return { ledgerRemoved: removed.ledger, lotsRemoved: removed.lots, openingLots: newLots.length, closedMonths: rebuilt.closedMonths };
}
