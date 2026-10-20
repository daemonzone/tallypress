import { syncAllShops } from "@/lib/sync";

// Vercel Cron calls GET with `Authorization: Bearer $CRON_SECRET`; POST is for manual/local use.
async function handle(request: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret || request.headers.get("authorization") !== `Bearer ${secret}`) {
    return new Response("Unauthorized", { status: 401 });
  }
  const results = await syncAllShops();
  return Response.json({ results }, { status: results.every((r) => r.ok) ? 200 : 207 });
}

export const GET = handle;
export const POST = handle;
