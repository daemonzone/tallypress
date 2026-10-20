import { LanguageSelector } from "@/components/language-selector";
import { getDictionary } from "@/i18n";
import { getCurrentShop } from "@/lib/shop";

export default async function Home() {
  const { locale, t } = await getDictionary();
  const shop = await getCurrentShop();

  return (
    <main className="mx-auto w-full max-w-4xl flex-1 px-4 py-8">
      <header className="mb-8 flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold">{t.app.name}</h1>
          <p className="text-sm opacity-70">{t.app.tagline}</p>
        </div>
        <LanguageSelector current={locale} t={t} />
      </header>

      {!shop ? (
        <section className="rounded border border-amber-500/50 p-4">
          <h2 className="font-medium">{t.setup.noShopTitle}</h2>
          <p className="text-sm opacity-80">{t.setup.noShopBody}</p>
        </section>
      ) : (
        <>
          <h2 className="mb-3 text-lg font-medium">{shop.name}</h2>
          <table className="mb-8 w-full text-left text-sm">
            <tbody className="divide-y divide-black/10 dark:divide-white/10">
              <Row label={t.shop.currency} value={shop.currency} />
              <Row label={t.shop.vat} value={`${shop.vatRate}%`} />
              <Row label={t.shop.incomeTax} value={`${shop.incomeTaxRate}%`} />
              <Row
                label={t.shop.taxBase}
                value={shop.taxBase === "profit" ? t.shop.taxBaseProfit : t.shop.taxBaseRevenue}
              />
              <Row
                label={t.shop.baseline}
                value={
                  shop.baselineAt
                    ? shop.baselineAt.toLocaleDateString(locale)
                    : t.shop.baselineMissing
                }
              />
            </tbody>
          </table>

          <table className="w-full text-left text-sm">
            <tbody className="divide-y divide-black/10 dark:divide-white/10">
              <Row label={t.panel.ordersPlaced} value="—" />
              <Row label={t.panel.gross} value="—" />
              <Row label={t.panel.net} value="—" />
              <Row label={t.panel.balance} value="—" />
            </tbody>
          </table>
          <p className="mt-3 text-xs opacity-60">{t.panel.notSynced}</p>
        </>
      )}
    </main>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <tr>
      <th scope="row" className="w-1/2 py-2 pr-4 font-normal opacity-70">
        {label}
      </th>
      <td className="py-2">{value}</td>
    </tr>
  );
}
