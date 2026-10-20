import { pool } from "@/db";

/**
 * Runs `fn` while holding the shop's advisory lock, the same one the sync uses, so a
 * sync, a cron run and a period import never overlap. Returns { locked: false } when
 * someone else already holds it.
 */
export async function withShopLock<T>(
  shopId: string,
  fn: () => Promise<T>,
): Promise<{ locked: false } | { locked: true; value: T }> {
  const key = `tallypress:sync:${shopId}`;
  const client = await pool.connect();
  try {
    const { rows } = await client.query<{ locked: boolean }>("SELECT pg_try_advisory_lock(hashtext($1)) AS locked", [key]);
    if (!rows[0].locked) return { locked: false };
    try {
      return { locked: true, value: await fn() };
    } finally {
      await client.query("SELECT pg_advisory_unlock(hashtext($1))", [key]);
    }
  } finally {
    client.release();
  }
}
