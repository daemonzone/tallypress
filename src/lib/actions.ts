"use server";

import { and, eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { db } from "@/db";
import { items, ledgerEntries, restockLots, shops } from "@/db/schema";
import { freezeCosts, getProductStates } from "./costs";
import { importRange, type ImportRangeResult } from "./import-range";
import { buildReport } from "./report";
import { MOVEMENT_TYPES, type MovementState } from "./movements";
import { recordOpening } from "./opening";
import { centsToString, parseDecimal } from "./money";
import { getCurrentShopId } from "./shop";
import { syncShop } from "./sync";

// Entries are always booked "now": a closed month is never edited after the fact.
// Invalid input is ignored here; the forms use required/min attributes for feedback.

async function ownItem(shopId: string, itemId: string) {
  const [item] = await db
    .select({ id: items.id })
    .from(items)
    .where(and(eq(items.id, itemId), eq(items.shopId, shopId)));
  return item ?? null;
}

export async function addRestock(formData: FormData) {
  const shopId = await getCurrentShopId();
  const itemId = String(formData.get("itemId") ?? "");
  const quantity = parseDecimal(formData.get("quantity"));
  const unitCost = parseDecimal(formData.get("unitCost"));
  if (!(quantity > 0) || !(unitCost >= 0) || !(await ownItem(shopId, itemId))) return;

  await db.transaction(async (tx) => {
    const now = new Date();
    const [lot] = await tx
      .insert(restockLots)
      .values({
        shopId,
        itemId,
        quantity: String(quantity),
        unitCost: unitCost.toFixed(4),
        purchasedAt: now,
        source: "restock",
      })
      .returning({ id: restockLots.id });
    await tx.insert(ledgerEntries).values({
      shopId,
      kind: "restock",
      amount: centsToString(-Math.round(quantity * unitCost * 100)),
      occurredAt: now,
      restockLotId: lot.id,
    });
  });
  await freezeCosts(shopId);
  revalidatePath("/", "layout");
}

export async function addMovement(_prev: MovementState, formData: FormData): Promise<MovementState> {
  const shopId = await getCurrentShopId();
  const type = MOVEMENT_TYPES.find((t) => t.value === formData.get("type"));
  const amount = parseDecimal(formData.get("amount"));
  const note = String(formData.get("note") ?? "").trim().slice(0, 200);
  if (!type || !(amount > 0)) return { status: "invalid" };
  if (type.needsNote && !note) return { status: "note" };

  await db.insert(ledgerEntries).values({
    shopId,
    kind: type.kind,
    amount: centsToString(type.sign * Math.round(amount * 100)),
    occurredAt: new Date(),
    note: note || null,
  });
  revalidatePath("/", "layout");
  return { status: "ok" };
}

export async function setManualCost(formData: FormData) {
  const shopId = await getCurrentShopId();
  const itemId = String(formData.get("itemId") ?? "");
  const cost = parseDecimal(formData.get("unitCost"));
  if (!(cost >= 0) || !(await ownItem(shopId, itemId))) return;
  await db.update(items).set({ manualUnitCost: cost.toFixed(4), costSource: "manual" }).where(eq(items.id, itemId));
  await freezeCosts(shopId);
  revalidatePath("/", "layout");
}

export async function saveOwnerShare(formData: FormData) {
  const shopId = await getCurrentShopId();
  const pct = parseDecimal(formData.get("pct"));
  if (!(pct >= 0 && pct <= 100)) return;
  await db.update(shops).set({ ownerSharePct: pct.toFixed(2) }).where(eq(shops.id, shopId));
  revalidatePath("/", "layout");
}

export async function saveOpening(formData: FormData) {
  const shopId = await getCurrentShopId();

  const baselineRaw = String(formData.get("baseline") ?? "");
  const balance = parseDecimal(formData.get("balance"));
  if (!/^\d{4}-\d{2}-\d{2}$/.test(baselineRaw) || Number.isNaN(balance)) return;
  const baselineAt = new Date(`${baselineRaw}T00:00:00Z`);

  const shopItems = await db.select({ id: items.id }).from(items).where(eq(items.shopId, shopId));
  const lots = shopItems.flatMap(({ id }) => {
    const quantity = parseDecimal(formData.get(`qty:${id}`));
    const unitCost = parseDecimal(formData.get(`cost:${id}`));
    // Stock without a price is skipped: that item then shows up as "cost missing".
    return quantity > 0 && unitCost >= 0 ? [{ itemId: id, quantity, unitCost }] : [];
  });

  const recorded = await recordOpening(shopId, {
    baselineAt,
    balanceCents: Math.round(balance * 100),
    lots,
  });
  if (!recorded) return;

  await syncShop(shopId);
  await freezeCosts(shopId);
  revalidatePath("/", "layout");
}

/** Imports the orders of a period without erasing anything (see lib/import-range.ts). */
export async function importPeriod(_prev: ImportRangeResult | null, formData: FormData): Promise<ImportRangeResult> {
  const shopId = await getCurrentShopId();
  const result = await importRange(shopId, {
    from: String(formData.get("from") ?? ""),
    to: String(formData.get("to") ?? "") || undefined,
    rebuildClosings: formData.get("rebuild") === "on",
    historyOnly: formData.get("historyOnly") === "on",
  });
  revalidatePath("/", "layout");
  return result;
}

export type AlignState =
  | { status: "idle" }
  | { status: "invalid" }
  | { status: "same" }
  | { status: "ok"; difference: number; balance: number }; // cents

/**
 * Aligns the computed shop-account balance with the real bank balance: records the difference as an
 * adjustment (booked today) so everything that follows starts from the real figure.
 */
export async function alignBalance(_prev: AlignState, formData: FormData): Promise<AlignState> {
  const shopId = await getCurrentShopId();
  const real = parseDecimal(formData.get("balance"));
  if (Number.isNaN(real)) return { status: "invalid" };

  const report = await buildReport(shopId);
  if (!report) return { status: "invalid" };
  const difference = Math.round(real * 100) - report.overview.cash;
  if (difference === 0) return { status: "same" };

  await db.insert(ledgerEntries).values({
    shopId,
    kind: "adjustment",
    amount: centsToString(difference),
    occurredAt: new Date(),
    note: `Allineamento al saldo della banca (saldo reale ${real.toFixed(2)})`,
  });
  revalidatePath("/", "layout");
  return { status: "ok", difference, balance: Math.round(real * 100) };
}

export type DifferenceState = { status: "idle" | "ok" | "invalid" | "tooHigh" | "gone" };

/**
 * Settles the pieces that entered a product's stock without being recorded (WooCommerce holds more
 * than the internal figures). The quantities are never typed: they are recomputed here from the
 * data. "restock": the total paid (with or without VAT, at the rate given) is the only figure entered;
 * the cost per piece is the net / pieces, the gross is booked once in the ledger (with its VAT, which
 * is deducted from the VAT due) and the average moves only through that calculation.
 * "adjust": not a purchase (an inventory correction): the pieces enter at the current average cost,
 * with no money movement. A cost above the selling price (without VAT) is refused.
 */
export async function resolveDifference(_prev: DifferenceState, formData: FormData): Promise<DifferenceState> {
  const shopId = await getCurrentShopId();
  const productId = Number(formData.get("productId"));
  const kind = formData.get("kind") === "adjust" ? "adjust" : "restock";
  const total = parseDecimal(formData.get("total"));
  const vatIncluded = formData.get("vatMode") !== "without";
  const vatRate = parseDecimal(formData.get("vatRate"));
  if (!Number.isInteger(productId) || (kind === "restock" && !(total > 0))) return { status: "invalid" };
  if (kind === "restock" && !(vatRate >= 0 && vatRate <= 100)) return { status: "invalid" };

  const states = await getProductStates(shopId, productId);
  const arrived = states.filter((s) => (s.diff ?? 0) > 0 && s.status !== "trash" && s.status !== "deleted");
  const pieces = arrived.reduce((sum, s) => sum + (s.diff ?? 0), 0);
  if (!pieces) return { status: "gone" };

  // The amount typed is with or without VAT; the cash that leaves the account is the gross, the cost is the net.
  const factor = 1 + vatRate / 100;
  const grossCents = vatIncluded ? Math.round(total * 100) : Math.round(total * factor * 100);
  const totalCents = vatIncluded ? Math.round(grossCents / factor) : Math.round(total * 100); // net
  const vatCents = grossCents - totalCents;
  if (kind === "restock") {
    const [shop] = await db.select({ vat: shops.vatRate }).from(shops).where(eq(shops.id, shopId));
    const vat = 1 + Number(shop?.vat ?? 0) / 100;
    const rows = await db.select().from(items).where(and(eq(items.shopId, shopId), eq(items.wooProductId, productId)));
    const prices = rows.map((r) => Number(r.regularPrice ?? r.price ?? 0)).filter((n) => n > 0);
    if (prices.length && totalCents / 100 / pieces > Math.max(...prices) / vat) return { status: "tooHigh" };
  }

  const name = states[0]?.label.split(" – ")[0] ?? `#${productId}`;
  await db.transaction(async (tx) => {
    const now = new Date();
    for (const s of arrived) {
      const unit = kind === "restock" ? totalCents / 100 / pieces : (s.avgCost ?? s.manualCost ?? 0);
      await tx.insert(restockLots).values({
        shopId,
        itemId: s.id,
        quantity: String(s.diff),
        unitCost: unit.toFixed(4),
        purchasedAt: now,
        source: kind === "restock" ? "restock" : "return",
        note: kind === "restock" ? name : `Rettifica di inventario: ${name}`,
      });
    }
    if (kind === "restock") {
      await tx.insert(ledgerEntries).values({
        shopId,
        kind: "restock",
        amount: centsToString(-grossCents),
        vatAmount: centsToString(vatCents),
        occurredAt: now,
        note: `${name}: ${pieces} × ${(totalCents / 100 / pieces).toFixed(2)} + IVA ${vatRate}%`.slice(0, 200),
      });
    }
  });
  await freezeCosts(shopId);
  revalidatePath("/", "layout");
  return { status: "ok" };
}
