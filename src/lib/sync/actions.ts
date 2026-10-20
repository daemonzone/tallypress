"use server";

import { revalidatePath } from "next/cache";
import { getCurrentShopId } from "@/lib/shop";
import { syncShop } from "./index";

// Failures are recorded on the shop (last_sync_error) and shown on the page.
export async function syncNow() {
  await syncShop(await getCurrentShopId());
  revalidatePath("/");
}
