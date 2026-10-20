import { eq } from "drizzle-orm";
import { db } from "@/db";
import { shops } from "@/db/schema";

/**
 * The one place that decides which shop a request is about. Every query must be
 * scoped by this id. For the MVP it is a fixed id from the environment; later it
 * can come from the route, a shop selector or the authenticated session.
 */
export async function getCurrentShopId(): Promise<string> {
  const id = process.env.DEFAULT_SHOP_ID;
  if (!id) throw new Error("DEFAULT_SHOP_ID is not set");
  return id;
}

export async function getCurrentShop() {
  const id = await getCurrentShopId();
  const [shop] = await db.select().from(shops).where(eq(shops.id, id));
  return shop ?? null;
}
