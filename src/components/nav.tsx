"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

export function Nav({ links }: { links: { href: string; label: string }[] }) {
  const pathname = usePathname();
  return (
    <nav className="flex gap-4 text-sm">
      {links.map((l) => {
        const active = l.href === "/" ? pathname === "/" || pathname.startsWith("/month") : pathname.startsWith(l.href);
        return (
          <Link
            key={l.href}
            href={l.href}
            aria-current={active ? "page" : undefined}
            className={active ? "font-semibold underline underline-offset-4" : "opacity-70 hover:opacity-100"}
          >
            {l.label}
          </Link>
        );
      })}
    </nav>
  );
}
