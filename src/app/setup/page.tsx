import { and, count, eq, gte, inArray, sql } from "drizzle-orm";
import { db } from "@/db";
import { items, ledgerEntries, orderLines, orders } from "@/db/schema";
import { KeyValues, Notice, Section, buttonClass, primaryButtonClass, inputClass } from "@/components/ui";
import { getDictionary } from "@/i18n";
import { saveOpening } from "@/lib/actions";
import { COUNTED_STATUSES } from "@/lib/costs";
import { getCurrentShop } from "@/lib/shop";
import { syncNow } from "@/lib/sync/actions";

export default async function SetupPage() {
  const { locale, t } = await getDictionary();
  const shop = await getCurrentShop();
  if (!shop) return <Notice tone="warn">{t.setupNeeded.body}</Notice>;

  const [itemRows, [orderCount], [opening]] = await Promise.all([
    db.select().from(items).where(eq(items.shopId, shop.id)).orderBy(items.productName, items.variationLabel),
    db.select({ n: count() }).from(orders).where(eq(orders.shopId, shop.id)),
    db
      .select({ id: ledgerEntries.id })
      .from(ledgerEntries)
      .where(and(eq(ledgerEntries.shopId, shop.id), eq(ledgerEntries.kind, "opening_balance"))),
  ]);

  // What was in stock at the start date: today's WooCommerce stock plus what sold since.
  const soldSince = new Map<string, number>();
  if (!opening && shop.baselineAt) {
    const sold = await db
      .select({ itemId: orderLines.itemId, qty: sql<string>`sum(${orderLines.quantity})` })
      .from(orderLines)
      .innerJoin(orders, eq(orders.id, orderLines.orderId))
      .where(
        and(
          eq(orderLines.shopId, shop.id),
          inArray(orders.status, COUNTED_STATUSES),
          gte(orders.placedAt, shop.baselineAt),
        ),
      )
      .groupBy(orderLines.itemId);
    for (const s of sold) if (s.itemId) soldSince.set(s.itemId, Number(s.qty));
  }

  const dateFmt = new Intl.DateTimeFormat(locale, { dateStyle: "medium", timeZone: shop.timezone });
  const baselineValue = shop.baselineAt?.toISOString().slice(0, 10) ?? new Date().toISOString().slice(0, 10);

  return (
    <>
      <Section title={t.setup.shopTitle}>
        <KeyValues
          rows={[
            { label: t.setup.currency, value: shop.currency },
            { label: t.setup.vat, value: `${shop.vatRate}%` },
            { label: t.setup.incomeTax, value: `${shop.incomeTaxRate}%` },
            {
              label: t.setup.taxBase,
              value: shop.taxBase === "profit" ? t.setup.taxBaseProfit : t.setup.taxBaseRevenue,
            },
            {
              label: t.setup.baseline,
              value: shop.baselineAt ? dateFmt.format(shop.baselineAt) : t.setup.baselineMissing,
            },
          ]}
        />
      </Section>

      <Section
        title={t.setup.syncTitle}
        aside={
          <form action={syncNow}>
            <button type="submit" className={buttonClass}>
              {t.setup.syncNow}
            </button>
          </form>
        }
      >
        {shop.lastSyncError && (
          <Notice tone="error">
            {t.setup.syncFailed}: {shop.lastSyncError}
          </Notice>
        )}
        <KeyValues
          rows={[
            { label: t.setup.products, value: itemRows.length },
            { label: t.setup.orders, value: orderCount.n },
            {
              label: t.setup.lastSync,
              value: shop.lastSyncedAt
                ? new Intl.DateTimeFormat(locale, { dateStyle: "medium", timeStyle: "short", timeZone: shop.timezone }).format(shop.lastSyncedAt)
                : t.setup.never,
            },
          ]}
        />
      </Section>

      <Section title={t.setup.openingTitle}>
        {opening ? (
          <p className="text-sm">{t.setup.openingDone}</p>
        ) : itemRows.length === 0 ? (
          <Notice tone="warn">{t.setup.needSync}</Notice>
        ) : (
          <form action={saveOpening} className="flex flex-col gap-4">
            <p className="text-sm opacity-80">{t.setup.openingIntro}</p>
            <div className="flex flex-wrap gap-4">
              <label className="flex flex-col gap-1 text-sm">
                {t.setup.startDate}
                <input name="baseline" type="date" required defaultValue={baselineValue} className={inputClass} />
              </label>
              <label className="flex flex-col gap-1 text-sm">
                {t.setup.balance} ({shop.currency})
                <input name="balance" type="number" step="0.01" required defaultValue="0" className={inputClass} />
              </label>
            </div>

            <h3 className="font-medium">{t.setup.stockAtStart}</h3>
            <div className="overflow-x-auto">
              <table className="w-full min-w-[32rem] text-left text-sm">
                <thead>
                  <tr className="border-b border-black/30 dark:border-white/30">
                    <th className="py-2 pr-3 font-medium">{t.common.item}</th>
                    <th className="py-2 pr-3 font-medium">{t.setup.qtyAtStart}</th>
                    <th className="py-2 pr-3 font-medium">{t.setup.costAtStart}</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-black/10 dark:divide-white/10">
                  {itemRows.map((i) => {
                    const suggested =
                      i.managesStock && i.stockQty != null ? Number(i.stockQty) + (soldSince.get(i.id) ?? 0) : null;
                    return (
                      <tr key={i.id}>
                        <td className="py-2 pr-3">
                          {i.variationLabel ? `${i.productName} – ${i.variationLabel}` : i.productName}
                          {i.sku && <span className="ml-2 text-xs opacity-60">{i.sku}</span>}
                        </td>
                        <td className="py-2 pr-3">
                          <input
                            name={`qty:${i.id}`}
                            type="number"
                            min="0"
                            step="any"
                            defaultValue={suggested ?? ""}
                            title={t.setup.suggested}
                            className={`${inputClass} w-28`}
                          />
                        </td>
                        <td className="py-2 pr-3">
                          <input name={`cost:${i.id}`} type="number" min="0" step="0.01" className={`${inputClass} w-28`} />
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            <p className="text-xs opacity-60">
              {t.setup.suggested}. {t.setup.openingWarn}
            </p>
            <button type="submit" className={`${primaryButtonClass} self-start`}>
              {t.setup.openingSave}
            </button>
          </form>
        )}
      </Section>
    </>
  );
}
