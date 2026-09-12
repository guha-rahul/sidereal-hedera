// SPDX-License-Identifier: Apache-2.0

"use client";

import { useRef } from "react";
import { exitAlpha, exitProgress, type ExitSequence, type ExitStep } from "@/lib/heroExit";
import { useConductor } from "@/lib/useConductor";

type Item = { el: HTMLElement; step: ExitStep };

/** Dismisses the hero piece by piece as the page leaves it.
 *
 *  Children opt in with `data-exit="<name>"`, and the named entry in `sequence`
 *  says when that piece goes and how. The wrapper is `display: contents`, so it
 *  adds no box — the hero's own layout is untouched.
 *
 *  Nothing is written until the scroll actually leaves zero, and everything is
 *  handed straight back when it returns: these elements carry the page's
 *  entrance reveal, and an inline opacity sitting on them at rest would pre-empt
 *  it. Under reduced motion the hero simply scrolls away like any other
 *  content. */
export function HeroExit({
  sequence,
  distance = 0.58,
  children,
}: {
  sequence: ExitSequence;
  distance?: number;
  children: React.ReactNode;
}) {
  const rootRef = useRef<HTMLDivElement>(null);
  const itemsRef = useRef<Item[] | null>(null);
  const activeRef = useRef(false);

  useConductor((f) => {
    const root = rootRef.current;
    if (!root) return;

    if (!itemsRef.current) {
      itemsRef.current = Array.from(root.querySelectorAll<HTMLElement>("[data-exit]")).flatMap(
        (el) => {
          const step = sequence[el.dataset.exit ?? ""];
          return step ? [{ el, step }] : [];
        },
      );
    }
    const items = itemsRef.current;

    const release = () => {
      if (!activeRef.current) return;
      activeRef.current = false;
      for (const { el } of items) {
        el.style.opacity = "";
        el.style.transform = "";
        el.style.filter = "";
        el.style.pointerEvents = "";
        el.style.transition = "";
      }
    };

    if (f.reduced) {
      release();
      return;
    }

    const t = exitProgress(f.y, window.innerHeight, distance);
    if (t <= 0) {
      release();
      return;
    }
    activeRef.current = true;

    for (const { el, step } of items) {
      // These carry the reveal's own long opacity transition, which would
      // animate every value written here — the fade would then trail the scroll
      // by most of a second and stop reading as scroll-driven at all.
      el.style.transition = "none";

      const alpha = exitAlpha(step, t);
      el.style.opacity = alpha.toFixed(3);
      if (step.shift) {
        el.style.transform = `translate3d(0, ${((1 - alpha) * step.shift).toFixed(1)}px, 0)`;
      }
      if (step.blur) {
        el.style.filter = alpha > 0.999 ? "" : `blur(${((1 - alpha) * step.blur).toFixed(1)}px)`;
      }
      // A faded-out CTA must stop taking clicks, and stop being a tab stop that
      // lands the reader on something they cannot see.
      el.style.pointerEvents = alpha < 0.05 ? "none" : "";
    }
  });

  return (
    <div ref={rootRef} className="contents">
      {children}
    </div>
  );
}
