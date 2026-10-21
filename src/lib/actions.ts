"use server";

import { and, count, eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { db } from "@/db";
import { items, ledgerEntries, productCosts, restockLots, shops } from "@/db/schema";
import { freezeCosts } from "./costs";
import { estimateRestocks } from "./estimate-restocks";
import { importRange, type ImportRangeResult } from "./import-range";
import { rebuildCosts } from "./rebuild-costs";
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

export type ProductCostState = { status: "idle" | "ok" | "invalid" };

/**
 * Sets the purchase cost (net of VAT) of a whole product, for every size and colour at once, and
 * for variations that appear later. Costs here are estimates until real purchases are recorded, so
 * the new price is applied back over the opening stock, the estimated purchases and the sales of
 * that product, and the months are recomputed. While the account is not aligned with the bank yet,
 * the estimated purchases and tax payments are recomputed too; once aligned they are left alone so
 * the balance does not move.
 */
export async function setProductCost(_prev: ProductCostState, formData: FormData): Promise<ProductCostState> {
  const shopId = await getCurrentShopId();
  const productId = Number(formData.get("productId"));
  const cost = parseDecimal(formData.get("unitCost"));
  if (!Number.isInteger(productId) || !(cost >= 0)) return { status: "invalid" };

  const [known] = await db
    .select({ id: items.id })
    .from(items)
    .where(and(eq(items.shopId, shopId), eq(items.wooProductId, productId)))
    .limit(1);
  if (!known) return { status: "invalid" };

  const unitCost = cost.toFixed(4);
  await db.transaction(async (tx) => {
    await tx
      .insert(productCosts)
      .values({ shopId, wooProductId: productId, unitCost })
      .onConflictDoUpdate({ target: [productCosts.shopId, productCosts.wooProductId], set: { unitCost, updatedAt: new Date() } });
    await tx
      .update(items)
      .set({ manualUnitCost: unitCost, costSource: "manual" })
      .where(and(eq(items.shopId, shopId), eq(items.wooProductId, productId)));
  });

  const [{ n: estimates }] = await db
    .select({ n: count() })
    .from(ledgerEntries)
    .where(and(eq(ledgerEntries.shopId, shopId), eq(ledgerEntries.estimated, true)));
  const aligned = (await buildReport(shopId))?.aligned ?? false;
  if (estimates > 0 && !aligned) await estimateRestocks(shopId);
  else await rebuildCosts(shopId);

  revalidatePath("/", "layout");
  return { status: "ok" };
}

export type ProductRestockState = { status: "idle" | "ok" | "invalid" | "noQty" | "tooHigh" };

/**
 * Records a restock of one product as a single document: the declared amount (a cost per piece, or
 * the total paid plus the number of pieces) is booked once in the ledger as a movement, and the
 * pieces of each variation enter stock at the same unit cost. The moving average is never typed in:
 * it is computed from these lots. Amounts are net of VAT. A cost above the selling price (without
 * VAT) is refused, since it can only be a typing mistake.
 */
export async function addProductRestock(_prev: ProductRestockState, formData: FormData): Promise<ProductRestockState> {
  const shopId = await getCurrentShopId();
  const productId = Number(formData.get("productId"));
  const mode = formData.get("mode") === "total" ? "total" : "unit";
  const amount = parseDecimal(formData.get("amount"));
  if (!Number.isInteger(productId) || !(amount > 0)) return { status: "invalid" };

  const rows = await db.select().from(items).where(and(eq(items.shopId, shopId), eq(items.wooProductId, productId)));
  const lines: { item: (typeof rows)[number]; qty: number }[] = [];
  for (const [key, value] of formData.entries()) {
    if (!key.startsWith("qty_")) continue;
    const qty = parseDecimal(value as string);
    if (!(qty > 0)) continue;
    const item = rows.find((r) => r.id === key.slice(4));
    if (!item || !Number.isInteger(qty) || qty > 100000) return { status: "invalid" };
    lines.push({ item, qty });
  }
  const pieces = lines.reduce((sum, l) => sum + l.qty, 0);
  if (!pieces) return { status: "noQty" };

  const totalCents = mode === "total" ? Math.round(amount * 100) : Math.round(amount * pieces * 100);
  const unitCost = totalCents / 100 / pieces;

  // Sanity: a piece cannot cost more than it is sold for (price without VAT).
  const vat = 1 + Number((await db.select({ v: shops.vatRate }).from(shops).where(eq(shops.id, shopId)))[0]?.v ?? 0) / 100;
  const prices = lines.map((l) => Number(l.item.regularPrice ?? l.item.price ?? 0)).filter((n) => n > 0);
  if (prices.length && unitCost > Math.max(...prices) / vat) return { status: "tooHigh" };

  const name = rows[0]?.productName ?? `#${productId}`;
  await db.transaction(async (tx) => {
    const now = new Date();
    for (const l of lines) {
      await tx.insert(restockLots).values({
        shopId,
        itemId: l.item.id,
        quantity: String(l.qty),
        unitCost: unitCost.toFixed(4),
        purchasedAt: now,
        source: "restock",
        note: `${name}`,
      });
    }
    await tx.insert(ledgerEntries).values({
      shopId,
      kind: "restock",
      amount: centsToString(-totalCents),
      occurredAt: now,
      note: `${name}: ${pieces} pz × ${unitCost.toFixed(2)}`.slice(0, 200),
    });
  });
  await freezeCosts(shopId);
  revalidatePath("/", "layout");
  return { status: "ok" };
}
