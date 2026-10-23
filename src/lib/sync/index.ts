import { eq } from "drizzle-orm";
import { db, pool } from "@/db";
import { shops } from "@/db/schema";
import { ensureMonthsClosed } from "@/lib/closing";
import { freezeCosts, relinkLines } from "@/lib/costs";
import { syncItems, syncMissingItems } from "./items";
import { syncOrders } from "./orders";

export type SyncResult =
  | { shopId: string; ok: true; items: number; orders: number }
  | { shopId: string; ok: false; error: string; busy?: true };

/**
 * Syncs one shop; by default only what changed since the last run (`full` re-reads the whole
 * catalogue, orders included in the same incremental way). A Postgres advisory lock (one per shop) stops a manual run and the
 * cron from overlapping; the lock lives on its own connection for the whole run.
 */
export async function syncShop(shopId: string, { full = false }: { full?: boolean } = {}): Promise<SyncResult> {
  const lock = await pool.connect();
  try {
    const { rows } = await lock.query<{ locked: boolean }>(
      "SELECT pg_try_advisory_lock(hashtext($1)) AS locked",
      [`tallypress:sync:${shopId}`],
    );
    if (!rows[0].locked) return { shopId, ok: false, error: "A sync is already running", busy: true };

    const startedAt = new Date();
    try {
      const [shop] = await db.select().from(shops).where(eq(shops.id, shopId));
      if (!shop) throw new Error("Shop not found");

      const itemCount = await syncItems(shop, full);
      const orderCount = await syncOrders(shop);
      // Give new sales their purchase cost, then close any month that has ended.
      await syncMissingItems(shop);
      await relinkLines(shopId);
      await freezeCosts(shopId);
      await ensureMonthsClosed(shopId);

      await db
        .update(shops)
        .set({ lastSyncedAt: startedAt, lastSyncError: null })
        .where(eq(shops.id, shopId));
      return { shopId, ok: true, items: itemCount, orders: orderCount };
    } catch (err) {
      const error = err instanceof Error ? err.message : String(err);
      await db.update(shops).set({ lastSyncError: error }).where(eq(shops.id, shopId));
      return { shopId, ok: false, error };
    } finally {
      await lock.query("SELECT pg_advisory_unlock(hashtext($1))", [`tallypress:sync:${shopId}`]);
    }
  } finally {
    lock.release();
  }
}

/** Syncs every active shop in turn; one failing shop never blocks the others. */
export async function syncAllShops(): Promise<SyncResult[]> {
  const active = await db.select({ id: shops.id }).from(shops).where(eq(shops.active, true));
  const results: SyncResult[] = [];
  for (const { id } of active) results.push(await syncShop(id));
  return results;
}
