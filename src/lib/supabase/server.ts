import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";

/** Supabase connection (the same project KleosHQ uses). Read at runtime, server side only. */
export function supabaseConfig(): { url: string; key: string } {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_PUBLISHABLE_KEY;
  if (!url || !key) throw new Error("SUPABASE_URL and SUPABASE_PUBLISHABLE_KEY must be set");
  return { url, key };
}

/** Supabase client bound to the request's cookies, for Server Components and Server Actions. */
export async function supabaseServer() {
  const cookieStore = await cookies();
  const { url, key } = supabaseConfig();

  return createServerClient(url, key, {
    cookies: {
      getAll() {
        return cookieStore.getAll();
      },
      setAll(cookiesToSet) {
        try {
          cookiesToSet.forEach(({ name, value, options }) => cookieStore.set(name, value, options));
        } catch {
          // Server Components cannot set cookies; the proxy refreshes the session, so this is fine to ignore.
        }
      },
    },
  });
}
