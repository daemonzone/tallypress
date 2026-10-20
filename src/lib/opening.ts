import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { items, ledgerEntries, restockLots, shops } from "@/db/schema";
import { centsToString } from "./money";

export interface OpeningLot {
  itemId: string;
  quantity: number;
  unitCost: number; // per unit, net of VAT
}

export interface OpeningInput {
  baselineAt: Date;
  balanceCents: number;
  lots: OpeningLot[];
  /** Fallback unit cost per item id, for items with no purchase history. */
  manualCosts?: Record<string, number>;
  /** Forget the sync cursor so the next sync re-reads everything since the new baseline. */
  resetSync?: boolean;
}

export async function hasOpening(shopId: string): Promise<boolean> {
  const [row] = await db
    .select({ id: ledgerEntries.id })
    .from(ledgerEntries)
    .where(and(eq(ledgerEntries.shopId, shopId), eq(ledgerEntries.kind, "opening_balance")));
  return !!row;
}

/**
 * Records the "zero time": baseline date, starting bank balance, opening stock lots and
 * optional manual costs. Allowed once per shop; returns false if it already exists.
 */
export async function recordOpening(shopId: string, input: OpeningInput): Promise<boolean> {
  if (await hasOpening(shopId)) return false;

  await db.transaction(async (tx) => {
    await tx
      .update(shops)
      .set({ baselineAt: input.baselineAt, ...(input.resetSync === false ? {} : { lastSyncedAt: null }) })
      .where(eq(shops.id, shopId));

    const lots = input.lots.map((l) => ({
      shopId,
      itemId: l.itemId,
      quantity: String(l.quantity),
      unitCost: l.unitCost.toFixed(4),
      purchasedAt: input.baselineAt,
      source: "opening" as const,
    }));
    for (let i = 0; i < lots.length; i += 500) {
      await tx.insert(restockLots).values(lots.slice(i, i + 500));
    }

    for (const [itemId, cost] of Object.entries(input.manualCosts ?? {})) {
      await tx
        .update(items)
        .set({ manualUnitCost: cost.toFixed(4) })
        .where(and(eq(items.id, itemId), eq(items.shopId, shopId)));
    }

    await tx.insert(ledgerEntries).values({
      shopId,
      kind: "opening_balance",
      amount: centsToString(input.balanceCents),
      occurredAt: input.baselineAt,
      note: "Starting point",
    });
  });
  return true;
}
