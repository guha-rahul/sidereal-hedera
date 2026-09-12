// SPDX-License-Identifier: Apache-2.0

"use client";

import { useEffect, useRef, useState } from "react";
import { StarfieldBackground } from "./StarfieldBackground";
import { clamp } from "@/lib/conductor";
import { useConductor } from "@/lib/useConductor";

// Parallax "reveal" footer: the footer is pinned to the bottom of the viewport
// behind the page content, and a spacer the height of the footer sits at the
// end of the flow. As you scroll to the bottom, the opaque content slides up off
// the fixed footer, revealing it underneath. The spacer is measured from the
// footer so the reveal is exactly one footer tall on any viewport.
//
// The reveal progress (0 hidden, 1 fully revealed) is published as a --reveal
// CSS variable on the footer; the starfield layers read it to drift at
// different speeds, so the star chart gains depth exactly while it is being
// uncovered. Defaults to 1 (settled) for no-JS, and stays settled under
// prefers-reduced-motion.
export function RevealFooter({ children }: { children: React.ReactNode }) {
  const ref = useRef<HTMLElement>(null);
  const spacerRef = useRef<HTMLDivElement>(null);
  const [height, setHeight] = useState(0);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const measure = () => setHeight(el.offsetHeight);
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // How far the spacer has been scrolled past, measured in the read pass and
  // written to --reveal in the write pass.
  const revealedRef = useRef(1);

  useConductor(
    (f) => {
      const el = ref.current;
      if (!el || f.reduced) return;
      el.style.setProperty("--reveal", revealedRef.current.toFixed(3));
    },
    {
      read: (f) => {
        const spacer = spacerRef.current;
        if (!spacer || f.reduced) return;
        const rect = spacer.getBoundingClientRect();
        revealedRef.current =
          rect.height > 0 ? clamp((window.innerHeight - rect.top) / rect.height, 0, 1) : 1;
      },
    },
  );

  return (
    <>
      {/* Reserves the scroll distance that reveals the fixed footer. */}
      <div aria-hidden ref={spacerRef} style={{ height }} />
      <footer
        ref={ref}
        className="fixed inset-x-0 bottom-0 z-0 overflow-hidden bg-carbon"
      >
        <StarfieldBackground />
        <div className="relative z-10">{children}</div>
      </footer>
    </>
  );
}
