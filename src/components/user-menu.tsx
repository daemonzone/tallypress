import { Icon } from "./icons";

/** The signed-in user in the header: initial, email and a sign-out button, in a pill like the language switch. */
export function UserMenu({ email, label, action }: { email: string; label: string; action: () => Promise<void> }) {
  return (
    <form action={action} className="inline-flex items-center gap-2 rounded-full border border-line bg-surface p-0.5 shadow-sm">
      <span
        aria-hidden="true"
        className="grid h-7 w-7 shrink-0 place-items-center rounded-full bg-accent-soft text-xs font-semibold uppercase text-accent"
      >
        {email.charAt(0)}
      </span>
      <span className="hidden max-w-44 truncate text-xs text-muted md:inline" title={email}>
        {email}
      </span>
      <button
        type="submit"
        title={label}
        aria-label={label}
        className="grid h-7 w-7 shrink-0 place-items-center rounded-full text-muted transition hover:bg-surface-2 hover:text-ink"
      >
        <Icon name="logout" />
      </button>
    </form>
  );
}
