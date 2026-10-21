import { formatters } from "@/components/format";
import { Icon } from "@/components/icons";
import { Pager, SearchBox } from "@/components/pager";
import { ProductCostForm } from "@/components/product-cost-form";
import { Thumb } from "@/components/thumb";
import { primaryButtonClass, inputClass, Notice, Section } from "@/components/ui";
import { getDictionary } from "@/i18n";
import { addRestock, setProductCost } from "@/lib/actions";
import { getProductPage } from "@/lib/costs";
import { getCurrentShop } from "@/lib/shop";

const PER_PAGE = 20;
// product | quantity | cost | value | chevron
const COLUMNS = "grid-cols-[minmax(0,1fr)_6rem_10rem_8rem_1.25rem]";

export default async function StockPage({ searchParams }: PageProps<"/stock">) {
  const { locale, t } = await getDictionary();
  const shop = await getCurrentShop();
  if (!shop) return <Notice tone="warn">{t.setupNeeded.body}</Notice>;

  const sp = await searchParams;
  const q = typeof sp.q === "string" ? sp.q.trim().slice(0, 80) : "";
  const { groups, total, page, pages } = await getProductPage(shop.id, {
    q,
    page: Number(typeof sp.page === "string" ? sp.page : 1) || 1,
    perPage: PER_PAGE,
  });
  const fmt = formatters(locale, shop.currency);
  const money = (n: number | null) => (n == null ? t.common.none : fmt.money(Math.round(n * 100)));

  if (!groups.length && !q) return <Notice>{t.stock.noItems}</Notice>;

  const warn = <Icon name="alert" className="h-3.5 w-3.5 text-[var(--warn-line)] opacity-60" />;
  const chip = "rounded-full border border-line bg-surface-2 px-2 py-0.5 text-[11px] font-medium text-muted";
  const allItems = groups.flatMap((g) => g.items);

  return (
    <>
      <Section
        title={t.stock.title}
        aside={<SearchBox action="/stock" q={q} placeholder={t.stock.searchPlaceholder} button={t.stock.searchButton} wide />}
      >
        {groups.length === 0 ? (
          <p className="text-sm text-muted">{t.stock.noResults}</p>
        ) : (
          <div className="-mx-1 overflow-x-auto px-1">
            <div className="min-w-[44rem]">
              <div className={`grid ${COLUMNS} gap-3 border-b border-line py-2 text-xs font-medium uppercase tracking-wide text-muted`}>
                <div>{t.stock.product}</div>
                <div className="text-right">{t.stock.woo}</div>
                <div className="text-right">{t.stock.cost}</div>
                <div className="text-right">{t.stock.value}</div>
                <div />
              </div>

              {groups.map((g) => {
                const gone = g.status === "trash" || g.status === "deleted"; // no longer in the shop: greyed out
                const sameCost = g.cost && Math.abs(g.cost.max - g.cost.min) < 0.00005;
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
                      <Icon name="chevron" className="h-4 w-4 text-muted transition group-open:rotate-180" />
                    </summary>

                    <div className="space-y-4 pb-5 pl-[3.75rem] pr-6">
                      <ProductCostForm
                        productId={g.productId}
                        current={sameCost && g.cost ? g.cost.min : null}
                        labels={t.stock.costForm}
                        action={setProductCost}
                      />
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
                                <td className="py-1.5 pr-3 text-right tabular-nums">{money(s.manualCost)}</td>
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
        )}
        <Pager basePath="/stock" q={q} page={page} pages={pages} total={total} locale={locale} labels={t.stock} />
        {groups.length > 0 && (
          <p className="mt-3 flex items-center gap-1.5 text-xs text-muted">
            {warn}
            {t.stock.mismatch}
          </p>
        )}
      </Section>

      {groups.length > 0 && (
        <Section title={t.stock.restockTitle} help={t.stock.formsHint}>
          <p className="mb-3 text-xs text-muted">{t.stock.restockHelp}</p>
          <form action={addRestock} className="flex max-w-lg flex-col gap-3">
            <label className="flex flex-col gap-1 text-sm">
              {t.stock.item}
              <select name="itemId" required className={inputClass}>
                {allItems.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.label}
                    {s.sku ? ` (${s.sku})` : ""}
                  </option>
                ))}
              </select>
            </label>
            <label className="flex flex-col gap-1 text-sm">
              {t.common.quantity}
              <input name="quantity" type="number" min="0.001" step="any" required className={inputClass} />
            </label>
            <label className="flex flex-col gap-1 text-sm">
              {t.stock.unitCost}
              <input name="unitCost" type="number" min="0" step="0.01" required className={inputClass} />
            </label>
            <button type="submit" className={`${primaryButtonClass} self-start`}>
              {t.common.add}
            </button>
          </form>
        </Section>
      )}
    </>
  );
}
