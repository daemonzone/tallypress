import Link from "next/link";
import { notFound } from "next/navigation";
import { getDictionary, type Dictionary } from "@/i18n";
import { saveOwnerShare } from "@/lib/actions";
import { ensureMonthsClosed } from "@/lib/closing";
import { getItemStates } from "@/lib/costs";
import { buildReport, type MonthReport, type Report } from "@/lib/report";
import { getCurrentShop } from "@/lib/shop";
import { MonthColumns, StackedBar, VIZ } from "./charts";
import { formatters, monthHref, monthLabel, type Formatters } from "./format";
import { Icon } from "./icons";
import { InfoModal } from "./info-modal";
import { Simulator } from "./simulator";
import { Badge, Card, DataTable, KeyValues, Notice, Section, StatTile, Td } from "./ui";

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

  const stockValue = (await getItemStates(shop.id)).reduce((s, i) => s + Math.round(i.stockValue * 100), 0);
  const fmt = formatters(locale, report.currency);

  return (
    <div className="grid grid-cols-[minmax(0,1fr)] items-start gap-6 lg:grid-cols-[minmax(0,1fr)_21.5rem]">
      <div className="min-w-0">
        <MonthPanel month={selected} report={report} t={t} fmt={fmt} locale={locale} />
      </div>
      <aside className="flex flex-col gap-6 lg:sticky lg:top-24 lg:max-h-[calc(100vh-7rem)] lg:overflow-y-auto lg:pb-1 lg:pr-1 lg:[scrollbar-width:thin]">
        <Overview report={report} t={t} fmt={fmt} />
        <Simulator
          locale={locale}
          currency={report.currency}
          defaultPct={Number(shop.ownerSharePct)}
          net={report.overview.netEarnings}
          withdrawn={report.overview.withdrawn}
          cash={report.overview.cash}
          vat={report.overview.vatReserve}
          tax={report.overview.taxReserve}
          labels={{ ...t.simulator, vat: t.overview.vat, tax: t.overview.tax }}
          saveAction={saveOwnerShare}
        />
        <StockBox stockValue={stockValue} invested={report.overview.invested} t={t} fmt={fmt} />
      </aside>
    </div>
  );
}

function Overview({ report, t, fmt }: { report: Report; t: Dictionary; fmt: Formatters }) {
  const o = report.overview;
  return (
    <Card>
      <h3 className="mb-4 text-base font-semibold tracking-tight">{t.overview.title}</h3>
      <StatTile label={t.overview.cash} value={fmt.money(o.cash)} icon="wallet" />
      <div className="mt-4">
        <StatTile
          label={t.overview.netRemaining}
          value={<span className={o.netRemaining < 0 ? "text-bad" : ""}>{fmt.money(o.netRemaining)}</span>}
          icon="shield"
          note={t.overview.netRemainingHelp}
        />
      </div>
      <div className="mt-4 border-t border-line pt-1">
        <KeyValues
          rows={[
            {
              label: t.overview.roi,
              value: o.roi == null ? t.common.none : fmt.pct(o.roi),
              note: t.overview.roiHelp,
              strong: true,
            },
          ]}
        />
      </div>
    </Card>
  );
}

/** The month's calculation as a statement: running results in the middle, the outcome in the footer. */
function GrossToNet({ month: m, t, fmt }: { month: MonthReport; t: Dictionary; fmt: Formatters }) {
  const line = (label: string, value: string, minus = false) => (
    <div className="flex items-baseline justify-between gap-4 px-3 py-2 text-sm">
      <span className={minus ? "text-muted" : ""}>
        {minus && <span className="mr-2 inline-block w-3 text-center font-medium">−</span>}
        {label}
      </span>
      <span className="tabular-nums">{value}</span>
    </div>
  );
  // Highlighted rows: the starting figure (no marker) and the running results ("=").
  const result = (label: string, value: string, marker = "=") => (
    <div className="my-1 flex items-baseline justify-between gap-4 rounded-lg bg-surface-2 px-3 py-2.5 text-sm font-semibold">
      <span>
        <span className="mr-2 inline-block w-3 text-center">{marker}</span>
        {label}
      </span>
      <span className="tabular-nums">{value}</span>
    </div>
  );

  return (
    <div>
      {result(t.month.gross, fmt.money(m.gross), "")}
      {line(t.month.vat, fmt.money(-m.vat), true)}
      {result(t.month.netRevenue, fmt.money(m.netRevenue))}
      {line(t.month.cogs, fmt.money(-m.cogs), true)}
      {result(t.month.profit, fmt.money(m.profit))}

      <div className="mt-4 grid grid-cols-2 overflow-hidden rounded-xl border border-line">
        <div className="p-4">
          <div className="text-xs font-medium text-muted">− {t.month.taxReserve}</div>
          <div className="mt-1 text-xl font-semibold tabular-nums">{fmt.money(-m.taxReserve)}</div>
        </div>
        <div className="border-l border-line bg-accent-soft p-4 text-right">
          <div className="text-xs font-medium text-muted">= {t.month.netEarnings}</div>
          <div className={`mt-1 text-3xl font-bold tracking-tight tabular-nums ${m.netEarnings < 0 ? "text-bad" : ""}`}>
            {fmt.money(m.netEarnings)}
          </div>
        </div>
      </div>
    </div>
  );
}

function StockBox({ stockValue, invested, t, fmt }: { stockValue: number; invested: number; t: Dictionary; fmt: Formatters }) {
  return (
    <Card>
      <h3 className="mb-2 flex items-center gap-2 text-base font-semibold tracking-tight">
        <Icon name="box" className="h-4 w-4 text-muted" />
        {t.overview.stockTitle}
      </h3>
      <KeyValues
        rows={[
          { label: t.overview.stockValue, value: fmt.money(stockValue), note: t.overview.stockValueHelp },
          { label: t.overview.invested, value: fmt.money(invested), note: t.overview.investedHelp },
        ]}
      />
    </Card>
  );
}

function MonthPanel({
  month: m,
  report,
  t,
  fmt,
  locale,
}: {
  month: MonthReport;
  report: Report;
  t: Dictionary;
  fmt: Formatters;
  locale: string;
}) {
  const f = m.flows;
  const columns = report.months.slice(-12).map((x) => ({
    key: x.key,
    label: new Intl.DateTimeFormat(locale, { month: "short", year: "2-digit", timeZone: "UTC" }).format(
      new Date(`${x.key}T00:00:00Z`),
    ),
    value: x.netEarnings,
    display: fmt.money(x.netEarnings),
    href: monthHref(x.key, report.currentKey),
    selected: x.key === m.key,
  }));

  // Where the month's gross total goes. A loss month has no "net" slice to draw.
  const breakdown = [
    { key: "net", label: t.month.netEarnings, value: Math.max(m.netEarnings, 0), slot: VIZ.mine, display: fmt.money(m.netEarnings) },
    { key: "cogs", label: t.month.cogs, value: m.cogs, slot: VIZ.cogs, display: fmt.money(m.cogs) },
    { key: "vat", label: t.month.vat, value: m.vat, slot: VIZ.vat, display: fmt.money(m.vat) },
    { key: "tax", label: t.month.taxReserve, value: m.taxReserve, slot: VIZ.tax, display: fmt.money(m.taxReserve) },
  ];

  return (
    <>
      <div className="mb-5">
        <div className="text-xs font-medium uppercase tracking-wider text-muted">{t.month.heading}</div>
        <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
          <h1 className="text-3xl font-semibold capitalize tracking-tight">{monthLabel(m.key, locale)}</h1>
          {m.closed ? (
            <Badge icon={<Icon name="lock" className="h-3.5 w-3.5" />}>{t.month.closed}</Badge>
          ) : (
            <Badge icon={<span className="h-2 w-2 rounded-full bg-good" aria-hidden="true" />}>{t.month.open}</Badge>
          )}
        </div>
      </div>

      <nav aria-label={t.month.months} className="-mx-1 mb-6 flex gap-2 overflow-x-auto px-1 pb-1 text-sm">
        {[...report.months].reverse().map((x) => (
          <Link
            key={x.key}
            href={monthHref(x.key, report.currentKey)}
            aria-current={x.key === m.key ? "page" : undefined}
            className={`whitespace-nowrap rounded-full border px-3 py-1.5 capitalize transition ${
              x.key === m.key
                ? "border-accent bg-accent-soft font-semibold text-ink"
                : "border-line bg-surface text-muted hover:text-ink"
            }`}
          >
            {monthLabel(x.key, locale)}
          </Link>
        ))}
      </nav>

      {m.missingCostLines > 0 && (
        <Notice tone="warn">{t.month.missingCost.replace("{n}", String(m.missingCostLines))}</Notice>
      )}

      <Card className="mb-6">
        <div className="flex flex-wrap items-end justify-between gap-x-8 gap-y-5">
          <StatTile
            hero
            label={t.month.netEarnings}
            icon="trend"
            labelExtra={
              <InfoModal
                label={t.month.detail}
                title={t.month.detail}
                subtitle={monthLabel(m.key, locale)}
                closeLabel={t.common.close}
              >
                <GrossToNet month={m} t={t} fmt={fmt} />
              </InfoModal>
            }
            value={<span className={m.netEarnings < 0 ? "text-bad" : ""}>{fmt.money(m.netEarnings)}</span>}
            note={m.netEarnings < 0 ? t.month.loss : undefined}
          />
          <div className="flex gap-8">
            <StatTile label={t.month.orders} icon="bag" value={m.orders} />
            <StatTile
              label={t.month.gross}
              icon="wallet"
              value={fmt.money(m.gross)}
              note={m.lateAdjustments !== 0 ? `${t.month.lateAdjustments}: ${fmt.money(m.lateAdjustments)}` : undefined}
            />
          </div>
        </div>
        <div className="mt-6 border-t border-line pt-5">
          <h3 className="mb-3 text-sm font-medium">{t.month.breakdownTitle}</h3>
          <StackedBar segments={breakdown} title={t.month.breakdownTitle} percent={fmt.pct} />
        </div>
      </Card>

      {report.months.length > 1 && (
        <Section title={t.month.trendTitle}>
          <MonthColumns columns={columns} title={t.month.trendTitle} />
        </Section>
      )}

      <Section title={t.month.cashTitle}>
        <KeyValues
          rows={[
            { label: t.month.start, value: fmt.money(m.start) },
            { label: t.month.sales, value: fmt.money(f.sales) },
            // Shown only when there is something in them (the deposit lands in the first month).
            ...(f.opening !== 0 ? [{ label: t.month.opening, value: fmt.money(f.opening) }] : []),
            { label: t.month.restocks, value: fmt.money(f.restock) },
            { label: t.month.withdrawals, value: fmt.money(f.withdrawal) },
            { label: t.month.expenses, value: fmt.money(f.expense) },
            ...(f.adjustment !== 0 ? [{ label: t.month.adjustments, value: fmt.money(f.adjustment) }] : []),
            { label: t.month.end, value: fmt.money(m.end), strong: true },
          ]}
        />
      </Section>

      <Section title={t.month.variantsTitle}>
        {m.items.length === 0 ? (
          <p className="text-sm text-muted">{t.month.noData}</p>
        ) : (
          <DataTable
            head={[t.month.product, t.month.qty, t.month.grossShort, t.month.vat, t.month.netRevenueShort, t.month.cogsShort, t.month.taxShort, t.month.earningsShort]}
          >
            {m.items.map((i) => (
              <tr key={i.itemId ?? i.label}>
                <td className="whitespace-nowrap py-2.5 pr-3">
                  {i.label}
                  {i.sku && <span className="ml-2 text-xs text-muted">{i.sku}</span>}
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
            ))}
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
    </>
  );
}
