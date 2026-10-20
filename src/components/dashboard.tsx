import Link from "next/link";
import { notFound } from "next/navigation";
import { getDictionary, type Dictionary } from "@/i18n";
import { saveOwnerShare } from "@/lib/actions";
import { ensureMonthsClosed } from "@/lib/closing";
import { buildReport, type MonthReport, type Report } from "@/lib/report";
import { getCurrentShop } from "@/lib/shop";
import { formatters, monthHref, monthLabel, type Formatters } from "./format";
import { Simulator } from "./simulator";
import { DataTable, KeyValues, Notice, Section, Td } from "./ui";

export async function Dashboard({ monthKey }: { monthKey?: string }) {
  const { locale, t } = await getDictionary();
  const shop = await getCurrentShop();
  if (!shop) {
    return (
      <Notice tone="warn">
        <strong>{t.setupNeeded.title}.</strong> {t.setupNeeded.body}
      </Notice>
    );
  }

  await ensureMonthsClosed(shop.id); // catch-up in case the cron has not run
  const report = await buildReport(shop.id);
  if (!report?.hasOpening) {
    return (
      <Notice tone="warn">
        <strong>{t.setupNeeded.openingTitle}.</strong> {t.setupNeeded.openingBody}{" "}
        <Link href="/setup" className="underline">
          {t.setupNeeded.openingLink}
        </Link>
      </Notice>
    );
  }

  const selected = monthKey ? report.months.find((m) => m.key === monthKey) : report.months.at(-1);
  if (!selected) notFound();

  const fmt = formatters(locale, report.currency);
  return (
    <>
      {!monthKey && <OverviewBlock report={report} t={t} fmt={fmt} locale={locale} defaultPct={Number(shop.ownerSharePct)} />}
      <MonthNav report={report} selected={selected.key} locale={locale} label={t.month.months} />
      <MonthPanel month={selected} t={t} fmt={fmt} locale={locale} />
    </>
  );
}

function OverviewBlock({
  report,
  t,
  fmt,
  locale,
  defaultPct,
}: {
  report: Report;
  t: Dictionary;
  fmt: Formatters;
  locale: string;
  defaultPct: number;
}) {
  const o = report.overview;
  return (
    <Section title={t.overview.title}>
      <div className="grid gap-6 md:grid-cols-2">
        <div>
          <KeyValues
            rows={[
              { label: t.overview.cash, value: fmt.money(o.cash), strong: true },
              { label: t.overview.vat, value: fmt.money(o.vatReserve) },
              { label: t.overview.tax, value: fmt.money(o.taxReserve) },
              { label: t.overview.net, value: fmt.money(o.netEarnings), strong: true },
              { label: t.overview.withdrawn, value: fmt.money(o.withdrawn) },
              { label: t.overview.invested, value: fmt.money(o.invested) },
              {
                label: t.overview.roi,
                value: o.roi == null ? t.common.none : fmt.pct(o.roi),
                note: t.overview.roiHelp,
                strong: true,
              },
            ]}
          />
        </div>
        <Simulator
          locale={locale}
          currency={report.currency}
          defaultPct={defaultPct}
          net={o.netEarnings}
          withdrawn={o.withdrawn}
          cash={o.cash}
          vat={o.vatReserve}
          tax={o.taxReserve}
          labels={t.simulator}
          saveAction={saveOwnerShare}
        />
      </div>
    </Section>
  );
}

function MonthNav({ report, selected, locale, label }: { report: Report; selected: string; locale: string; label: string }) {
  return (
    <nav aria-label={label} className="mb-4 flex flex-wrap gap-2 text-sm">
      {[...report.months].reverse().map((m) => (
        <Link
          key={m.key}
          href={monthHref(m.key, report.currentKey)}
          aria-current={m.key === selected ? "page" : undefined}
          className={`rounded border px-2 py-1 ${
            m.key === selected
              ? "border-black font-semibold dark:border-white"
              : "border-black/20 opacity-80 hover:opacity-100 dark:border-white/20"
          }`}
        >
          {monthLabel(m.key, locale)}
        </Link>
      ))}
    </nav>
  );
}

function MonthPanel({ month: m, t, fmt, locale }: { month: MonthReport; t: Dictionary; fmt: Formatters; locale: string }) {
  const f = m.flows;
  const other = f.other + f.expense;
  return (
    <>
      <Section
        title={`${t.month.heading}: ${monthLabel(m.key, locale)}`}
        aside={
          <span className="rounded border border-black/20 px-2 py-0.5 text-xs dark:border-white/20">
            {m.closed ? t.month.closed : t.month.open}
          </span>
        }
      >
        {m.missingCostLines > 0 && (
          <Notice tone="warn">{t.month.missingCost.replace("{n}", String(m.missingCostLines))}</Notice>
        )}
        <KeyValues
          rows={[
            { label: t.month.orders, value: m.orders },
            {
              label: t.month.gross,
              value: fmt.money(m.gross),
              note: m.lateAdjustments !== 0 ? `${t.month.lateAdjustments}: ${fmt.money(m.lateAdjustments)}` : undefined,
              strong: true,
            },
            { label: t.month.vat, value: fmt.money(-m.vat) },
            { label: t.month.netRevenue, value: fmt.money(m.netRevenue) },
            { label: t.month.cogs, value: fmt.money(-m.cogs) },
            { label: t.month.profit, value: fmt.money(m.profit) },
            { label: t.month.taxReserve, value: fmt.money(-m.taxReserve) },
            { label: t.month.netEarnings, value: fmt.money(m.netEarnings), strong: true },
          ]}
        />
      </Section>

      <Section title={t.month.cashTitle}>
        <KeyValues
          rows={[
            { label: t.month.start, value: fmt.money(m.start) },
            { label: t.month.sales, value: fmt.money(f.sales) },
            { label: t.month.restocks, value: fmt.money(f.restock) },
            { label: t.month.withdrawals, value: fmt.money(f.withdrawal) },
            { label: `${t.month.expenses} / ${t.month.other}`, value: fmt.money(other) },
            { label: t.month.end, value: fmt.money(m.end), strong: true },
          ]}
        />
      </Section>

      <Section title={t.month.variantsTitle}>
        {m.items.length === 0 ? (
          <p className="text-sm opacity-70">{t.month.noData}</p>
        ) : (
          <DataTable
            head={[t.month.product, t.month.qty, t.month.gross, t.month.vat, t.month.netRevenue, t.month.cogs, t.month.taxReserve, t.month.netEarnings]}
          >
            {m.items.map((i) => (
              <tr key={i.itemId ?? i.label}>
                <td className="py-2 pr-3">
                  {i.label}
                  {i.sku && <span className="ml-2 text-xs opacity-60">{i.sku}</span>}
                  {i.missingCost > 0 && <span className="ml-2 text-xs text-amber-600">⚠</span>}
                </td>
                <Td>{fmt.num(i.qty)}</Td>
                <Td>{fmt.money(i.gross)}</Td>
                <Td>{fmt.money(i.vat)}</Td>
                <Td>{fmt.money(i.netRevenue)}</Td>
                <Td>{fmt.money(i.cogs)}</Td>
                <Td>{fmt.money(i.taxReserve)}</Td>
                <Td>{fmt.money(i.netEarnings)}</Td>
              </tr>
            ))}
            <tr>
              <td className="py-2 pr-3">{t.month.shipping}</td>
              <Td />
              <Td>{fmt.money(m.shipping.gross)}</Td>
              <Td>{fmt.money(m.shipping.vat)}</Td>
              <Td>{fmt.money(m.shipping.netRevenue)}</Td>
              <Td>{fmt.money(0)}</Td>
              <Td>{fmt.money(m.shipping.taxReserve)}</Td>
              <Td>{fmt.money(m.shipping.netEarnings)}</Td>
            </tr>
            <tr className="border-t border-black/30 font-semibold dark:border-white/30">
              <td className="py-2 pr-3">{t.common.total}</td>
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
    </>
  );
}
