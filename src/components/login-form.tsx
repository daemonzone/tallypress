"use client";

import { useActionState } from "react";
import type { LoginState } from "@/lib/auth-actions";
import { inputClass, primaryButtonClass } from "./ui";

interface Props {
  action: (prev: LoginState, formData: FormData) => Promise<LoginState>;
  labels: {
    email: string;
    password: string;
    submit: string;
    signingIn: string;
    invalid: string;
    notAllowed: string;
    error: string;
  };
}

export function LoginForm({ action, labels }: Props) {
  const [state, formAction, pending] = useActionState(action, { status: "idle" } as LoginState);
  const message = state.status === "invalid" ? labels.invalid : state.status === "notAllowed" ? labels.notAllowed : state.status === "error" ? labels.error : null;

  return (
    <form action={formAction} className="flex flex-col gap-4">
      <label className="flex flex-col gap-1 text-sm">
        {labels.email}
        <input name="email" type="email" autoComplete="username" required autoFocus defaultValue={state.status === "idle" ? "" : state.email} className={inputClass} />
      </label>
      <label className="flex flex-col gap-1 text-sm">
        {labels.password}
        <input name="password" type="password" autoComplete="current-password" required className={inputClass} />
      </label>
      {message && (
        <p role="alert" className="rounded-lg border border-[var(--warn-line)] bg-[var(--warn-bg)] px-3 py-2 text-sm">
          {message}
        </p>
      )}
      <button type="submit" disabled={pending} className={`${primaryButtonClass} w-full justify-center disabled:opacity-60`}>
        {pending ? labels.signingIn : labels.submit}
      </button>
    </form>
  );
}
