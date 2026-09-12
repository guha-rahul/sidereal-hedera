// SPDX-License-Identifier: Apache-2.0

"use client";

import { useRef } from "react";
import { useConductor } from "@/lib/useConductor";

/** Scroll-linked layer for the marketing hero. `speed` is the fraction of the
 *  scroll position the layer travels (background 0.3, headline 0.12, page
 *  content 1.0), which is what separates the hero into depth planes.
 *  `fadeDistance` fades the layer out over that many scrolled pixels (the
 *  scroll cue).
 *
 *  The travel reads the conductor's damped scroll position, so a layer trails
 *  the page slightly and settles after it — that lag is the depth cue. The fade
 *  reads the exact position instead: an element on its way out should leave
 *  when the reader scrolls, not a beat later. Pass `damped={false}` to lock a
 *  layer rigidly to the scroll. */
export function Parallax({
  children,
  className,
  speed = 0,
  fadeDistance,
  damped = true,
}: {
  children: React.ReactNode;
  className?: string;
  speed?: number;
  fadeDistance?: number;
  damped?: boolean;
}) {
  const ref = useRef<HTMLDivElement>(null);

  useConductor((f) => {
    const el = ref.current;
    if (!el || f.reduced) return;
    if (speed) {
      const y = (damped ? f.ySmooth : f.y) * speed;
      el.style.transform = `translate3d(0, ${y.toFixed(2)}px, 0)`;
    }
    if (fadeDistance) el.style.opacity = Math.max(0, 1 - f.y / fadeDistance).toFixed(3);
  });

  return (
    <div ref={ref} data-parallax className={className}>
      {children}
    </div>
  );
}
