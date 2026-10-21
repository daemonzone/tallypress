import { DiscountCalculator, type Bracket } from "@/components/discount-calculator";
import { Section } from "@/components/ui";
import { getDictionary } from "@/i18n";
import { getCurrentShop } from "@/lib/shop";

export default async function CalculatorPage() {
  const { locale, t } = await getDictionary();
  const shop = await getCurrentShop();

  const brackets: Bracket[] = shop?.incomeTaxBrackets?.length
    ? shop.incomeTaxBrackets.map((b) => ({ rate: b.rate, upTo: b.upTo }))
    : [{ rate: Number(shop?.incomeTaxRate ?? 0), upTo: null }];

  return (
    <Section title={t.calculator.title} help={t.calculator.intro}>
      <DiscountCalculator
        locale={locale}
        currency={shop?.currency ?? "EUR"}
        defaults={{
          vatRate: Number(shop?.vatRate ?? 22),
          socialRate: Number(shop?.socialSecurityRate ?? 0),
          socialDeductible: shop?.socialDeductible ?? true,
          brackets,
        }}
        labels={t.calculator}
      />
    </Section>
  );
}
