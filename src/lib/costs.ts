import { and, count, eq, gte, ilike, inArray, isNotNull, isNull, or, sql } from "drizzle-orm";
import { db } from "@/db";
import { items, orderLines, orders, restockLots, shops } from "@/db/schema";

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
  // Stock is tracked from the baseline: sales before it (sales history) are not part of the stock.
  const [shopRow] = await db.select({ baselineAt: shops.baselineAt }).from(shops).where(eq(shops.id, shopId));
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
          shopRow?.baselineAt ? gte(orders.placedAt, shopRow.baselineAt) : undefined,
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
 * Links order lines that have no item yet to the catalogue item with the same WooCommerce
 * product and variation (an item can appear after the line was imported, e.g. a product that
 * was restored from the trash). Returns how many lines were linked.
 */
export async function relinkLines(shopId: string): Promise<number> {
  const res = await db.execute(sql`
    UPDATE order_lines l SET item_id = i.id
    FROM items i
    WHERE l.shop_id = ${shopId} AND l.item_id IS NULL
      AND i.shop_id = l.shop_id AND i.woo_product_id = l.woo_product_id AND i.woo_variation_id = l.woo_variation_id`);
  return res.rowCount ?? 0;
}

/**
 * Gives every counted, still-uncosted order line its purchase cost and stores it.
 * Frozen lines are never touched, so closed months cannot move.
 *
 * A line that still has no cost (typically a product that is no longer in the catalogue) gets
 * the shop's default estimate: `default_cost_pct` of the line's own price without VAT.
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

  const [shop] = await db.select().from(shops).where(eq(shops.id, shopId));
  if (shop?.defaultCostPct != null) {
    const pct = Number(shop.defaultCostPct);
    const vat = Number(shop.vatRate);
    const rest = await db
      .select({ id: orderLines.id, quantity: orderLines.quantity, gross: orderLines.grossTotal, base: orderLines.subtotalGross, itemCost: items.manualUnitCost })
      .from(orderLines)
      .innerJoin(orders, eq(orders.id, orderLines.orderId))
      .leftJoin(items, eq(items.id, orderLines.itemId))
      .where(and(eq(orderLines.shopId, shopId), inArray(orders.status, COUNTED_STATUSES), isNull(orderLines.unitCostSnapshot)));
    for (const l of rest) {
      const qty = Number(l.quantity);
      if (!(qty > 0)) continue;
      // Prefer the item's own cost estimate (from its list price); otherwise the line's price before coupons.
      const unit = l.itemCost != null ? Number(l.itemCost) : ((Number(l.base ?? l.gross) / (1 + vat / 100) / qty) * pct) / 100;
      await db.update(orderLines).set({ unitCostSnapshot: unit.toFixed(4) }).where(eq(orderLines.id, l.id));
      frozen++;
    }
  }
  return frozen;
}

export interface ItemState {
  id: string;
  label: string;
  sku: string | null;
  imageUrl: string | null;
  status: string;
  wooStock: number | null;
  trackedStock: number | null; // null: no purchase history, so stock is not tracked
  avgCost: number | null;
  manualCost: number | null;
  stockValue: number;
}

function toState(item: typeof items.$inferSelect, lots: LotEvent[], sales: SaleEvent[]): ItemState {
  const manual = item.manualUnitCost == null ? null : Number(item.manualUnitCost);
  const r = replayItem(lots, sales, manual);
  return {
    id: item.id,
    label: item.variationLabel ? `${item.productName} – ${item.variationLabel}` : item.productName,
    sku: item.sku,
    imageUrl: item.imageUrl,
    status: item.status,
    wooStock: item.stockQty == null ? null : Number(item.stockQty),
    trackedStock: lots.length ? r.stock : null,
    avgCost: r.avg,
    manualCost: manual,
    stockValue: r.stock > 0 && r.avg != null ? r.stock * r.avg : 0,
  };
}

/** Tracked stock and average cost for every item (used for totals). */
export async function getItemStates(shopId: string): Promise<ItemState[]> {
  const { lotsByItem, salesByItem } = await loadHistory(shopId);
  const itemRows = await db.select().from(items).where(eq(items.shopId, shopId));
  return itemRows
    .map((item) => toState(item, lotsByItem.get(item.id) ?? [], salesByItem.get(item.id) ?? []))
    .sort((a, b) => a.label.localeCompare(b.label));
}

/**
 * One page of items for the stock page, optionally filtered by a search on product name,
 * variation or SKU. Only the items on the page have their history loaded and replayed.
 */
export async function getItemStatePage(
  shopId: string,
  opts: { q?: string; page: number; perPage: number },
): Promise<{ rows: ItemState[]; total: number; page: number; pages: number }> {
  const term = opts.q?.trim();
  const like = term ? `%${term.replace(/[\\%_]/g, "\\$&")}%` : null;
  const where = and(
    eq(items.shopId, shopId),
    like ? or(ilike(items.productName, like), ilike(items.variationLabel, like), ilike(items.sku, like)) : undefined,
  );

  const [{ n: total }] = await db.select({ n: count() }).from(items).where(where);
  const pages = Math.max(1, Math.ceil(total / opts.perPage));
  const page = Math.min(Math.max(1, opts.page), pages);
  const pageItems = await db
    .select()
    .from(items)
    .where(where)
    .orderBy(items.productName, items.variationLabel)
    .limit(opts.perPage)
    .offset((page - 1) * opts.perPage);
  if (!pageItems.length) return { rows: [], total, page, pages };

  const { lotsByItem, salesByItem } = await loadHistory(shopId, pageItems.map((i) => i.id));
  return {
    rows: pageItems.map((item) => toState(item, lotsByItem.get(item.id) ?? [], salesByItem.get(item.id) ?? [])),
    total,
    page,
    pages,
  };
}
