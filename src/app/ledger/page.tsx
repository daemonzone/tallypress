import { desc, eq } from "drizzle-orm";
import { db } from "@/db";
import { ledgerEntries } from "@/db/schema";
import { formatters } from "@/components/format";
import { primaryButtonClass, DataTable, inputClass, Notice, Section, Td } from "@/components/ui";
import { getDictionary } from "@/i18n";
import { addWithdrawal } from "@/lib/actions";
import { toCents } from "@/lib/money";
import { getCurrentShop } from "@/lib/shop";

export default async function LedgerPage() {
  const { locale, t } = await getDictionary();
  const shop = await getCurrentShop();
  if (!shop) return <Notice tone="warn">{t.setupNeeded.body}</Notice>;

  const entries = await db
    .select()
    .from(ledgerEntries)
    .where(eq(ledgerEntries.shopId, shop.id))
    .orderBy(desc(ledgerEntries.occurredAt))
    .limit(200);
  const fmt = formatters(locale, shop.currency);
  const date = new Intl.DateTimeFormat(locale, { dateStyle: "medium", timeZone: shop.timezone });

  return (
    <>
      <Section title={t.ledger.title}>
        {entries.length === 0 ? (
          <p className="text-sm opacity-70">{t.ledger.empty}</p>
        ) : (
          <DataTable head={[t.common.date, t.ledger.kind, t.common.amount, t.common.note]} numericFrom={2}>
            {entries.map((e) => (
              <tr key={e.id}>
                <td className="py-2 pr-3">{date.format(e.occurredAt)}</td>
                <td className="py-2 pr-3">{t.ledger.kinds[e.kind]}</td>
                <Td>{fmt.money(toCents(e.amount))}</Td>
                <td className="py-2 pr-3 text-right opacity-70">{e.note ?? ""}</td>
              </tr>
            ))}
          </DataTable>
        )}
        <p className="mt-2 text-xs opacity-60">{t.ledger.salesNote}</p>
      </Section>

      <Section title={t.ledger.withdrawTitle}>
        <p className="mb-3 text-xs opacity-70">{t.ledger.withdrawHelp}</p>
        <form action={addWithdrawal} className="flex max-w-md flex-col gap-3">
          <label className="flex flex-col gap-1 text-sm">
            {t.common.amount}
            <input name="amount" type="number" min="0.01" step="0.01" required className={inputClass} />
          </label>
          <label className="flex flex-col gap-1 text-sm">
            {t.common.note}
            <input name="note" type="text" maxLength={200} className={inputClass} />
          </label>
          <button type="submit" className={`${primaryButtonClass} self-start`}>
            {t.common.add}
          </button>
        </form>
      </Section>
    </>
  );
}
