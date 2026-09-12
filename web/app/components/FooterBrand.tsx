// SPDX-License-Identifier: Apache-2.0

"use client";

import { useEffect, useRef } from "react";
import { Logo } from "./Logo";
import { clamp } from "@/lib/conductor";
import { useConductor } from "@/lib/useConductor";

// Giant "sidereal" signature that sweeps right-to-left as the revealed footer
// scrolls into view. The footer is fixed (RevealFooter), so its own rect does
// not move with scroll; instead the sweep is driven by how far the document has
// scrolled into its final footer-tall stretch. Driven by the page conductor,
// and parked at rest under prefers-reduced-motion.
export function FooterBrand() {
  const ref = useRef<HTMLDivElement>(null);
  const shiftRef = useRef(0);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      el.style.transform = "translate3d(0, 0, 0)";
    }
  }, []);

  useConductor(
    (f) => {
      const el = ref.current;
      if (!el || f.reduced) return;
      el.style.transform = `translate3d(${shiftRef.current.toFixed(2)}vw, 0, 0)`;
    },
    {
      read: (f) => {
        const el = ref.current;
        if (!el || f.reduced) return;
        const footer = el.closest("footer");
        const span = Math.max(footer ? footer.offsetHeight : window.innerHeight, 1);
        const scrolled = f.y + window.innerHeight;
        const docH = document.documentElement.scrollHeight;
        // 0 as the footer begins to reveal, 1 at the very bottom of the page.
        const progress = clamp(1 - (docH - scrolled) / span, 0, 1);
        // Enter from the right and settle fully inside the frame (0) at the
        // bottom, so the wordmark is never clipped off the left edge.
        shiftRef.current = (1 - progress) * 60;
      },
    },
  );

  return (
    <div className="overflow-hidden px-6 pb-8 pt-4 sm:px-16">
      <div
        ref={ref}
        className="flex w-max items-center gap-[2vw] whitespace-nowrap will-change-transform"
      >
        <Logo className="h-[12vw] w-[12vw] shrink-0 text-paper" />
        <span className="text-[16vw] font-light leading-none tracking-tighter text-paper">
          sidereal
        </span>
      </div>
    </div>
  );
}
