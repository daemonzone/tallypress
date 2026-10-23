"use server";

import { redirect } from "next/navigation";
import { isAllowedUser } from "./auth-policy";
import { supabaseServer } from "./supabase/server";

export type LoginState =
  | { status: "idle" }
  | { status: "invalid" | "notAllowed" | "error"; email: string }; // the email is given back so the form keeps it

export async function login(_prev: LoginState, formData: FormData): Promise<LoginState> {
  const email = String(formData.get("email") ?? "").trim();
  const password = String(formData.get("password") ?? "");
  if (!email || !password) return { status: "invalid", email };

  const supabase = await supabaseServer();
  const { data, error } = await supabase.auth.signInWithPassword({ email, password });
  if (error) return { status: error.status && error.status >= 500 ? "error" : "invalid", email };

  // A valid account is not enough: it must be allowed on this panel.
  if (!isAllowedUser(data.user)) {
    await supabase.auth.signOut();
    return { status: "notAllowed", email };
  }
  redirect("/");
}

export async function logout() {
  const supabase = await supabaseServer();
  await supabase.auth.signOut();
  redirect("/login");
}
