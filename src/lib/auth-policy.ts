// Who may use the panel. Authentication (Supabase) only says who someone is; the Supabase project is
// shared with other apps, so being a user there is not enough: the email must be on the allow-list.
// Kept free of server-only imports so the proxy can use it too.

export interface AuthUserLike {
  email?: string | null;
  email_confirmed_at?: string | null;
}

/** The emails listed in ALLOWED_EMAILS (comma-separated, case-insensitive). */
export function allowedEmails(): Set<string> {
  return new Set(
    (process.env.ALLOWED_EMAILS ?? "")
      .split(",")
      .map((e) => e.trim().toLowerCase())
      .filter(Boolean),
  );
}

/** Deny by default: a confirmed email on the allow-list, nobody otherwise. */
export function isAllowedUser(user: AuthUserLike | null | undefined): boolean {
  if (!user?.email || !user.email_confirmed_at) return false;
  return allowedEmails().has(user.email.toLowerCase());
}
