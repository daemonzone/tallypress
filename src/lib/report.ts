import { eq, sql } from "drizzle-orm";
import { db } from "@/db";
import { monthClosings, restockLots, shops } from "@/db/schema";
import { figures, monthKeyOf, monthRange, profileOf, toCents, type Figures } from "./money";

export interface ItemRow extends Figures {
  itemId: string | null;
  status: string | null; // WooCommerce status of the item (trash, deleted...), null when the line has no item
  label: string;
  sku: string | null;
  qty: number;
  missingCost: number; // sold lines without a purchase cost yet
}

export interface Flows {
  sales: number;
  opening: number; // the starting deposit on the shop account
  deposit: number; // later money paid into the account
  restock: number;
  estimatedRestock: number; // purchases estimated by Tallypress, not recorded by the owner
  withdrawal: number;
  expense: number;
  vatPayment: number;
  estimatedVatPayment: number; // VAT payments estimated by Tallypress
  taxPayment: number;
  estimatedTaxPayment: number; // income tax / contribution payments estimated by Tallypress
  priorPayment: number; // VAT / taxes paid for periods before the starting point
  estimatedPriorPayment: number;
  adjustment: number; // manual corrections
  other: number;
}

const emptyFlows = (): Flows => ({
  sales: 0, opening: 0, deposit: 0, restock: 0, estimatedRestock: 0, withdrawal: 0, expense: 0, vatPayment: 0, estimatedVatPayment: 0, taxPayment: 0, estimatedTaxPayment: 0, priorPayment: 0, estimatedPriorPayment: 0, adjustment: 0, other: 0,
});

/** Everything that moves the account apart from sales. */
const manualFlows = (f: Flows) =>
  f.opening + f.deposit + f.restock + f.estimatedRestock + f.withdrawal + f.expense + f.vatPayment + f.estimatedVatPayment + f.taxPayment + f.estimatedTaxPayment + f.priorPayment + f.estimatedPriorPayment + f.adjustment + f.other;

export interface MonthReport extends Figures {
  key: string; // first day of the month, "YYYY-MM-01"
  closed: boolean;
  history: boolean; // before the starting point: sales only, no account balance
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
  cogs: number; // purchase cost of everything sold so far
  /** What is left after VAT, income tax and the cost of the goods sold: opening balance + net earnings (+ manual movements). */
  netRemaining: number;
  vatReserve: number; // all VAT set aside since the start
  taxReserve: number; // all income tax and contributions set aside since the start
  vatDue: number; // what is still to be paid: set aside minus payments recorded
  taxDue: number;
  netEarnings: number;
  withdrawn: number;
  invested: number; // opening stock value + restock spend
  roi: number | null; // net earnings / invested
}

export interface Report {
  shopId: string;
  currency: string;
  currentKey: string;
  startsOn: string; // "YYYY-MM-DD": the day account balance and stock are tracked from
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
  // The data can start before the baseline (sales history); cash and stock only from the baseline.
  // The history starts at the first real order, not at the date the import was asked from.
  const [{ first }] = await rowsOf(sql`SELECT min(placed_at) AS first FROM orders WHERE shop_id = ${shopId}`);
  const firstOrder = first ? new Date(first as string) : null;
  const dataStart =
    shop.historyStart && shop.historyStart < shop.baselineAt
      ? firstOrder && firstOrder > shop.historyStart
        ? (firstOrder < shop.baselineAt ? firstOrder : shop.baselineAt)
        : shop.historyStart
      : shop.baselineAt;
  const baseline = dataStart.toISOString();

  const [orderRows, itemRowsRaw, ledgerRows, closingRows, lotRows] = await Promise.all([
    rowsOf(sql`
      SELECT ${monthSql("o.placed_at")} AS month, count(*)::int AS orders,
             coalesce(sum(o.gross_total - o.refunded_total), 0)::text AS gross
      FROM orders o
      WHERE o.shop_id = ${shopId} AND o.status IN ('processing', 'completed')
        AND o.placed_at >= ${baseline}::timestamptz
      GROUP BY 1`),
    rowsOf(sql`
      SELECT ${monthSql("o.placed_at")} AS month, l.item_id, i.sku, i.status AS item_status,
             coalesce(i.product_name, CASE WHEN l.item_id IS NULL THEN l.name END, '?') AS product_name, i.variation_label,
             sum(l.quantity)::text AS qty, sum(l.gross_total)::text AS gross,
             sum(l.quantity * coalesce(l.unit_cost_snapshot, 0))::text AS cogs,
             (count(*) FILTER (WHERE l.unit_cost_snapshot IS NULL))::int AS missing
      FROM order_lines l
      JOIN orders o ON o.id = l.order_id
      LEFT JOIN items i ON i.id = l.item_id
      WHERE l.shop_id = ${shopId} AND o.status IN ('processing', 'completed')
        AND o.placed_at >= ${baseline}::timestamptz
      -- lines whose product was deleted for good have no item: keep them apart, by the name they were sold under
      GROUP BY 1, l.item_id, i.sku, i.status, i.product_name, i.variation_label, CASE WHEN l.item_id IS NULL THEN l.name END`),
    rowsOf(sql`
      SELECT ${monthSql("occurred_at")} AS month, kind::text AS kind, estimated, sum(amount)::text AS amount
      FROM ledger_entries WHERE shop_id = ${shopId} GROUP BY 1, 2, 3`),
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
    const f = flowsByMonth.get(r.month as string) ?? emptyFlows();
    const amount = toCents(r.amount);
    if (r.kind === "restock") {
      if (r.estimated) f.estimatedRestock += amount;
      else f.restock += amount;
    }
    else if (r.kind === "withdrawal") f.withdrawal += amount;
    else if (r.kind === "expense") f.expense += amount;
    else if (r.kind === "deposit") f.deposit += amount;
    else if (r.kind === "vat_payment") {
      if (r.estimated) f.estimatedVatPayment += amount;
      else f.vatPayment += amount;
    } else if (r.kind === "tax_payment") {
      if (r.estimated) f.estimatedTaxPayment += amount;
      else f.taxPayment += amount;
    } else if (r.kind === "prior_payment") {
      if (r.estimated) f.estimatedPriorPayment += amount;
      else f.priorPayment += amount;
    }
    else if (r.kind === "opening_balance") {
      f.opening += amount;
      hasOpening = true;
    } else if (r.kind === "other") f.other += amount;
    else f.adjustment += amount;
    flowsByMonth.set(r.month as string, f);
  }

  const currentKey = monthKeyOf(new Date(), tz);
  const keys = monthRange(monthKeyOf(dataStart, tz), currentKey);
  const baselineKey = monthKeyOf(shop.baselineAt, tz);

  // Changes to months that were already closed (late refunds, late orders), not yet absorbed.
  let pendingLate = 0;
  for (const c of closingRows) {
    pendingLate += (ordersByMonth.get(c.month)?.gross ?? 0) - toCents(c.grossTotal) - toCents(c.adjustments);
  }
  const firstOpenKey = keys.find((k) => k >= baselineKey && !closingByMonth.has(k));

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
    const flows = { ...(flowsByMonth.get(key) ?? emptyFlows()) };

    const items: ItemRow[] = itemRowsRaw
      .filter((r) => r.month === key)
      .map((r) => {
        const gross = toCents(r.gross);
        const label = r.variation_label ? `${r.product_name} – ${r.variation_label}` : String(r.product_name);
        return {
          ...figures(gross, toCents(r.cogs), noTax),
          itemId: (r.item_id as string) ?? null,
          status: (r.item_status as string) ?? null,
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

    const history = key < baselineKey;
    const start = history ? 0 : carried;
    const end = history ? 0 : closing ? toCents(closing.balance) : start + flows.sales + manualFlows(flows);
    if (!history) carried = end;

    months.push({
      ...f,
      key,
      closed: !!closing,
      history,
      orders: closing ? closing.ordersCount : live.orders,
      lateAdjustments,
      missingCostLines,
      start,
      flows: history ? emptyFlows() : flows,
      end,
      items,
      shipping: { ...shippingFig, taxReserve: shippingTax, netEarnings: shippingFig.profit - shippingTax },
    });
  }

  // The overview (cash, reserves, ROI) covers the months from the starting point on, not the sales history.
  const sum = (pick: (m: MonthReport) => number) => months.filter((m) => !m.history).reduce((s, m) => s + pick(m), 0);
  const openingValue = lotRows
    .filter((l) => l.source === "opening")
    .reduce((s, l) => s + Math.round(Number(l.qty) * Number(l.cost) * 100), 0);
  const spentOnRestocks = -sum((m) => m.flows.restock + m.flows.estimatedRestock);
  const invested = openingValue + spentOnRestocks;
  const netEarnings = sum((m) => m.netEarnings);

  const vatDue = Math.max(sum((m) => m.vat) + sum((m) => m.flows.vatPayment + m.flows.estimatedVatPayment), 0);
  const taxDue = Math.max(sum((m) => m.taxReserve) + sum((m) => m.flows.taxPayment + m.flows.estimatedTaxPayment), 0);

  return {
    shopId,
    currency: shop.currency,
    currentKey,
    startsOn: shop.baselineAt.toISOString().slice(0, 10),
    hasOpening,
    months,
    overview: {
      cash: months.at(-1)?.end ?? 0,
      cogs: sum((m) => m.cogs),
      // Payments settle what was set aside, so they must not be subtracted twice.
      // Only the part of the cost of goods sold that has not been bought back yet is still to be spent.
      netRemaining: (months.at(-1)?.end ?? 0) - vatDue - taxDue - Math.max(sum((m) => m.cogs) - spentOnRestocks, 0),
      vatReserve: sum((m) => m.vat),
      taxReserve: sum((m) => m.taxReserve),
      vatDue,
      taxDue,
      netEarnings,
      withdrawn: -sum((m) => m.flows.withdrawal),
      invested,
      roi: invested > 0 ? netEarnings / invested : null,
    },
  };
}
