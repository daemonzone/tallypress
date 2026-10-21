import { formatters } from "@/components/format";
import { Icon } from "@/components/icons";
import { Pager, SearchBox } from "@/components/pager";
import { DifferenceForm } from "@/components/difference-form";
import { Thumb } from "@/components/thumb";
import Link from "next/link";
import { Fragment } from "react";
import { buttonClass, Notice, Section } from "@/components/ui";
import { getDictionary } from "@/i18n";
import { resolveDifference } from "@/lib/actions";
import { getDifferences, getProductPage } from "@/lib/costs";
import { DiscountButtons, DiscountHeader, DiscountProvider, DiscountedCell } from "@/components/stock-discount";
import { bracketRateFor, discountResult, marginalTaxPct } from "@/lib/discount";
import { buildReport } from "@/lib/report";
import { getCurrentShop } from "@/lib/shop";

const PER_PAGE = 20;
// product | quantity | cost | value | chevron
const DIFF_COLUMNS = "grid-cols-[minmax(0,1fr)_6rem_minmax(0,1.5fr)]";
// a vertical rule that separates the figures that follow the selling price
const DIVIDER = "border-l border-line pl-3";
const COLUMNS = "grid-cols-[minmax(12rem,1fr)_3.5rem_8rem_5.5rem_6.5rem_6.5rem_6.5rem_6.5rem_1.25rem]";

export default async function StockPage({ searchParams }: PageProps<"/stock">) {
  const { locale, t } = await getDictionary();
  const shop = await getCurrentShop();
  if (!shop) return <Notice tone="warn">{t.setupNeeded.body}</Notice>;

  const sp = await searchParams;
  const q = typeof sp.q === "string" ? sp.q.trim().slice(0, 80) : "";
  const onlyDiff = sp.diff === "1";

  // Income tax and contributions on an extra euro of profit: the bracket the current year has reached.
  const report = await buildReport(shop.id);
  const year = report?.currentKey.slice(0, 4) ?? "";
  const yearProfit = (report?.months ?? []).filter((m) => m.key.startsWith(year) && !m.history).reduce((sum, m) => sum + m.profit, 0) / 100;
  const social = Number(shop.socialSecurityRate);
  const brackets = shop.incomeTaxBrackets?.length ? shop.incomeTaxBrackets : [{ rate: Number(shop.incomeTaxRate), upTo: null }];
  const taxable = Math.max(yearProfit, 0) * (shop.socialDeductible ? 1 - social / 100 : 1);
  const taxPct = marginalTaxPct(social, bracketRateFor(taxable, brackets), shop.socialDeductible);
  const vatRate = Number(shop.vatRate);
  const differences = await getDifferences(shop.id);
  const toClassify = differences.filter((d) => d.items.some((i) => i.diff > 0));
  const fewer = differences.filter((d) => !d.items.some((i) => i.diff > 0));
  const extra: Record<string, string> = onlyDiff ? { diff: "1" } : {};
  const { groups, total, page, pages } = await getProductPage(shop.id, {
    productIds: onlyDiff ? differences.map((d) => d.productId) : undefined,
    q,
    page: Number(typeof sp.page === "string" ? sp.page : 1) || 1,
    perPage: PER_PAGE,
  });
  const fmt = formatters(locale, shop.currency);
  const money = (n: number | null) => (n == null ? t.common.none : fmt.money(Math.round(n * 100)));

  if (!groups.length && !q && !onlyDiff) return <Notice>{t.stock.noItems}</Notice>;

  const warn = <Icon name="alert" className="h-3.5 w-3.5 text-[var(--warn-line)] opacity-60" />;
  const chip = "rounded-full border border-line bg-surface-2 px-2 py-0.5 text-[11px] font-medium text-muted";

  const filterLink = onlyDiff ? `/stock${q ? `?${new URLSearchParams({ q })}` : ""}` : `/stock?${new URLSearchParams({ diff: "1", ...(q ? { q } : {}) })}`;

  return (
    <>
      {differences.length > 0 && (
        <Section title={t.stock.diffTitle}>
          {toClassify.length > 0 && (
            <>
              <Notice tone="warn">{(toClassify.length === 1 ? t.stock.diffBannerOne : t.stock.diffBanner).replace("{n}", String(toClassify.length))}</Notice>
              <div className="overflow-x-auto">
                <div className="min-w-[44rem]">
                  <div className={`grid ${DIFF_COLUMNS} gap-x-4 border-b border-line py-2 text-xs font-medium uppercase tracking-wide text-muted`}>
                    <div>{t.stock.product}</div>
                    <div className="text-center">{t.stock.diffAdded}</div>
                    <div>{t.stock.diffReconcile}</div>
                  </div>
                  {toClassify.map((d) => {
                    const arrived = d.items.filter((i) => i.diff > 0);
                    return (
                      <div key={d.productId} className={`grid ${DIFF_COLUMNS} items-start gap-x-4 gap-y-3 border-b border-line py-4`}>
                        {arrived.map((i, n) => (
                          <Fragment key={i.id}>
                            <div className="flex items-start gap-3" style={{ gridRow: n + 1, gridColumn: 1 }}>
                              <Thumb src={d.imageUrl} alt={d.name} />
                              <div className="min-w-0">
                                <div className="truncate font-medium">{d.name}</div>
                                <div className="text-xs text-muted">{i.label || t.stock.noVariant}</div>
                              </div>
                            </div>
                            <div className="flex justify-center" style={{ gridRow: n + 1, gridColumn: 2 }}>
                              <span className="inline-flex h-9 min-w-9 items-center justify-center rounded-lg border border-[var(--warn-line)] bg-[var(--warn-bg)] px-2 text-sm font-semibold tabular-nums">
                                +{i.diff}
                              </span>
                            </div>
                          </Fragment>
                        ))}
                        <div style={{ gridRow: `1 / span ${arrived.length}`, gridColumn: 3 }}>
                          <DifferenceForm
                            productId={d.productId}
                            pieces={arrived.reduce((sum, i) => sum + i.diff, 0)}
                            locale={locale}
                            currency={shop.currency}
                            vatRate={Number(shop.vatRate)}
                            labels={t.stock.diffForm}
                            action={resolveDifference}
                          />
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            </>
          )}
          {fewer.length > 0 && (
            <Notice tone="info">
              {(fewer.length === 1 ? t.stock.diffFewerOne : t.stock.diffFewer).replace("{n}", String(fewer.length))}
            </Notice>
          )}
        </Section>
      )}
      <Section
        title={t.stock.title}
        aside={
          <div className="flex flex-wrap items-center justify-end gap-2">
            {differences.length > 0 && (
              <Link href={filterLink} className={`${buttonClass} ${onlyDiff ? "border-[var(--warn-line)] bg-[var(--warn-bg)]" : ""}`}>
                {onlyDiff ? t.stock.allProducts : t.stock.onlyDiff.replace("{n}", String(differences.length))}
              </Link>
            )}
            <SearchBox action="/stock" q={q} placeholder={t.stock.searchPlaceholder} button={t.stock.searchButton} wide extra={extra} />
          </div>
        }
      >
        {groups.length === 0 ? (
          <p className="text-sm text-muted">{t.stock.noResults}</p>
        ) : (
          <DiscountProvider vatRate={vatRate} taxPct={taxPct} locale={locale} currency={shop.currency}>
          <DiscountButtons label={t.stock.discountLabel} note={t.stock.discountNote.replace("{n}", fmt.pct(taxPct / 100))} />
          <div className="-mx-1 overflow-x-auto px-1">
            <div className="min-w-[66rem]">
              <div className={`grid ${COLUMNS} gap-3 border-b border-line py-2 text-xs font-medium uppercase tracking-wide text-muted`}>
                <div>{t.stock.product}</div>
                <div className="text-right">{t.stock.woo}</div>
                <div className="text-right">{t.stock.cost}</div>
                <div className="text-right">{t.stock.value}</div>
                <div className="text-right">{t.stock.price}</div>
                <div className={`-my-2 self-stretch py-2 text-right ${DIVIDER}`}>{t.stock.profit}</div>
                <div className="text-right">{t.stock.pocket}</div>
                <DiscountHeader label={t.stock.discounted} />
                <div />
              </div>

              {groups.map((g) => {
                const gone = g.status === "trash" || g.status === "deleted"; // no longer in the shop: greyed out
                const sameCost = g.cost && Math.abs(g.cost.max - g.cost.min) < 0.00005;
                const sale =
                  g.price != null && g.unitCost != null
                    ? discountResult(
                        { costGross: 0, priceGross: g.price, vatRate, marginalTaxPct: taxPct, shippingPaidGross: 0, shippingChargedGross: 0, otherCostsNet: g.unitCost },
                        0,
                      )
                    : null;
                return (
                  <details key={g.productId} className="group border-b border-line">
                    <summary
                      className={`grid ${COLUMNS} cursor-pointer list-none items-center gap-3 py-2.5 hover:bg-surface-2/60 [&::-webkit-details-marker]:hidden ${
                        gone ? "text-muted [&_img]:opacity-50" : ""
                      }`}
                    >
                      <div className="flex min-w-0 items-center gap-3">
                        <Thumb src={g.imageUrl} alt={g.name} />
                        <div className="min-w-0">
                          <div className="truncate font-medium">{g.name}</div>
                          <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted">
                            {g.code && <span>{g.code}</span>}
                            {g.items.length > 1 && <span>{t.stock.variantsCount.replace("{n}", String(g.items.length))}</span>}
                            {gone && <span className={chip}>{g.status === "trash" ? t.stock.trashed : t.stock.deleted}</span>}
                          </div>
                        </div>
                      </div>
                      <div className="inline-flex items-center justify-end gap-1.5 tabular-nums">
                        {g.mismatch && <span title={t.stock.mismatch}>{warn}</span>}
                        {g.wooStock == null ? t.common.none : fmt.num(g.wooStock)}
                      </div>
                      <div className="flex items-center justify-end gap-2 tabular-nums">
                        {g.costSource !== "manual" && <span className={chip}>{g.costSource === "mixed" ? t.stock.mixed : t.stock.estimated}</span>}
                        {g.cost == null ? t.common.none : sameCost ? money(g.cost.min) : `${money(g.cost.min)} – ${money(g.cost.max)}`}
                      </div>
                      <div className="text-right tabular-nums">{fmt.money(Math.round(g.stockValue * 100))}</div>
                      <div className="text-right tabular-nums">{g.price == null ? t.common.none : money(g.price)}</div>
                      <div className={`-my-2.5 flex items-center justify-end self-stretch py-2.5 tabular-nums ${DIVIDER}`}>
                        {sale ? (
                          <span className={sale.profitBeforeTax < -0.005 ? "text-bad" : ""}>{money(sale.profitBeforeTax)}</span>
                        ) : (
                          t.common.none
                        )}
                      </div>
                      <div className={`text-right tabular-nums ${sale && sale.profitAfterTax < -0.005 ? "text-bad" : ""}`}>{sale ? money(sale.profitAfterTax) : t.common.none}</div>
                      <DiscountedCell price={g.price} cost={g.unitCost} />
                      <Icon name="chevron" className="h-4 w-4 text-muted transition group-open:rotate-180" />
                    </summary>

                    <div className="space-y-4 pb-5 pl-[3.75rem] pr-6">
                      <table className="w-full text-sm">
                        <thead>
                          <tr className="border-b border-line text-xs uppercase tracking-wide text-muted">
                            <th className="py-1.5 pr-3 text-left font-medium">{t.stock.variant}</th>
                            <th className="py-1.5 pr-3 text-left font-medium">{t.stock.code}</th>
                            <th className="py-1.5 pr-3 text-right font-medium">{t.stock.woo}</th>
                            <th className="py-1.5 pr-3 text-right font-medium">{t.stock.cost}</th>
                            <th className="py-1.5 text-right font-medium">{t.stock.value}</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-line">
                          {g.items.map((s) => {
                            const mismatch = s.wooStock != null && s.trackedStock != null && s.wooStock !== s.trackedStock;
                            return (
                              <tr key={s.id}>
                                <td className="py-1.5 pr-3">{s.variation ?? t.stock.noVariant}</td>
                                <td className="py-1.5 pr-3 text-muted">{s.sku ?? t.common.none}</td>
                                <td className="py-1.5 pr-3 text-right tabular-nums">
                                  {s.wooStock == null ? (
                                    t.common.none
                                  ) : (
                                    <span className="inline-flex items-center justify-end gap-1.5">
                                      {mismatch && (
                                        <span title={t.stock.mismatchTip.replace("{n}", fmt.num(s.trackedStock ?? 0))}>
                                          {warn}
                                          <span className="sr-only">{t.stock.mismatchTip.replace("{n}", fmt.num(s.trackedStock ?? 0))}</span>
                                        </span>
                                      )}
                                      {fmt.num(s.wooStock)}
                                    </span>
                                  )}
                                </td>
                                <td className="py-1.5 pr-3 text-right tabular-nums">{money(s.avgCost)}</td>
                                <td className="py-1.5 text-right tabular-nums">{fmt.money(Math.round(s.stockValue * 100))}</td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    </div>
                  </details>
                );
              })}
            </div>
          </div>
          </DiscountProvider>
        )}
        <Pager basePath="/stock" extra={extra} q={q} page={page} pages={pages} total={total} locale={locale} labels={t.stock} />
        {groups.length > 0 && (
          <p className="mt-3 flex items-center gap-1.5 text-xs text-muted">
            {warn}
            {t.stock.mismatch}
          </p>
        )}
      </Section>

    </>
  );
}
