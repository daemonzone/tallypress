import type { ReactNode } from "react";
import { Icon, type IconName } from "./icons";

/** A small rounded chip holding a glyph or a monogram, with the full name as tooltip and for screen readers. */
function Chip({ name, children, muted = false }: { name: string; children: ReactNode; muted?: boolean }) {
  return (
    <span
      title={name}
      className={`inline-flex h-6 min-w-6 items-center justify-center rounded-md border border-line bg-surface-2 px-1.5 text-[11px] font-bold leading-none ${
        muted ? "text-muted" : ""
      }`}
    >
      {children}
      <span className="sr-only">{name}</span>
    </span>
  );
}

const glyph = (name: IconName) => <Icon name={name} className="h-3.5 w-3.5" />;

/** How the order was paid, as an icon: the service where there is one, otherwise a card or a bank. */
export function PaymentIcon({ code, name, detail }: { code: string | null; name: string; detail?: string | null }) {
  const title = detail ? `${name} · ${detail}` : name;
  if (!code) return <Chip name={title} muted>{glyph("pencil")}</Chip>;
  if (code === "ppcp-gateway") return <Chip name={title}>P</Chip>;
  if (code === "klarna_payments") return <Chip name={title}>K</Chip>;
  if (code === "satispay" || code === "stripe_satispay") return <Chip name={title}>S</Chip>;
  if (code === "stripe_applepay") return <Chip name={title}> Pay</Chip>;
  if (code === "stripe_sepa" || code === "bacs") return <Chip name={title}>{glyph("bank")}</Chip>;
  return <Chip name={title}>{glyph("card")}</Chip>; // stripe_cc, stripe and any other card gateway
}

/** The channel the order was created through: the phone app, the website, or the admin. */
export function ChannelIcon({ via, name }: { via: string | null; name: string }) {
  if (via === "rest-api") return <Chip name={name}>{glyph("phone")}</Chip>;
  if (via === "checkout") return <Chip name={name}>{glyph("globe")}</Chip>;
  if (via === "admin") return <Chip name={name}>{glyph("sliders")}</Chip>;
  return <span className="text-muted">—</span>;
}

export type OriginKind = "instagram" | "facebook" | "google" | "direct" | "app" | "link" | "search" | "admin" | "other";

/** Reduces WooCommerce's order attribution to one of a few short origins. */
export function originOf(sourceType: string | null, utmSource: string | null): OriginKind | null {
  if (!sourceType && !utmSource) return null;
  const src = (utmSource ?? "").toLowerCase();
  if (sourceType === "mobile_app") return "app";
  if (sourceType === "admin") return "admin";
  if (src === "ig" || src.includes("instagram")) return "instagram";
  if (src === "fb" || src.includes("facebook")) return "facebook";
  if (src.includes("google")) return "google";
  if (sourceType === "typein" || src === "(direct)") return "direct";
  if (sourceType === "referral") return "link";
  if (sourceType === "organic") return "search";
  return "other";
}

const ORIGIN_GLYPH: Record<OriginKind, IconName> = {
  instagram: "camera",
  facebook: "globe",
  google: "search",
  direct: "cursor",
  app: "phone",
  link: "link",
  search: "search",
  admin: "sliders",
  other: "globe",
};

/** Where the visit came from: a small icon and one word; the detail (source, medium) is the tooltip. */
export function OriginBadge({ kind, label, detail }: { kind: OriginKind; label: string; detail: string | null }) {
  return (
    <span title={detail ? `${label} · ${detail}` : label} className="inline-flex items-center gap-1.5 whitespace-nowrap text-xs">
      <span className="text-muted">{glyph(ORIGIN_GLYPH[kind])}</span>
      {label}
    </span>
  );
}
