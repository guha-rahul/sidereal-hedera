// SPDX-License-Identifier: Apache-2.0

"use client";

import { useRef } from "react";
import { useConductor } from "@/lib/useConductor";

// Scroll-linked parallax on the oversized step numerals (01/02/03). Each numeral
// drifts vertically as its band passes through the viewport, so the editorial
// "how it works" sections gain depth against the static copy beside them.
// Driven by the page conductor: the offset is measured in its read pass and
// written in its write pass, and it sits still under prefers-reduced-motion.
export function StepNumeral({ children }: { children: React.ReactNode }) {
  const ref = useRef<HTMLSpanElement>(null);
  const offsetRef = useRef(0);

  useConductor(
    (f) => {
      const el = ref.current;
      if (!el || f.reduced) return;
      el.style.transform = `translate3d(0, ${offsetRef.current.toFixed(2)}px, 0)`;
    },
    {
      read: (f) => {
        const el = ref.current;
        if (!el || f.reduced) return;
        const rect = el.getBoundingClientRect();
        // -0.5 (entering from the bottom) .. +0.5 (leaving at the top), 0 when
        // centered. Multiply hard so the numeral travels ~200px against its
        // column: subtle drift reads as nothing, this reads as parallax.
        const progress = (rect.top + rect.height / 2 - window.innerHeight / 2) / window.innerHeight;
        offsetRef.current = progress * -200;
      },
    },
  );

  return (
    <span
      ref={ref}
      className="block text-8xl font-light leading-none text-white/20 will-change-transform sm:text-9xl"
    >
      {children}
    </span>
  );
}
