import Link from "next/link";

// Colours come from the validated palette (see globals.css). Each --viz slot is bound to
// one meaning across the app, so a colour never changes what it stands for.
export const VIZ = {
  mine: 1, // net earnings / money available: blue
  cogs: 2, // purchase cost of goods sold: orange
  vat: 3, // VAT: aqua
  tax: 4, // income tax set aside: yellow
  personal: 5, // personal share: magenta
} as const;

export interface Segment {
  key: string;
  label: string;
  value: number; // cents, must be >= 0 to be drawn
  slot: number; // --viz-N
  display: string; // formatted amount, shown in the legend
}

/**
 * Part-to-whole bar: segments are separated by a 2px surface gap, the ends are rounded,
 * and a percentage sits inside a segment only when it clearly fits. The legend below
 * always carries label, amount and share, so colour is never the only channel.
 */
export function StackedBar({
  segments,
  title,
  percent,
  compact = false,
}: {
  segments: Segment[];
  title: string;
  percent: (ratio: number) => string;
  /** One legend column, for narrow containers. */
  compact?: boolean;
}) {
  const drawn = segments.filter((s) => s.value > 0);
  const total = drawn.reduce((sum, s) => sum + s.value, 0);

  return (
    <div>
      <div
        role="img"
        aria-label={`${title}: ${segments.map((s) => `${s.label} ${s.display}`).join(", ")}`}
        className="flex h-8 w-full gap-0.5"
      >
        {total === 0 ? (
          <div className="h-full w-full rounded-md bg-surface-2" />
        ) : (
          drawn.map((s, i) => {
            const share = s.value / total;
            const round = `${i === 0 ? "rounded-l-md" : "rounded-l-[2px]"} ${i === drawn.length - 1 ? "rounded-r-md" : "rounded-r-[2px]"}`;
            return (
              <div
                key={s.key}
                title={`${s.label}: ${s.display} (${percent(share)})`}
                className={`flex h-full min-w-[3px] items-center justify-center overflow-hidden text-[11px] font-semibold ${round}`}
                style={{
                  width: `${share * 100}%`,
                  background: `var(--viz-${s.slot})`,
                  color: `var(--viz-ink-${s.slot})`,
                }}
              >
                {share >= 0.14 ? percent(share) : null}
              </div>
            );
          })
        )}
      </div>

      <ul className={`mt-3 grid gap-x-4 gap-y-1.5 text-sm ${compact ? "grid-cols-[minmax(0,1fr)]" : "grid-cols-[minmax(0,1fr)] sm:grid-cols-2"}`}>
        {segments.map((s) => (
          <li key={s.key} className="flex min-w-0 items-center gap-2">
            <span
              className="h-2.5 w-2.5 shrink-0 rounded-[3px]"
              style={{ background: `var(--viz-${s.slot})` }}
              aria-hidden="true"
            />
            <span className="min-w-0 flex-1 truncate text-muted">{s.label}</span>
            <span className="shrink-0 tabular-nums">{s.display}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

export interface Column {
  key: string;
  label: string; // axis label, e.g. "Oct 26"
  value: number; // cents (may be negative)
  display: string;
  href: string;
  selected: boolean;
}

const W = 600;
const H = 160;
const TOP = 26; // room for the value label above the tallest bar
const BOTTOM = 26; // room for the month labels

/** Rounds only the end of the bar that points away from the baseline. */
function barPath(x: number, base: number, w: number, h: number, up: boolean, r = 4): string {
  const rr = Math.min(r, h / 2, w / 2);
  if (h <= 0) return "";
  return up
    ? `M${x},${base}V${base - h + rr}a${rr},${rr} 0 0 1 ${rr},${-rr}H${x + w - rr}a${rr},${rr} 0 0 1 ${rr},${rr}V${base}Z`
    : `M${x},${base}V${base + h - rr}a${rr},${rr} 0 0 0 ${rr},${rr}H${x + w - rr}a${rr},${rr} 0 0 0 ${rr},${-rr}V${base}Z`;
}

/**
 * One series, one emphasised column: the month being viewed takes the accent colour, the
 * rest stay neutral. Columns are links to their month and carry a hover title.
 */
export function MonthColumns({ columns, title }: { columns: Column[]; title: string }) {
  const max = Math.max(...columns.map((c) => c.value), 0);
  const min = Math.min(...columns.map((c) => c.value), 0);
  const span = max - min || 1;
  const plotH = H - TOP - BOTTOM;
  const base = TOP + (max / span) * plotH; // y of the zero line
  const band = W / columns.length;
  const barW = Math.min(24, band * 0.5);
  const labelAll = columns.length <= 8;

  return (
    <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={title} className="h-auto w-full">
      <line x1="0" x2={W} y1={base} y2={base} stroke="var(--line)" strokeWidth="1" />
      {columns.map((c, i) => {
        const cx = band * i + band / 2;
        const h = (Math.abs(c.value) / span) * plotH;
        const up = c.value >= 0;
        const fill = c.selected ? "var(--viz-1)" : "var(--viz-neutral)";
        return (
          <Link key={c.key} href={c.href}>
            <g className="cursor-pointer">
              <title>{`${c.label}: ${c.display}`}</title>
              {/* generous hit area, larger than the bar itself */}
              <rect x={band * i} y="0" width={band} height={H} fill="transparent" />
              <path d={barPath(cx - barW / 2, base, barW, Math.max(h, 2), up)} fill={fill} />
              {(labelAll || c.selected) && (
                <text
                  x={cx}
                  y={up ? base - Math.max(h, 2) - 7 : base + Math.max(h, 2) + 15}
                  textAnchor="middle"
                  fontSize="12"
                  fontWeight={c.selected ? 600 : 400}
                  fill="var(--ink)"
                  className="tabular-nums"
                >
                  {c.display}
                </text>
              )}
              <text
                x={cx}
                y={H - 8}
                textAnchor="middle"
                fontSize="12"
                fill={c.selected ? "var(--ink)" : "var(--muted)"}
                fontWeight={c.selected ? 600 : 400}
              >
                {c.label}
              </text>
            </g>
          </Link>
        );
      })}
    </svg>
  );
}
