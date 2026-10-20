import { eq, sql } from "drizzle-orm";
import { db } from "@/db";
import { monthClosings, restockLots, shops } from "@/db/schema";
import { figures, monthKeyOf, monthRange, profileOf, toCents, type Figures } from "./money";

export interface ItemRow extends Figures {
  itemId: string | null;
  label: string;
  sku: string | null;
  qty: number;
  missingCost: number; // sold lines without a purchase cost yet
}

export interface Flows {
  sales: number;
  restock: number;
  withdrawal: number;
  expense: number;
  other: number; // opening balance + manual adjustments
}

export interface MonthReport extends Figures {
  key: string; // first day of the month, "YYYY-MM-01"
  closed: boolean;
  orders: number;
  lateAdjustments: number; // changes to earlier closed months, folded into this one
  missingCostLines: number;
  start: number; // balance carried in
  flows: Flows;
  end: number; // balance carried out
  items: ItemRow[];
  shipping: Figures; // everything not tied to an item: shipping, refunds, adjustments
}

export interface Overview {
  cash: number;
  vatReserve: number;
  taxReserve: number;
  netEarnings: number;
  withdrawn: number;
  invested: number; // opening stock value + restock spend
  roi: number | null; // net earnings / invested
}

export interface Report {
  shopId: string;
  currency: string;
  currentKey: string;
  hasOpening: boolean;
  months: MonthReport[];
  overview: Overview;
}

type Row = Record<string, string | number | null>;
const rowsOf = async (query: ReturnType<typeof sql>) => (await db.execute(query)).rows as Row[];

export async function buildReport(shopId: string): Promise<Report | null> {
  const [shop] = await db.select().from(shops).where(eq(shops.id, shopId));
  if (!shop?.baselineAt) return null;

  const tz = shop.timezone;
  const profile = profileOf(shop);
  // Per-item rows carry no tax of their own: the month's reserve is shared out afterwards.
  const noTax = { ...profile, brackets: null, incomeTaxRate: 0, socialRate: 0 };
  const monthSql = (col: string) =>
    sql.raw(`to_char(date_trunc('month', ${col} AT TIME ZONE '${tz.replace(/'/g, "")}'), 'YYYY-MM-01')`);
  const baseline = shop.baselineAt.toISOString();

  const [orderRows, itemRowsRaw, ledgerRows, closingRows, lotRows] = await Promise.all([
    rowsOf(sql`
      SELECT ${monthSql("o.placed_at")} AS month, count(*)::int AS orders,
             coalesce(sum(o.gross_total - o.refunded_total), 0)::text AS gross
      FROM orders o
      WHERE o.shop_id = ${shopId} AND o.status IN ('processing', 'completed')
        AND o.placed_at >= ${baseline}::timestamptz
      GROUP BY 1`),
    rowsOf(sql`
      SELECT ${monthSql("o.placed_at")} AS month, l.item_id, i.sku,
             coalesce(i.product_name, '?') AS product_name, i.variation_label,
             sum(l.quantity)::text AS qty, sum(l.gross_total)::text AS gross,
             sum(l.quantity * coalesce(l.unit_cost_snapshot, 0))::text AS cogs,
             (count(*) FILTER (WHERE l.unit_cost_snapshot IS NULL))::int AS missing
      FROM order_lines l
      JOIN orders o ON o.id = l.order_id
      LEFT JOIN items i ON i.id = l.item_id
      WHERE l.shop_id = ${shopId} AND o.status IN ('processing', 'completed')
        AND o.placed_at >= ${baseline}::timestamptz
      GROUP BY 1, l.item_id, i.sku, i.product_name, i.variation_label`),
    rowsOf(sql`
      SELECT ${monthSql("occurred_at")} AS month, kind::text AS kind, sum(amount)::text AS amount
      FROM ledger_entries WHERE shop_id = ${shopId} GROUP BY 1, 2`),
    db.select().from(monthClosings).where(eq(monthClosings.shopId, shopId)),
    db
      .select({ qty: restockLots.quantity, cost: restockLots.unitCost, source: restockLots.source })
      .from(restockLots)
      .where(eq(restockLots.shopId, shopId)),
  ]);

  const closingByMonth = new Map(closingRows.map((c) => [c.month, c]));
  const ordersByMonth = new Map(
    orderRows.map((r) => [r.month as string, { orders: Number(r.orders), gross: toCents(r.gross) }]),
  );
  const flowsByMonth = new Map<string, Flows>();
  let hasOpening = false;
  for (const r of ledgerRows) {
    const f = flowsByMonth.get(r.month as string) ?? { sales: 0, restock: 0, withdrawal: 0, expense: 0, other: 0 };
    const amount = toCents(r.amount);
    if (r.kind === "restock") f.restock += amount;
    else if (r.kind === "withdrawal") f.withdrawal += amount;
    else if (r.kind === "expense") f.expense += amount;
    else f.other += amount;
    if (r.kind === "opening_balance") hasOpening = true;
    flowsByMonth.set(r.month as string, f);
  }

  const currentKey = monthKeyOf(new Date(), tz);
  const keys = monthRange(monthKeyOf(shop.baselineAt, tz), currentKey);

  // Changes to months that were already closed (late refunds, late orders), not yet absorbed.
  let pendingLate = 0;
  for (const c of closingRows) {
    pendingLate += (ordersByMonth.get(c.month)?.gross ?? 0) - toCents(c.grossTotal) - toCents(c.adjustments);
  }
  const firstOpenKey = keys.find((k) => !closingByMonth.has(k));

  const months: MonthReport[] = [];
  let carried = 0;
  let ytdProfit = 0; // profit of the earlier months of the same calendar year
  let ytdYear = "";
  for (const key of keys) {
    if (key.slice(0, 4) !== ytdYear) {
      ytdYear = key.slice(0, 4);
      ytdProfit = 0;
    }
    const closing = closingByMonth.get(key);
    const live = ordersByMonth.get(key) ?? { orders: 0, gross: 0 };
    const flows = { ...(flowsByMonth.get(key) ?? { sales: 0, restock: 0, withdrawal: 0, expense: 0, other: 0 }) };

    const items: ItemRow[] = itemRowsRaw
      .filter((r) => r.month === key)
      .map((r) => {
        const gross = toCents(r.gross);
        const label = r.variation_label ? `${r.product_name} – ${r.variation_label}` : String(r.product_name);
        return {
          ...figures(gross, toCents(r.cogs), noTax),
          itemId: (r.item_id as string) ?? null,
          label,
          sku: (r.sku as string) ?? null,
          qty: Number(r.qty),
          missingCost: Number(r.missing),
        };
      })
      .sort((a, b) => b.gross - a.gross);
    const itemsCogs = items.reduce((s, i) => s + i.cogs, 0);
    const itemsGross = items.reduce((s, i) => s + i.gross, 0);
    const missingCostLines = items.reduce((s, i) => s + i.missingCost, 0);

    const lateAdjustments = closing ? toCents(closing.adjustments) : key === firstOpenKey ? pendingLate : 0;
    const gross = closing ? toCents(closing.grossTotal) : live.gross;
    flows.sales = gross + lateAdjustments;

    const f = closing
      ? {
          gross: gross + lateAdjustments,
          vat: toCents(closing.vatTotal),
          netRevenue: gross + lateAdjustments - toCents(closing.vatTotal),
          cogs: toCents(closing.cogsTotal),
          profit: gross + lateAdjustments - toCents(closing.vatTotal) - toCents(closing.cogsTotal),
          taxReserve: toCents(closing.taxReserve),
          netEarnings: toCents(closing.netTotal),
        }
      : figures(live.gross + lateAdjustments, itemsCogs, profile, ytdProfit);
    ytdProfit += f.profit;

    // Share the month's tax reserve over the items and the shipping row by their profit.
    const shippingFig = figures(f.gross - itemsGross, 0, noTax);
    const weights = [...items.map((i) => Math.max(i.profit, 0)), Math.max(shippingFig.profit, 0)];
    const weightSum = weights.reduce((a, b) => a + b, 0);
    const share = (w: number) => (weightSum > 0 ? Math.round((f.taxReserve * w) / weightSum) : 0);
    items.forEach((it, idx) => {
      it.taxReserve = share(weights[idx]);
      it.netEarnings = it.profit - it.taxReserve;
    });
    const shippingTax = share(weights[weights.length - 1]);

    const start = carried;
    const end = closing
      ? toCents(closing.balance)
      : start + flows.sales + flows.restock + flows.withdrawal + flows.expense + flows.other;
    carried = end;

    months.push({
      ...f,
      key,
      closed: !!closing,
      orders: closing ? closing.ordersCount : live.orders,
      lateAdjustments,
      missingCostLines,
      start,
      flows,
      end,
      items,
      shipping: { ...shippingFig, taxReserve: shippingTax, netEarnings: shippingFig.profit - shippingTax },
    });
  }

  const sum = (pick: (m: MonthReport) => number) => months.reduce((s, m) => s + pick(m), 0);
  const openingValue = lotRows
    .filter((l) => l.source === "opening")
    .reduce((s, l) => s + Math.round(Number(l.qty) * Number(l.cost) * 100), 0);
  const invested = openingValue - sum((m) => m.flows.restock);
  const netEarnings = sum((m) => m.netEarnings);

  return {
    shopId,
    currency: shop.currency,
    currentKey,
    hasOpening,
    months,
    overview: {
      cash: months.at(-1)?.end ?? 0,
      vatReserve: sum((m) => m.vat),
      taxReserve: sum((m) => m.taxReserve),
      netEarnings,
      withdrawn: -sum((m) => m.flows.withdrawal),
      invested,
      roi: invested > 0 ? netEarnings / invested : null,
    },
  };
}
