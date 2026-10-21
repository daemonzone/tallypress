import { formatters } from "@/components/format";
import { Icon } from "@/components/icons";
import { Pager, SearchBox } from "@/components/pager";
import { Thumb } from "@/components/thumb";
import { primaryButtonClass, DataTable, inputClass, Notice, Section, Td } from "@/components/ui";
import { getDictionary } from "@/i18n";
import { addRestock, setManualCost } from "@/lib/actions";
import { getItemStatePage } from "@/lib/costs";
import { getCurrentShop } from "@/lib/shop";

const PER_PAGE = 20;

export default async function StockPage({ searchParams }: PageProps<"/stock">) {
  const { locale, t } = await getDictionary();
  const shop = await getCurrentShop();
  if (!shop) return <Notice tone="warn">{t.setupNeeded.body}</Notice>;

  const sp = await searchParams;
  const q = typeof sp.q === "string" ? sp.q.trim().slice(0, 80) : "";
  const { rows: states, total, page, pages } = await getItemStatePage(shop.id, {
    q,
    page: Number(typeof sp.page === "string" ? sp.page : 1) || 1,
    perPage: PER_PAGE,
  });
  const fmt = formatters(locale, shop.currency);
  const money = (n: number | null) => (n == null ? t.common.none : fmt.money(Math.round(n * 100)));

  if (!states.length && !q) return <Notice>{t.stock.noItems}</Notice>;

  return (
    <>
      <Section
        title={t.stock.title}
        aside={<SearchBox action="/stock" q={q} placeholder={t.stock.searchPlaceholder} button={t.stock.searchButton} />}
      >
        {states.length === 0 ? (
          <p className="text-sm text-muted">{t.stock.noResults}</p>
        ) : (
        <DataTable head={[t.stock.item, t.stock.woo, t.stock.avg, t.stock.manual, t.stock.value]}>
          {states.map((s) => {
            const mismatch = s.wooStock != null && s.trackedStock != null && s.wooStock !== s.trackedStock;
            const gone = s.status === "trash" || s.status === "deleted"; // no longer in the shop: greyed out
            return (
              <tr key={s.id} className={gone ? "text-muted [&_img]:opacity-50" : undefined}>
                <td className="py-2 pr-3">
                  <div className="flex items-center gap-3">
                    <Thumb src={s.imageUrl} alt={s.label} />
                    <div className="min-w-0">
                      {s.label}
                      {s.sku && <span className="ml-2 text-xs text-muted">{s.sku}</span>}
                      {(s.status === "trash" || s.status === "deleted") && (
                        <span className="ml-2 rounded-full border border-line bg-surface-2 px-2 py-0.5 text-[11px] font-medium text-muted">
                          {s.status === "trash" ? t.stock.trashed : t.stock.deleted}
                        </span>
                      )}
                    </div>
                  </div>
                </td>
                <Td>
                  {s.wooStock == null ? (
                    t.common.none
                  ) : (
                    <span className="inline-flex items-center justify-end gap-1.5">
                      {/* Test aid: the shop's quantity does not match the internal figures (purchases minus sales). */}
                      {mismatch && (
                        <span title={t.stock.mismatchTip.replace("{n}", fmt.num(s.trackedStock ?? 0))}>
                          <Icon name="alert" className="h-3.5 w-3.5 text-[var(--warn-line)] opacity-60" />
                          <span className="sr-only">{t.stock.mismatchTip.replace("{n}", fmt.num(s.trackedStock ?? 0))}</span>
                        </span>
                      )}
                      {fmt.num(s.wooStock)}
                    </span>
                  )}
                </Td>
                <Td>{money(s.avgCost)}</Td>
                <Td>{money(s.manualCost)}</Td>
                <Td>{fmt.money(Math.round(s.stockValue * 100))}</Td>
              </tr>
            );
          })}
        </DataTable>
        )}
        <Pager basePath="/stock" q={q} page={page} pages={pages} total={total} locale={locale} labels={t.stock} />
        {states.length > 0 && (
          <p className="mt-3 flex items-center gap-1.5 text-xs text-muted">
            <Icon name="alert" className="h-3.5 w-3.5 text-[var(--warn-line)] opacity-60" />
            {t.stock.mismatch}
          </p>
        )}
      </Section>

      {states.length > 0 && (
      <div className="grid gap-8 md:grid-cols-2">
        <Section title={t.stock.restockTitle}>
          <p className="mb-3 text-xs opacity-70">{t.stock.restockHelp}</p>
          <form action={addRestock} className="flex flex-col gap-3">
            <ItemSelect states={states} label={t.stock.item} />
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

        <Section title={t.stock.manualTitle}>
          <p className="mb-3 text-xs opacity-70">{t.stock.manualHelp}</p>
          <form action={setManualCost} className="flex flex-col gap-3">
            <ItemSelect states={states} label={t.stock.item} />
            <label className="flex flex-col gap-1 text-sm">
              {t.stock.unitCost}
              <input name="unitCost" type="number" min="0" step="0.01" required className={inputClass} />
            </label>
            <button type="submit" className={`${primaryButtonClass} self-start`}>
              {t.common.save}
            </button>
          </form>
        </Section>
      </div>
      )}
      {states.length > 0 && <p className="-mt-2 text-xs text-muted">{t.stock.formsHint}</p>}
    </>
  );
}

function ItemSelect({ states, label }: { states: { id: string; label: string; sku: string | null }[]; label: string }) {
  return (
    <label className="flex flex-col gap-1 text-sm">
      {label}
      <select name="itemId" required className={inputClass}>
        {states.map((s) => (
          <option key={s.id} value={s.id}>
            {s.label}
            {s.sku ? ` (${s.sku})` : ""}
          </option>
        ))}
      </select>
    </label>
  );
}
