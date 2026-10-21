import { and, count, countDistinct, eq, gte, ilike, inArray, isNotNull, isNull, min, or, sql } from "drizzle-orm";
import { db } from "@/db";
import { items, orderLines, orders, restockLots, shops } from "@/db/schema";

/** Orders in these statuses count as earned (see product decisions). */
export const COUNTED_STATUSES = ["processing", "completed"];

export interface LotEvent {
  at: Date;
  qty: number;
  cost: number; // per unit, net of VAT
  real?: boolean; // a purchase the owner recorded (restock / return), not an estimate or opening stock
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
        quantity: sql<string>`${orderLines.quantity} - ${orderLines.returnedQty}`,
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
    list.push({ at: l.purchasedAt, qty: Number(l.quantity), cost: Number(l.unitCost), real: l.source === "restock" });
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
  productId: number;
  label: string;
  sku: string | null;
  variation: string | null; // e.g. "M / NERO"
  imageUrl: string | null;
  status: string;
  costSource: "estimate" | "manual";
  price: number | null; // list price (VAT included), else the current price
  listPrice: number | null; // the list price (regular price), VAT included
  shopPrice: number | null; // what the customer pays today (the sale price while a sale is on), VAT included
  realRestocks: boolean; // the average cost comes from purchases the owner recorded
  wooStock: number | null;
  trackedStock: number | null; // null: no purchase history, so stock is not tracked
  diff: number | null; // WooCommerce quantity minus tracked quantity, when both are known (+: pieces came in unrecorded)
  avgCost: number | null;
  manualCost: number | null;
  stockValue: number;
}

function toState(item: typeof items.$inferSelect, lots: LotEvent[], sales: SaleEvent[]): ItemState {
  const manual = item.manualUnitCost == null ? null : Number(item.manualUnitCost);
  const r = replayItem(lots, sales, manual);
  return {
    id: item.id,
    productId: item.wooProductId,
    label: item.variationLabel ? `${item.productName} – ${item.variationLabel}` : item.productName,
    sku: item.sku,
    variation: item.variationLabel,
    imageUrl: item.imageUrl,
    status: item.status,
    costSource: item.costSource,
    price: item.regularPrice != null ? Number(item.regularPrice) : item.price != null ? Number(item.price) : null,
    listPrice: item.regularPrice != null ? Number(item.regularPrice) : item.price != null ? Number(item.price) : null,
    shopPrice: item.price != null ? Number(item.price) : item.regularPrice != null ? Number(item.regularPrice) : null,
    realRestocks: lots.some((l) => l.real),
    wooStock: item.stockQty == null ? null : Number(item.stockQty),
    // Tracked from the starting point: an item with no purchase yet is tracked at zero (it is the stock that appears later that must be explained).
    trackedStock: lots.length || item.stockQty != null ? r.stock : null,
    diff: item.stockQty != null ? Number(item.stockQty) - r.stock : null,
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

export interface Range {
  min: number;
  max: number;
}

/** The sale discount of a price pair, as a ratio (0.655 = 65.5% off), or null when there is no sale. */
export function saleDiscount(list: number | null, shop: number | null): number | null {
  return list != null && shop != null && list > 0 && shop < list - 0.005 ? 1 - shop / list : null;
}

export interface PricingSummary {
  list: Range | null;
  shop: Range | null;
  discount: Range | null; // over the variations that are on sale
  onSale: number; // variations on sale
  priced: number; // variations that have a price
  avgDiscount: number | null; // 1 - average shop price / average list price (a ratio), null when nothing is on sale
  mixed: boolean; // the variations are not all on sale at the same discount
}

function summarizePricing(states: ItemState[]): PricingSummary {
  // The variations still in the shop; a product that is gone altogether is summarized by what it had.
  const live = states.filter((s) => s.status !== "trash" && s.status !== "deleted");
  const base = (live.length ? live : states).filter((s) => s.listPrice != null || s.shopPrice != null);
  const range = (values: number[]): Range | null => (values.length ? { min: Math.min(...values), max: Math.max(...values) } : null);
  const discounts = base.map((s) => saleDiscount(s.listPrice, s.shopPrice)).filter((d): d is number => d != null);
  const both = base.filter((s) => s.listPrice != null && s.shopPrice != null);
  const mean = (values: number[]) => (values.length ? values.reduce((a, b) => a + b, 0) / values.length : 0);
  const discountRange = range(discounts);
  return {
    list: range(base.map((s) => s.listPrice).filter((n): n is number => n != null)),
    shop: range(base.map((s) => s.shopPrice).filter((n): n is number => n != null)),
    discount: discountRange,
    onSale: discounts.length,
    priced: base.length,
    avgDiscount: discounts.length ? saleDiscount(mean(both.map((s) => s.listPrice!)), mean(both.map((s) => s.shopPrice!))) : null,
    mixed: discounts.length > 0 && (discounts.length < base.length || (discountRange != null && discountRange.max - discountRange.min > 0.0005)),
  };
}

export interface ProductGroup {
  productId: number;
  name: string;
  code: string | null; // the product's own code, when it has one
  imageUrl: string | null;
  status: string; // "trash" / "deleted" only when every variation is
  items: ItemState[]; // sizes and colours
  wooStock: number | null; // total over the variations that report a quantity
  mismatch: boolean; // at least one variation does not match the internal figures
  stockValue: number;
  cost: { min: number; max: number } | null; // unit cost across the variations
  unitCost: number | null; // average unit cost over the variations (net of VAT)
  price: number | null; // average list price over the variations (VAT included)
  pricing: PricingSummary; // list price, shop price and sale of the variations, as ranges
  costSource: "estimate" | "manual" | "mixed";
}

/**
 * One page of products (not items) for the stock page, each with all its variations. The search
 * matches the product name, any variation, any code; only the products on the page have their
 * history loaded and replayed.
 */
export async function getProductPage(
  shopId: string,
  opts: { q?: string; page: number; perPage: number; productIds?: number[] },
): Promise<{ groups: ProductGroup[]; total: number; page: number; pages: number }> {
  const term = opts.q?.trim();
  const like = term ? `%${term.replace(/[\\%_]/g, "\\$&")}%` : null;
  const where = and(
    eq(items.shopId, shopId),
    like
      ? or(ilike(items.productName, like), ilike(items.variationLabel, like), ilike(items.sku, like), ilike(items.productSku, like))
      : undefined,
    opts.productIds ? inArray(items.wooProductId, opts.productIds.length ? opts.productIds : [-1]) : undefined,
  );

  const [{ n: total }] = await db.select({ n: countDistinct(items.wooProductId) }).from(items).where(where);
  const pages = Math.max(1, Math.ceil(total / opts.perPage));
  const page = Math.min(Math.max(1, opts.page), pages);
  const pageProducts = await db
    .select({ id: items.wooProductId })
    .from(items)
    .where(where)
    .groupBy(items.wooProductId)
    .orderBy(min(items.productName), items.wooProductId)
    .limit(opts.perPage)
    .offset((page - 1) * opts.perPage);
  if (!pageProducts.length) return { groups: [], total, page, pages };

  const productIds = pageProducts.map((r) => r.id);
  const itemRows = await db
    .select()
    .from(items)
    .where(and(eq(items.shopId, shopId), inArray(items.wooProductId, productIds)));
  const { lotsByItem, salesByItem } = await loadHistory(shopId, itemRows.map((i) => i.id));

  const byProduct = new Map<number, typeof itemRows>();
  for (const i of itemRows) byProduct.set(i.wooProductId, [...(byProduct.get(i.wooProductId) ?? []), i]);

  const groups = productIds.map((productId): ProductGroup => {
    const rows = (byProduct.get(productId) ?? []).sort((a, b) =>
      (a.variationLabel ?? "").localeCompare(b.variationLabel ?? "", undefined, { numeric: true }),
    );
    const states = rows.map((i) => toState(i, lotsByItem.get(i.id) ?? [], salesByItem.get(i.id) ?? []));
    const reporting = states.filter((s) => s.wooStock != null);
    const costs = states.map((s) => s.avgCost).filter((c): c is number => c != null);
    // What the panel shows is the current average, which real restocks move; "estimate" only while no purchase backs it.
    const sources = new Set(states.map((s) => (s.realRestocks ? "manual" : s.costSource)));
    return {
      productId,
      name: rows[0]?.productName ?? "",
      code: rows.find((r) => r.productSku)?.productSku ?? null,
      imageUrl: states.find((s) => s.imageUrl)?.imageUrl ?? null,
      status: states.every((s) => s.status === "trash" || s.status === "deleted") ? states[0].status : "publish",
      items: states,
      wooStock: reporting.length ? reporting.reduce((sum, s) => sum + (s.wooStock ?? 0), 0) : null,
      mismatch: states.some((s) => s.wooStock != null && s.trackedStock != null && s.wooStock !== s.trackedStock),
      stockValue: states.reduce((sum, s) => sum + s.stockValue, 0),
      cost: costs.length ? { min: Math.min(...costs), max: Math.max(...costs) } : null,
      pricing: summarizePricing(states),
      unitCost: costs.length ? costs.reduce((a, b) => a + b, 0) / costs.length : null,
      price: (() => {
        const prices = states.map((s) => s.price).filter((p): p is number => p != null && p > 0);
        return prices.length ? prices.reduce((a, b) => a + b, 0) / prices.length : null;
      })(),
      costSource: sources.size > 1 ? "mixed" : (states[0]?.costSource ?? "estimate"),
    };
  });
  return { groups, total, page, pages };
}

/** Every variation whose WooCommerce quantity differs from the tracked one, grouped by product. */
export interface ProductDifference {
  productId: number;
  name: string;
  imageUrl: string | null;
  items: { id: string; label: string; diff: number }[];
}

export async function getDifferences(shopId: string): Promise<ProductDifference[]> {
  const states = (await getItemStates(shopId)).filter((s) => s.diff != null && s.diff !== 0 && s.status !== "trash" && s.status !== "deleted");
  const byProduct = new Map<number, ProductDifference>();
  for (const s of states) {
    const g = byProduct.get(s.productId) ?? { productId: s.productId, name: s.label.split(" – ")[0], imageUrl: s.imageUrl, items: [] };
    g.items.push({ id: s.id, label: s.variation ?? "", diff: s.diff! });
    byProduct.set(s.productId, g);
  }
  return [...byProduct.values()].sort((a, b) => a.name.localeCompare(b.name));
}

/** The states of one product's variations (used to settle a difference with fresh figures). */
export async function getProductStates(shopId: string, productId: number): Promise<ItemState[]> {
  const rows = await db.select().from(items).where(and(eq(items.shopId, shopId), eq(items.wooProductId, productId)));
  const { lotsByItem, salesByItem } = await loadHistory(shopId, rows.map((r) => r.id));
  return rows.map((i) => toState(i, lotsByItem.get(i.id) ?? [], salesByItem.get(i.id) ?? []));
}
