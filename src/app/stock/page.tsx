import { formatters } from "@/components/format";
import { primaryButtonClass, DataTable, inputClass, Notice, Section, Td } from "@/components/ui";
import { getDictionary } from "@/i18n";
import { addRestock, setManualCost } from "@/lib/actions";
import { getItemStates } from "@/lib/costs";
import { getCurrentShop } from "@/lib/shop";

export default async function StockPage() {
  const { locale, t } = await getDictionary();
  const shop = await getCurrentShop();
  if (!shop) return <Notice tone="warn">{t.setupNeeded.body}</Notice>;

  const states = await getItemStates(shop.id);
  const fmt = formatters(locale, shop.currency);
  const money = (n: number | null) => (n == null ? t.common.none : fmt.money(Math.round(n * 100)));

  if (!states.length) return <Notice>{t.stock.noItems}</Notice>;

  return (
    <>
      <Section title={t.stock.title}>
        <DataTable head={[t.stock.item, t.stock.woo, t.stock.tracked, t.stock.avg, t.stock.manual, t.stock.value]}>
          {states.map((s) => {
            const mismatch = s.wooStock != null && s.wooStock !== s.trackedStock;
            return (
              <tr key={s.id}>
                <td className="py-2 pr-3">
                  {s.label}
                  {s.sku && <span className="ml-2 text-xs opacity-60">{s.sku}</span>}
                </td>
                <Td>{s.wooStock == null ? t.common.none : fmt.num(s.wooStock)}</Td>
                <Td>
                  {fmt.num(s.trackedStock)}
                  {mismatch && (
                    <span title={t.stock.mismatch} className="ml-1 text-amber-600">
                      ⚠
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
        <p className="mt-2 text-xs opacity-60">⚠ {t.stock.mismatch}</p>
      </Section>

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
