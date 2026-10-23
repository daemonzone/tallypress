import Link from "next/link";
import { notFound } from "next/navigation";
import { getDictionary, type Dictionary } from "@/i18n";
import { saveOwnerShare } from "@/lib/actions";
import { ensureMonthsClosed } from "@/lib/closing";
import { getItemStates } from "@/lib/costs";
import { buildReport, type MonthReport, type Report, type Reserve } from "@/lib/report";
import { getCurrentShop } from "@/lib/shop";
import { syncNow } from "@/lib/sync/actions";
import { MonthColumns, StackedBar, VIZ } from "./charts";
import { formatters, monthHref, monthLabel, type Formatters } from "./format";
import type { ReactNode } from "react";
import { Icon, type IconName } from "./icons";
import { InfoModal } from "./info-modal";
import { Simulator } from "./simulator";
import { SyncButton } from "./sync-button";
import { Badge, Card, KeyValues, Notice, Section, StatTile } from "./ui";

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
  const sync = (
    <div className="flex flex-col items-end gap-1">
      <SyncButton
        action={syncNow}
        labels={{ sync: t.setup.syncNow, syncing: t.setup.syncing, failed: t.setup.syncFailed }}
      />
      <div className="text-xs text-muted">
        {t.setup.lastSync}:{" "}
        {shop.lastSyncedAt
          ? new Intl.DateTimeFormat(locale, { dateStyle: "medium", timeStyle: "short", timeZone: shop.timezone }).format(shop.lastSyncedAt)
          : t.setup.never}
      </div>
    </div>
  );

  return (
    <div className="grid grid-cols-[minmax(0,1fr)] items-start gap-6 lg:grid-cols-[minmax(0,1fr)_23.5rem]">
      <div className="min-w-0">
        <MonthPanel month={selected} report={report} t={t} fmt={fmt} locale={locale} sync={sync} />
      </div>
      <aside className="flex flex-col gap-6 lg:sticky lg:top-24 lg:max-h-[calc(100vh-7rem)] lg:overflow-y-auto lg:pb-1 lg:pr-1 lg:[scrollbar-width:thin]">
        {!report.aligned && (
          <Notice tone="warn">
            {t.overview.provisional}{" "}
            <Link href="/ledger" className="underline">
              {t.overview.provisionalLink}
            </Link>
          </Notice>
        )}
        <Overview report={report} t={t} fmt={fmt} locale={locale} />
        <Simulator
          locale={locale}
          currency={report.currency}
          defaultPct={Number(shop.ownerSharePct)}
          net={report.overview.netEarnings}
          withdrawn={report.overview.withdrawn}
          cash={report.overview.cash}
          vat={report.overview.vatDue}
          tax={report.overview.taxDue}
          labels={{ ...t.simulator, vat: t.overview.vat, tax: t.overview.tax }}
          saveAction={saveOwnerShare}
        />
        <StockBox stockValue={stockValue} invested={report.overview.invested} t={t} fmt={fmt} />
      </aside>
    </div>
  );
}

/** The data starts after 1 January, so the income tax of that year (computed on the whole year) is incomplete. */
function PartialYearWarning({ report, t, locale, year }: { report: Report; t: Dictionary; locale: string; year: string }) {
  const date = new Intl.DateTimeFormat(locale, { dateStyle: "long", timeZone: "UTC" }).format(new Date(`${report.startsOn}T00:00:00Z`));
  return (
    <InfoModal icon="alert" label={t.overview.partialYearShort.replace("{year}", year)} title={t.overview.partialYearTitle.replace("{year}", year)} closeLabel={t.common.close}>
      <p className="text-sm">{t.overview.partialYearBody.replace(/\{year\}/g, year).replace("{date}", date)}</p>
    </InfoModal>
  );
}

function Overview({ report, t, fmt, locale }: { report: Report; t: Dictionary; fmt: Formatters; locale: string }) {
  const o = report.overview;
  return (
    <Card>
      <h3 className="mb-4 text-base font-semibold tracking-tight">{t.overview.title}</h3>
      <BigRow label={t.overview.cash} icon="wallet" value={fmt.money(o.cash)} />
      <div className="mt-4">
        <BigRow
          label={t.overview.netRemaining}
          icon="shield"
          value={<span className={o.netRemaining < 0 ? "text-bad" : ""}>{fmt.money(o.netRemaining)}</span>}
          note={t.overview.netRemainingHelp}
        />
      </div>
      {report.partialTaxYear && (
        <div className="mt-3 flex items-center gap-1.5 text-xs text-muted">
          <PartialYearWarning report={report} t={t} locale={locale} year={report.partialTaxYear} />
          {t.overview.partialYearShort.replace("{year}", report.partialTaxYear)}
        </div>
      )}
      <div className="mt-4 flex items-baseline justify-between gap-3 border-t border-line pt-3 text-sm font-semibold">
        <span className="whitespace-nowrap">{t.overview.roi}</span>
        <span className="tabular-nums">{o.roi == null ? t.common.none : fmt.pct(o.roi)}</span>
      </div>
    </Card>
  );
}

/**
 * Two rows that never scroll: the years on top, and below them only the months of the selected
 * year. Picking another year opens the same month of that year (or the nearest one it has).
 */
function MonthNav({ report, selected, locale, label }: { report: Report; selected: string; locale: string; label: string }) {
  const short = new Intl.DateTimeFormat(locale, { month: "short", timeZone: "UTC" });
  const abbr = (key: string) => {
    const text = short.format(new Date(`${key}T00:00:00Z`)).replace(/\.$/, "");
    return text.charAt(0).toUpperCase() + text.slice(1);
  };
  const selectedYear = selected.slice(0, 4);
  const monthOfYear = selected.slice(5, 7);
  const years = [...new Set(report.months.map((m) => m.key.slice(0, 4)))];
  const monthsOf = (year: string) => report.months.filter((m) => m.key.slice(0, 4) === year);

  /** Same month in `year`, else the first month at or after it, else the last one. */
  const target = (year: string) => {
    const months = monthsOf(year);
    return (months.find((m) => m.key.slice(5, 7) >= monthOfYear) ?? months.at(-1)!).key;
  };
  const chip = (active: boolean, dashed = false) =>
    `rounded-full border px-3 py-1 transition ${
      active
        ? "border-accent bg-accent-soft font-semibold text-ink"
        : `border-line bg-surface text-muted hover:text-ink ${dashed ? "border-dashed" : ""}`
    }`;

  return (
    <nav aria-label={label} className="mb-6 flex flex-col gap-2 text-sm">
      <div className="flex flex-wrap gap-1.5">
        {years.map((year) => (
          <Link
            key={year}
            href={monthHref(target(year), report.currentKey)}
            aria-current={year === selectedYear ? "true" : undefined}
            className={`${chip(year === selectedYear)} tabular-nums`}
          >
            {year}
          </Link>
        ))}
      </div>
      <div className="flex flex-wrap gap-1.5">
        {monthsOf(selectedYear).map((x) => (
          <Link
            key={x.key}
            href={monthHref(x.key, report.currentKey)}
            title={monthLabel(x.key, locale)}
            aria-label={monthLabel(x.key, locale)}
            aria-current={x.key === selected ? "page" : undefined}
            className={chip(x.key === selected, x.history)}
          >
            {abbr(x.key)}
          </Link>
        ))}
      </div>
    </nav>
  );
}

/** "+1.234 set aside this month, −2.000 paid" under an account reserve row. */
function reserveNote(r: Reserve, t: Dictionary, fmt: Formatters, extra: string, extraAmount: number): string {
  const parts = [t.month.reserveAccrued.replace("{amount}", fmt.money(r.accrued))];
  if (r.paid !== 0) parts.push(t.month.reservePaid.replace("{amount}", fmt.money(-r.paid)));
  if (extraAmount > 0) parts.push(extra.replace("{amount}", fmt.money(extraAmount)));
  return parts.join(" · ");
}

/** What "late changes" means, the amount it adds to this month and where it comes from. */
function LateChanges({ month: m, t, fmt, locale }: { month: MonthReport; t: Dictionary; fmt: Formatters; locale: string }) {
  return (
    <div className="space-y-4 text-sm">
      <p>{t.month.lateBody}</p>
      <div className="flex items-baseline justify-between gap-4 rounded-lg bg-surface-2 px-3 py-2.5 font-semibold">
        <span>{t.month.lateAmount}</span>
        <span className="tabular-nums">{fmt.money(m.lateAdjustments)}</span>
      </div>
      {m.lateDetails.length > 0 && (
        <div>
          <div className="mb-1 text-xs font-medium uppercase tracking-wide text-muted">{t.month.lateFrom}</div>
          <KeyValues
            rows={m.lateDetails.map((d) => ({
              label: monthLabel(d.month, locale),
              value: `${d.amount > 0 ? "+" : ""}${fmt.money(d.amount)}`,
            }))}
          />
        </div>
      )}
      <p className="text-xs text-muted">{t.month.lateNote}</p>
    </div>
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
      {m.expenses !== 0 && line(t.month.expensesNet, fmt.money(-m.expenses), true)}
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

/** A key figure with its label on the left and the number right-aligned, like the rows below it. */
function BigRow({ label, icon, value, note }: { label: string; icon: IconName; value: ReactNode; note?: string }) {
  return (
    <div>
      <div className="flex items-baseline justify-between gap-4">
        <div className="flex items-center gap-1.5 text-sm text-muted">
          <Icon name={icon} className="h-3.5 w-3.5 shrink-0" />
          {label}
        </div>
        <div className="shrink-0 text-xl font-semibold tracking-tight tabular-nums">{value}</div>
      </div>
      {note && <p className="mt-1 text-xs text-muted">{note}</p>}
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
  sync,
}: {
  month: MonthReport;
  report: Report;
  t: Dictionary;
  fmt: Formatters;
  locale: string;
  sync: ReactNode;
}) {
  const f = m.flows;
  // A window of 12 months that contains the month being viewed (the latest 12 when it is recent).
  const at = report.months.findIndex((x) => x.key === m.key);
  const windowEnd = Math.min(report.months.length, Math.max(12, at + 6));
  const columns = report.months.slice(Math.max(0, windowEnd - 12), windowEnd).map((x) => ({
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
    ...(m.expenses > 0 ? [{ key: "expenses", label: t.month.expensesNet, value: m.expenses, slot: VIZ.personal, display: fmt.money(m.expenses) }] : []),
    { key: "tax", label: t.month.taxReserve, value: m.taxReserve, slot: VIZ.tax, display: fmt.money(m.taxReserve) },
  ];

  return (
    <>
      <div className="mb-5 flex flex-wrap items-start justify-between gap-x-6 gap-y-3">
        <div>
        <div className="text-xs font-medium uppercase tracking-wider text-muted">{t.month.heading}</div>
        <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
          <h1 className="text-3xl font-semibold capitalize tracking-tight">{monthLabel(m.key, locale)}</h1>
          {m.history ? (
            <Badge icon={<Icon name="book" className="h-3.5 w-3.5" />}>{t.month.historyBadge}</Badge>
          ) : m.closed ? (
            <Badge icon={<Icon name="lock" className="h-3.5 w-3.5" />}>{t.month.closed}</Badge>
          ) : (
            <Badge icon={<span className="h-2 w-2 rounded-full bg-good" aria-hidden="true" />}>{t.month.open}</Badge>
          )}
        </div>
        </div>
        {sync}
      </div>

      <MonthNav report={report} selected={m.key} locale={locale} label={t.month.months} />

      {m.history && (
        <Notice>
          {t.month.historyNote.replace(
            "{date}",
            new Intl.DateTimeFormat(locale, { dateStyle: "long", timeZone: "UTC" }).format(new Date(`${report.startsOn}T00:00:00Z`)),
          )}
        </Notice>
      )}
      {m.missingCostLines > 0 && (
        <Notice tone="warn">{t.month.missingCost.replace("{n}", String(m.missingCostLines))}</Notice>
      )}

      <Card className="mb-6">
        <div className="flex flex-wrap items-start justify-between gap-x-8 gap-y-5">
          <StatTile
            label={t.month.gross}
            icon="wallet"
            value={fmt.money(m.gross)}
            note={
              m.lateAdjustments !== 0 ? (
                <span className="inline-flex items-center gap-1.5">
                  {t.month.lateShort}: {fmt.money(m.lateAdjustments)}
                  <InfoModal label={t.month.lateTitle} title={t.month.lateTitle} closeLabel={t.common.close}>
                    <LateChanges month={m} t={t} fmt={fmt} locale={locale} />
                  </InfoModal>
                </span>
              ) : undefined
            }
          />
          <div className="flex items-start gap-8">
            <StatTile label={t.month.orders} icon="bag" value={fmt.int(m.orders)} align="right" />
            <StatTile
              hero
              label={t.month.netEarnings}
              icon="trend"
              align="right"
              labelExtra={
                <>
                  <InfoModal
                    label={t.month.detail}
                    title={t.month.detail}
                    subtitle={monthLabel(m.key, locale)}
                    closeLabel={t.common.close}
                  >
                    <GrossToNet month={m} t={t} fmt={fmt} />
                  </InfoModal>
                  {report.partialTaxYear === m.key.slice(0, 4) && (
                    <PartialYearWarning report={report} t={t} locale={locale} year={report.partialTaxYear} />
                  )}
                </>
              }
              value={<span className={m.netEarnings < 0 ? "text-bad" : ""}>{fmt.money(m.netEarnings)}</span>}
              note={m.netEarnings < 0 ? t.month.loss : undefined}
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

      {!m.history && (
      <Section title={t.month.cashTitle}>
        <KeyValues
          rows={[
            { label: t.month.start, value: fmt.money(m.start) },
            { label: t.month.sales, value: fmt.money(f.sales) },
            // Shown only when there is something in them (the deposit lands in the first month).
            ...(f.opening !== 0 ? [{ label: t.month.opening, value: fmt.money(f.opening) }] : []),
            ...(f.deposit !== 0 ? [{ label: t.month.deposits, value: fmt.money(f.deposit) }] : []),
            { label: t.month.restocks, value: fmt.money(f.restock) },
            ...(f.estimatedRestock !== 0 ? [{ label: t.month.estimatedRestocks, value: fmt.money(f.estimatedRestock) }] : []),
            { label: t.month.withdrawals, value: fmt.money(f.withdrawal) },
            { label: t.month.expenses, value: fmt.money(f.expense) },
            ...(f.estimatedVatPayment !== 0 ? [{ label: t.month.estimatedVatPayments, value: fmt.money(f.estimatedVatPayment) }] : []),
            ...(f.vatPayment !== 0 ? [{ label: t.month.vatPayments, value: fmt.money(f.vatPayment) }] : []),
            ...(f.estimatedTaxPayment !== 0 ? [{ label: t.month.estimatedTaxPayments, value: fmt.money(f.estimatedTaxPayment) }] : []),
            ...(f.taxPayment !== 0 ? [{ label: t.month.taxPayments, value: fmt.money(f.taxPayment) }] : []),
            ...(f.estimatedPriorPayment !== 0 ? [{ label: t.month.estimatedPriorPayments, value: fmt.money(f.estimatedPriorPayment) }] : []),
            ...(f.priorPayment !== 0 ? [{ label: t.month.priorPayments, value: fmt.money(f.priorPayment) }] : []),
            ...(f.adjustment !== 0 ? [{ label: t.month.adjustments, value: fmt.money(f.adjustment) }] : []),
            ...(f.other !== 0 ? [{ label: t.month.otherMovements, value: fmt.money(f.other) }] : []),
            {
              label: t.month.end,
              value: fmt.money(m.end),
              strong: true,
              labelExtra: (
                <InfoModal label={t.month.endInfoLabel} title={t.month.end} closeLabel={t.common.close}>
                  <div className="space-y-3 text-sm">
                    <p>{t.month.endDisclaimerIntro}</p>
                    <p className="font-medium">{t.month.endDisclaimerListTitle}</p>
                    <ul className="list-disc space-y-1.5 pl-5 text-muted">
                      {t.month.endDisclaimerItems.map((item) => (
                        <li key={item}>{item}</li>
                      ))}
                    </ul>
                    <p className="rounded-lg border border-[var(--warn-line)] bg-[var(--warn-bg)] p-3 text-xs">
                      {t.month.endDisclaimerOutro}
                    </p>
                  </div>
                </InfoModal>
              ),
            },
            {
              label: t.month.reserveVat,
              value: fmt.money(m.vatReserve.end),
              note: reserveNote(m.vatReserve, t, fmt, t.month.reservePending, m.vatReserve.pending),
            },
            {
              label: t.month.reserveTax,
              value: fmt.money(m.taxAside.end),
              note: reserveNote(m.taxAside, t, fmt, "", 0),
            },
            // What the total is made of: the taxes of each year and the year they will be due in.
            ...m.taxAside.byYear.map((x) => ({
              label: t.month.taxDueIn.replace("{due}", String(Number(x.year) + 1)).replace("{year}", x.year),
              value: fmt.money(x.amount),
              indent: true,
            })),
          ]}
        />
      </Section>
      )}

    </>
  );
}
