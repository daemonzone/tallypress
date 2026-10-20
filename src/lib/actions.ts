"use server";

import { and, eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { db } from "@/db";
import { items, ledgerEntries, restockLots, shops } from "@/db/schema";
import { freezeCosts } from "./costs";
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

export async function addWithdrawal(formData: FormData) {
  const shopId = await getCurrentShopId();
  const amount = parseDecimal(formData.get("amount"));
  if (!(amount > 0)) return;
  await db.insert(ledgerEntries).values({
    shopId,
    kind: "withdrawal",
    amount: centsToString(-Math.round(amount * 100)),
    occurredAt: new Date(),
    note: String(formData.get("note") ?? "").trim() || null,
  });
  revalidatePath("/", "layout");
}

export async function setManualCost(formData: FormData) {
  const shopId = await getCurrentShopId();
  const itemId = String(formData.get("itemId") ?? "");
  const cost = parseDecimal(formData.get("unitCost"));
  if (!(cost >= 0) || !(await ownItem(shopId, itemId))) return;
  await db.update(items).set({ manualUnitCost: cost.toFixed(4) }).where(eq(items.id, itemId));
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
