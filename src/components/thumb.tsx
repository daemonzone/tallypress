"use client";

import { useState } from "react";
import { Icon } from "./icons";

/** WordPress makes a 150x150 copy of every upload ("name.jpg" -> "name-150x150.jpg"): ~15x lighter. */
export function thumbUrl(src: string): string {
  return /-\d+x\d+\.[a-z0-9]+$/i.test(src) ? src : src.replace(/(\.[a-z0-9]+)$/i, "-150x150$1");
}

/**
 * Product photo thumbnail. Tries the small copy first, falls back to the original photo if that
 * copy does not exist, and to a quiet placeholder when there is no photo at all.
 */
export function Thumb({ src, alt }: { src: string | null; alt: string }) {
  const [stage, setStage] = useState<"thumb" | "full" | "none">(src ? "thumb" : "none");
  const box = "h-11 w-11 shrink-0 rounded-lg bg-surface-2";

  if (!src || stage === "none") {
    return (
      <span className={`${box} flex items-center justify-center text-muted`} aria-hidden="true">
        <Icon name="box" className="h-5 w-5" />
      </span>
    );
  }
  return (
    // eslint-disable-next-line @next/next/no-img-element -- remote shop photos, tiny and lazy
    <img
      src={stage === "thumb" ? thumbUrl(src) : src}
      alt={alt}
      width={44}
      height={44}
      loading="lazy"
      decoding="async"
      onError={() => setStage(stage === "thumb" ? "full" : "none")}
      className={`${box} object-cover`}
    />
  );
}
