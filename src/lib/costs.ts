import { and, eq, inArray, isNotNull } from "drizzle-orm";
import { db } from "@/db";
import { items, orderLines, orders, restockLots } from "@/db/schema";

/** Orders in these statuses count as earned (see product decisions). */
export const COUNTED_STATUSES = ["processing", "completed"];

export interface LotEvent {
  at: Date;
  qty: number;
  cost: number; // per unit, net of VAT
}

export interface SaleEvent {
  id: string;
  at: Date;
  qty: number;
  snapshot: number | null; // already frozen unit cost, if any
}

export interface Replay {
  assigned: Map<string, number>; // sale id -> newly assigned unit cost
  stock: number;
  value: number;
  avg: number | null; // current moving-average unit cost
}

/**
 * Walks an item's purchases and sales in time order using a moving average:
 * a purchase blends into the average, a sale leaves it unchanged. Already frozen
 * sales keep their cost; unfrozen ones get the average at their moment. With no
 * stock on record the last known average (or the manual cost) is used; with none
 * of those the sale stays uncosted.
 */
export function replayItem(lots: LotEvent[], sales: SaleEvent[], manualCost: number | null): Replay {
  type Event =
    | { at: Date; order: 0; lot: LotEvent; sale?: undefined }
    | { at: Date; order: 1; sale: SaleEvent; lot?: undefined };
  const events: Event[] = [
    ...lots.map((lot): Event => ({ at: lot.at, order: 0, lot })),
    ...sales.map((sale): Event => ({ at: sale.at, order: 1, sale })),
  ].sort((a, b) => a.at.getTime() - b.at.getTime() || a.order - b.order);

  let stock = 0;
  let value = 0;
  let lastAvg: number | null = null;
  const assigned = new Map<string, number>();

  for (const e of events) {
    if (e.lot) {
      const newStock = stock + e.lot.qty;
      // Only units that end up in positive stock carry value.
      value = (stock > 0 ? value : 0) + Math.max(newStock - Math.max(stock, 0), 0) * e.lot.cost;
      stock = newStock;
      if (stock > 0 && value > 0) lastAvg = value / stock;
      continue;
    }
    const sale = e.sale;
    let unit = sale.snapshot;
    if (unit == null) {
      unit = stock > 0 && value > 0 ? value / stock : (lastAvg ?? manualCost);
      if (unit != null) assigned.set(sale.id, unit);
    }
    stock -= sale.qty;
    value = stock > 0 ? Math.max(value - sale.qty * (unit ?? 0), 0) : 0;
  }

  const avg = stock > 0 && value > 0 ? value / stock : (lastAvg ?? manualCost);
  return { assigned, stock, value, avg };
}

async function loadHistory(shopId: string, itemIds?: string[]) {
  const [lots, lines] = await Promise.all([
    db
      .select()
      .from(restockLots)
      .where(and(eq(restockLots.shopId, shopId), itemIds ? inArray(restockLots.itemId, itemIds) : undefined)),
    db
      .select({
        id: orderLines.id,
        itemId: orderLines.itemId,
        quantity: orderLines.quantity,
        snapshot: orderLines.unitCostSnapshot,
        placedAt: orders.placedAt,
      })
      .from(orderLines)
      .innerJoin(orders, eq(orders.id, orderLines.orderId))
      .where(
        and(
          eq(orderLines.shopId, shopId),
          inArray(orders.status, COUNTED_STATUSES),
          isNotNull(orderLines.itemId),
          itemIds ? inArray(orderLines.itemId, itemIds) : undefined,
        ),
      ),
  ]);

  const lotsByItem = new Map<string, LotEvent[]>();
  for (const l of lots) {
    const list = lotsByItem.get(l.itemId) ?? [];
    list.push({ at: l.purchasedAt, qty: Number(l.quantity), cost: Number(l.unitCost) });
    lotsByItem.set(l.itemId, list);
  }
  const salesByItem = new Map<string, SaleEvent[]>();
  for (const l of lines) {
    const list = salesByItem.get(l.itemId!) ?? [];
    list.push({
      id: l.id,
      at: l.placedAt,
      qty: Number(l.quantity),
      snapshot: l.snapshot == null ? null : Number(l.snapshot),
    });
    salesByItem.set(l.itemId!, list);
  }
  return { lotsByItem, salesByItem };
}

/**
 * Gives every counted, still-uncosted order line its purchase cost and stores it.
 * Frozen lines are never touched, so closed months cannot move.
 */
export async function freezeCosts(shopId: string): Promise<number> {
  const { lotsByItem, salesByItem } = await loadHistory(shopId);
  const itemRows = await db.select().from(items).where(eq(items.shopId, shopId));
  let frozen = 0;

  for (const item of itemRows) {
    const sales = salesByItem.get(item.id) ?? [];
    if (!sales.some((s) => s.snapshot == null)) continue;

    const manual = item.manualUnitCost == null ? null : Number(item.manualUnitCost);
    const { assigned } = replayItem(lotsByItem.get(item.id) ?? [], sales, manual);
    for (const [lineId, unit] of assigned) {
      await db
        .update(orderLines)
        .set({ unitCostSnapshot: unit.toFixed(4) })
        .where(eq(orderLines.id, lineId));
      frozen++;
    }
  }
  return frozen;
}

export interface ItemState {
  id: string;
  label: string;
  sku: string | null;
  wooStock: number | null;
  trackedStock: number;
  avgCost: number | null;
  manualCost: number | null;
  stockValue: number;
}

/** Tracked stock and average cost per item, for the stock page. */
export async function getItemStates(shopId: string): Promise<ItemState[]> {
  const { lotsByItem, salesByItem } = await loadHistory(shopId);
  const itemRows = await db.select().from(items).where(eq(items.shopId, shopId));

  return itemRows
    .map((item) => {
      const manual = item.manualUnitCost == null ? null : Number(item.manualUnitCost);
      const r = replayItem(lotsByItem.get(item.id) ?? [], salesByItem.get(item.id) ?? [], manual);
      return {
        id: item.id,
        label: item.variationLabel ? `${item.productName} – ${item.variationLabel}` : item.productName,
        sku: item.sku,
        wooStock: item.stockQty == null ? null : Number(item.stockQty),
        trackedStock: r.stock,
        avgCost: r.avg,
        manualCost: manual,
        stockValue: r.stock > 0 && r.avg != null ? r.stock * r.avg : 0,
      };
    })
    .sort((a, b) => a.label.localeCompare(b.label));
}
