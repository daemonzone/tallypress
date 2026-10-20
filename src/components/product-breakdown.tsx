import { type Dictionary } from "@/i18n";
import { type MonthReport } from "@/lib/report";
import { type Formatters } from "./format";
import { Icon } from "./icons";
import { DataTable, Section, Td } from "./ui";

/**
 * The month's sales by product and variation (quantity, gross, VAT, cost of goods, tax, earnings),
 * with products that no longer exist greyed out. Not shown on the main panel any more: kept for a
 * future orders-summary page.
 */
export function ProductBreakdown({ month: m, t, fmt }: { month: MonthReport; t: Dictionary; fmt: Formatters }) {
  return (
  <Section title={t.month.variantsTitle}>
      {m.items.length === 0 ? (
        <p className="text-sm text-muted">{t.month.noData}</p>
      ) : (
        <DataTable
          head={[t.month.product, t.month.qty, t.month.grossShort, t.month.vat, t.month.netRevenueShort, t.month.cogsShort, t.month.taxShort, t.month.earningsShort]}
        >
          {m.items.map((i) => {
            // Products that no longer exist in the shop (in the bin, or deleted) are shown greyed out.
            const gone = i.itemId == null || i.status === "trash" || i.status === "deleted";
            return (
            <tr key={i.itemId ?? i.label} className={gone ? "text-muted" : undefined}>
              <td className="whitespace-nowrap py-2.5 pr-3">
                {i.label}
                {i.sku && <span className="ml-2 text-xs text-muted">{i.sku}</span>}
                {gone && (
                  <span className="ml-2 rounded-full border border-line bg-surface-2 px-2 py-0.5 text-[11px] font-medium">
                    {i.status === "trash" ? t.stock.trashed : t.stock.deleted}
                  </span>
                )}
                {i.missingCost > 0 && (
                  <Icon name="alert" className="ml-1.5 inline h-3.5 w-3.5 text-[var(--warn-line)]" />
                )}
              </td>
              <Td>{fmt.num(i.qty)}</Td>
              <Td>{fmt.money(i.gross)}</Td>
              <Td>{fmt.money(i.vat)}</Td>
              <Td>{fmt.money(i.netRevenue)}</Td>
              <Td>{fmt.money(i.cogs)}</Td>
              <Td>{fmt.money(i.taxReserve)}</Td>
              <Td>{fmt.money(i.netEarnings)}</Td>
            </tr>
            );
          })}
          <tr className="text-muted">
            <td className="py-2.5 pr-3">{t.month.shipping}</td>
            <Td />
            <Td>{fmt.money(m.shipping.gross)}</Td>
            <Td>{fmt.money(m.shipping.vat)}</Td>
            <Td>{fmt.money(m.shipping.netRevenue)}</Td>
            <Td>{fmt.money(0)}</Td>
            <Td>{fmt.money(m.shipping.taxReserve)}</Td>
            <Td>{fmt.money(m.shipping.netEarnings)}</Td>
          </tr>
          <tr className="border-t-2 border-line font-semibold">
            <td className="py-2.5 pr-3">{t.common.total}</td>
            <Td strong>{fmt.num(m.items.reduce((s, i) => s + i.qty, 0))}</Td>
            <Td strong>{fmt.money(m.gross)}</Td>
            <Td strong>{fmt.money(m.vat)}</Td>
            <Td strong>{fmt.money(m.netRevenue)}</Td>
            <Td strong>{fmt.money(m.cogs)}</Td>
            <Td strong>{fmt.money(m.taxReserve)}</Td>
            <Td strong>{fmt.money(m.netEarnings)}</Td>
          </tr>
        </DataTable>
      )}
    </Section>
  );
}
