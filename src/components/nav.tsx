"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Icon, type IconName } from "./icons";

export function Nav({ links }: { links: { href: string; label: string; icon: IconName }[] }) {
  const pathname = usePathname();
  return (
    <nav className="flex gap-1 rounded-full border border-line bg-surface p-1 text-sm shadow-sm">
      {links.map((l) => {
        const active = l.href === "/" ? pathname === "/" || pathname.startsWith("/month") : pathname.startsWith(l.href);
        return (
          <Link
            key={l.href}
            href={l.href}
            aria-current={active ? "page" : undefined}
            className={`flex items-center gap-1.5 rounded-full px-3 py-1.5 font-medium transition ${
              active ? "bg-accent text-accent-ink" : "text-muted hover:bg-surface-2 hover:text-ink"
            }`}
          >
            <Icon name={l.icon} />
            <span className="hidden sm:inline">{l.label}</span>
          </Link>
        );
      })}
    </nav>
  );
}
