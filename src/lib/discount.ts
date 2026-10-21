/** Per-item arithmetic for "is it worth selling at this discount?". Pure: money in euros, no database. */

export interface DiscountInput {
  costGross: number; // what the item cost, VAT included
  priceGross: number; // list price, VAT included
  vatRate: number; // percent
  marginalTaxPct: number; // share of an extra euro of profit that goes to income tax and contributions
  shippingPaidGross: number; // what the shop pays the carrier, VAT included
  shippingChargedGross: number; // what the customer is charged for shipping, VAT included
  otherCostsNet: number; // any other cost per sale, VAT excluded (packaging, payment fees...)
}

export interface DiscountResult {
  discountPct: number;
  priceGross: number; // price after the discount, VAT included
  vat: number; // VAT collected on the item and its shipping
  netRevenue: number; // item and shipping, VAT excluded
  netCost: number; // item, shipping and other costs, VAT excluded (the VAT paid on them is recovered)
  profitBeforeTax: number;
  tax: number; // negative when a loss reduces the tax on other profit
  profitAfterTax: number;
}

/**
 * The result of selling one item at a discount. VAT is never a cost: it is collected on the sale and
 * recovered on the purchase, so only the VAT-excluded amounts count. Income tax and contributions take
 * `marginalTaxPct` of the extra profit; a loss is assumed to reduce the tax on the rest of the profit.
 */
export function discountResult(i: DiscountInput, discountPct: number): DiscountResult {
  const f = 1 + i.vatRate / 100;
  const priceGross = i.priceGross * (1 - discountPct / 100);
  const netRevenue = (priceGross + i.shippingChargedGross) / f;
  const netCost = (i.costGross + i.shippingPaidGross) / f + i.otherCostsNet;
  const vat = priceGross + i.shippingChargedGross - netRevenue;
  const profitBeforeTax = netRevenue - netCost;
  const tax = (profitBeforeTax * i.marginalTaxPct) / 100;
  return { discountPct, priceGross, vat, netRevenue, netCost, profitBeforeTax, tax, profitAfterTax: profitBeforeTax - tax };
}

/** The discount at which the sale stops making a profit (before tax); 100 or more means it never does. */
export function breakEvenDiscount(i: DiscountInput): number {
  const f = 1 + i.vatRate / 100;
  const costNet = (i.costGross + i.shippingPaidGross) / f + i.otherCostsNet - i.shippingChargedGross / f;
  const neededGross = Math.max(costNet, 0) * f;
  return i.priceGross > 0 ? Math.max((1 - neededGross / i.priceGross) * 100, 0) : 0;
}

/** What giving the item away costs: its VAT-excluded cost, less the tax saved when the gift is deductible. */
export function giftResult(i: Pick<DiscountInput, "costGross" | "vatRate" | "marginalTaxPct">, deductible: boolean): number {
  const net = i.costGross / (1 + i.vatRate / 100);
  return -(deductible ? net * (1 - i.marginalTaxPct / 100) : net);
}

/** Share of an extra euro of profit taken by contributions and by the income-tax bracket (both in percent). */
export function marginalTaxPct(socialRatePct: number, bracketRatePct: number, socialDeductible: boolean): number {
  const s = socialRatePct / 100;
  const r = bracketRatePct / 100;
  return (s + r * (socialDeductible ? 1 - s : 1)) * 100;
}

/** The marginal income-tax rate (percent) that applies to a taxable income, in euros. */
export function bracketRateFor(taxable: number, brackets: { rate: number; upTo: number | null }[]): number {
  const b = brackets.find((x) => x.upTo == null || taxable <= x.upTo) ?? brackets.at(-1);
  return b?.rate ?? 0;
}
