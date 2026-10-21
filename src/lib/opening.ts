import { and, eq, gte, inArray, lte, sql } from "drizzle-orm";
import { db } from "@/db";
import { items, ledgerEntries, orderLines, orders, restockLots, shops } from "@/db/schema";
import { COUNTED_STATUSES } from "./costs";
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

/**
 * The opening stock for a given start date, per item: what WooCommerce holds now, plus what was
 * sold since `from`, minus what was restocked since (recorded or estimated). `asOf` is when the
 * WooCommerce stock was read (the last sync); later orders are not part of that stock.
 * The unit cost is the item's previous opening cost, else its cost estimate.
 */
export async function computeOpeningLots(shopId: string, from: Date, asOf: Date | null, keep: Map<string, number> = new Map()) {
  const soldRows = await db
    .select({ itemId: orderLines.itemId, qty: sql<string>`sum(${orderLines.quantity} - ${orderLines.returnedQty})` })
    .from(orderLines)
    .innerJoin(orders, eq(orders.id, orderLines.orderId))
    .where(
      and(
        eq(orderLines.shopId, shopId),
        inArray(orders.status, COUNTED_STATUSES),
        gte(orders.placedAt, from),
        asOf ? lte(orders.placedAt, asOf) : undefined,
      ),
    )
    .groupBy(orderLines.itemId);
  const sold = new Map(soldRows.filter((r) => r.itemId).map((r) => [r.itemId!, Number(r.qty)]));

  const lots = await db.select().from(restockLots).where(eq(restockLots.shopId, shopId));
  const oldOpeningCost = new Map(lots.filter((l) => l.source === "opening").map((l) => [l.itemId, Number(l.unitCost)]));
  const restocked = new Map<string, number>();
  for (const l of lots.filter((l) => l.source !== "opening")) {
    restocked.set(l.itemId, (restocked.get(l.itemId) ?? 0) + Number(l.quantity));
  }

  const itemRows = await db.select().from(items).where(eq(items.shopId, shopId));
  return itemRows.flatMap((item) => {
    if (!item.managesStock || item.stockQty == null) return [];
    // `keep`: differences still to be classified (WooCommerce minus tracked) stay differences instead of being absorbed.
    const quantity = Number(item.stockQty) + (sold.get(item.id) ?? 0) - (restocked.get(item.id) ?? 0) - (keep.get(item.id) ?? 0);
    const unitCost = oldOpeningCost.get(item.id) ?? (item.manualUnitCost == null ? null : Number(item.manualUnitCost));
    return quantity > 0 && unitCost != null
      ? [{ shopId, itemId: item.id, quantity: String(quantity), unitCost: unitCost.toFixed(4), purchasedAt: from, source: "opening" as const }]
      : [];
  });
}

/** Replaces the opening lots with freshly computed ones at the shop's current starting date. */
export async function rebuildOpeningLots(shopId: string, keep: Map<string, number> = new Map()): Promise<number> {
  const [shop] = await db.select().from(shops).where(eq(shops.id, shopId));
  if (!shop?.baselineAt) throw new Error("The shop has no starting point");
  const newLots = await computeOpeningLots(shopId, shop.baselineAt, shop.lastSyncedAt, keep);
  await db.transaction(async (tx) => {
    await tx.delete(restockLots).where(and(eq(restockLots.shopId, shopId), eq(restockLots.source, "opening")));
    for (let i = 0; i < newLots.length; i += 500) await tx.insert(restockLots).values(newLots.slice(i, i + 500));
  });
  return newLots.length;
}
