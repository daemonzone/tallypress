"use server";

import { revalidatePath } from "next/cache";
import { getCurrentShopId } from "@/lib/shop";
import { syncShop } from "./index";

export type SyncState = { status: "idle" } | { status: "ok"; orders: number } | { status: "error"; error: string };

// Failures are also recorded on the shop (last_sync_error) and shown on the page.
export async function syncNow(): Promise<SyncState> {
  const result = await syncShop(await getCurrentShopId());
  revalidatePath("/", "layout");
  return result.ok ? { status: "ok", orders: result.orders } : { status: "error", error: result.error };
}
