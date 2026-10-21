import type { ReactNode } from "react";

const paths: Record<string, ReactNode> = {
  grid: (
    <>
      <rect x="3" y="3" width="7" height="7" rx="1.5" />
      <rect x="14" y="3" width="7" height="7" rx="1.5" />
      <rect x="3" y="14" width="7" height="7" rx="1.5" />
      <rect x="14" y="14" width="7" height="7" rx="1.5" />
    </>
  ),
  box: (
    <>
      <path d="M21 8l-9-5-9 5v8l9 5 9-5V8z" />
      <path d="M3 8l9 5 9-5M12 13v8" />
    </>
  ),
  book: (
    <>
      <path d="M4 5a2 2 0 012-2h13v15H6a2 2 0 00-2 2V5z" />
      <path d="M4 20a2 2 0 012-2h13v3H6a2 2 0 01-2-1z" />
    </>
  ),
  sliders: (
    <>
      <path d="M4 7h9M19 7h1M4 17h1M11 17h9" />
      <circle cx="16" cy="7" r="2.5" />
      <circle cx="8" cy="17" r="2.5" />
    </>
  ),
  bag: (
    <>
      <path d="M6 8h12l1 12H5L6 8z" />
      <path d="M9 8V7a3 3 0 016 0v1" />
    </>
  ),
  wallet: (
    <>
      <path d="M3 7a2 2 0 012-2h13v4" />
      <path d="M3 7v11a2 2 0 002 2h16V9H5a2 2 0 01-2-2z" />
      <circle cx="17" cy="14.5" r="1" />
    </>
  ),
  trend: (
    <>
      <path d="M3 17l6-6 4 4 8-8" />
      <path d="M15 7h6v6" />
    </>
  ),
  shield: <path d="M12 3l8 3v6c0 5-3.5 8-8 9-4.5-1-8-4-8-9V6l8-3z" />,
  lock: (
    <>
      <rect x="5" y="11" width="14" height="9" rx="2" />
      <path d="M8 11V8a4 4 0 018 0v3" />
    </>
  ),
  sync: (
    <>
      <path d="M20 11a8 8 0 00-14-4L4 9" />
      <path d="M4 4v5h5M4 13a8 8 0 0014 4l2-2" />
      <path d="M20 20v-5h-5" />
    </>
  ),
  info: (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 11v5M12 8h.01" />
    </>
  ),
  search: (
    <>
      <circle cx="11" cy="11" r="7" />
      <path d="M20 20l-3.5-3.5" />
    </>
  ),
  phone: (
    <>
      <rect x="7" y="2.5" width="10" height="19" rx="2.5" />
      <path d="M11 18.5h2" />
    </>
  ),
  globe: (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="M3 12h18M12 3c2.8 2.6 4 5.6 4 9s-1.2 6.4-4 9c-2.8-2.6-4-5.6-4-9s1.2-6.4 4-9z" />
    </>
  ),
  card: (
    <>
      <rect x="3" y="5.5" width="18" height="13" rx="2.5" />
      <path d="M3 10h18M7 15h3" />
    </>
  ),
  bank: (
    <>
      <path d="M3 9l9-5 9 5H3z" />
      <path d="M5.5 9v8M10 9v8M14 9v8M18.5 9v8M3.5 20h17" />
    </>
  ),
  pencil: (
    <>
      <path d="M4 20l1-4L16.5 4.5a2 2 0 013 3L8 19l-4 1z" />
      <path d="M14.5 6.5l3 3" />
    </>
  ),
  link: (
    <>
      <path d="M10 14a4 4 0 005.7 0l3-3a4 4 0 00-5.7-5.7l-1 1" />
      <path d="M14 10a4 4 0 00-5.7 0l-3 3A4 4 0 0011 18.7l1-1" />
    </>
  ),
  cursor: <path d="M5 3l14 7-6 2-2 6L5 3z" />,
  camera: (
    <>
      <rect x="3" y="6" width="18" height="14" rx="3" />
      <circle cx="12" cy="13" r="3.5" />
      <path d="M8.5 6l1-2h5l1 2" />
    </>
  ),
  chevron: <path d="M6 9l6 6 6-6" />,
  alert: (
    <>
      <path d="M12 3l10 18H2L12 3z" />
      <path d="M12 10v5M12 18h.01" />
    </>
  ),
};

export type IconName = keyof typeof paths;

export function Icon({ name, className = "h-4 w-4" }: { name: IconName; className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      className={className}
    >
      {paths[name]}
    </svg>
  );
}
