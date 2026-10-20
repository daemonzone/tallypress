/**
 * The Tallypress mark: four tally strokes crossed by the fifth, the way tallies are
 * counted, on a rounded tile. The wordmark pairs a bold "Tally" with a lighter "press".
 */
export function LogoMark({ size = 36 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" aria-hidden="true" className="shrink-0">
      <defs>
        <linearGradient id="tp-logo" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#3987e5" />
          <stop offset="1" stopColor="#184f95" />
        </linearGradient>
      </defs>
      <rect width="32" height="32" rx="8" fill="url(#tp-logo)" />
      <path d="M9 8v16M14 8v16M19 8v16M24 8v16" stroke="#fff" strokeWidth="2.3" strokeLinecap="round" fill="none" />
      <path d="M5.5 21.5L26.5 10.5" stroke="#eda100" strokeWidth="2.6" strokeLinecap="round" />
    </svg>
  );
}

export function Logo({ name }: { name: string }) {
  const split = name.toLowerCase().indexOf("press");
  const head = split > 0 ? name.slice(0, split) : name;
  const tail = split > 0 ? name.slice(split) : "";
  return (
    <span className="flex items-center gap-2.5">
      <LogoMark />
      <span className="text-xl tracking-tight">
        <span className="font-bold">{head}</span>
        <span className="font-light opacity-70">{tail}</span>
      </span>
    </span>
  );
}
