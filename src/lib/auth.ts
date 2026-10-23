import "server-only";
import { cache } from "react";
import { isAllowedUser } from "./auth-policy";
import { supabaseServer } from "./supabase/server";

export interface AuthUser {
  id: string;
  email: string;
}

/** The signed-in user if allowed to use the panel, otherwise null. Checked once per request. */
export const currentUser = cache(async (): Promise<AuthUser | null> => {
  const supabase = await supabaseServer();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  return user && isAllowedUser(user) ? { id: user.id, email: user.email! } : null;
});
