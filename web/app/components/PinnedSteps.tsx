// SPDX-License-Identifier: Apache-2.0

"use client";

import { useRef, useState } from "react";
import { Scrim } from "@/components/Scrim";
import { clamp } from "@/lib/conductor";
import { useConductor } from "@/lib/useConductor";

export type PinnedStep = { n: string; title: string; kicker: string; body: React.ReactNode };

/** Desktop "how it works": the band pins to the viewport for ~2.6 screens of
 *  scroll and one monochrome SVG scene morphs through the three protocol
 *  moments in place. Scroll position picks the phase.
 *
 *  The scene itself is the 3D world behind the band, not an SVG beside the
 *  copy — the position splitting on the instrument IS this section's diagram.
 *  The stacked sections remain the mobile and reduced-motion
 *  rendering, so this component is only mounted at lg and up. All copy for
 *  every phase stays in the DOM (inactive blocks are visually hidden), so
 *  crawlers and find-in-page still see the full text. */
export function PinnedSteps({ steps }: { steps: PinnedStep[] }) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const [phase, setPhase] = useState(1);
  // The phase last handed to React. Comparing against it keeps the write pass
  // from calling setState on frames where nothing crossed a third.
  const phaseRef = useRef(1);
  // Where the pin stands, measured in the read pass and consumed in the write
  // pass. The band's own progress is local geometry, so it cannot come off the
  // conductor's chapter clock — but the measurement still belongs in the pass
  // that owns layout reads.
  const localRef = useRef(0);

  useConductor(
    () => {
      const p = localRef.current;
      const next = p < 1 / 3 ? 1 : p < 2 / 3 ? 2 : 3;
      if (next === phaseRef.current) return;
      phaseRef.current = next;
      setPhase(next);
    },
    {
      read: () => {
        const el = wrapRef.current;
        if (!el) return;
        const total = el.offsetHeight - window.innerHeight;
        if (total <= 0) return;
        localRef.current = clamp(-el.getBoundingClientRect().top / total, 0, 1);
      },
    },
  );

  return (
    <div ref={wrapRef} className="pinned-steps relative h-[240vh]" data-phase={phase}>
      <div
        className="sticky top-0 flex h-screen items-center overflow-hidden bg-transparent"
      >
          {/* The band used to darken to carbon on the split phase. It is pinned
            over the instrument now, so it holds its copy with a scrim instead
            of shuttering the frame the split is happening in. */}
        <Scrim side="left" />
        {/* One column, holding the left half. The right half is the world: the
            band used to carry an SVG of the split beside the copy, which is a
            flat drawing of the mechanism the camera is now flying through. */}
        <div className="relative mx-auto grid w-full max-w-[1440px] items-center px-6 sm:px-16 lg:grid-cols-2">
          {/* Copy: all three blocks stacked, the active one visible. The step
              owns a full pinned viewport, so everything is set at display
              scale: the numeral as a watermark behind a display-size title. */}
          <div className="relative">
            {steps.map((step, i) => {
              const active = phase === i + 1;
              return (
                <div
                  key={step.n}
                  aria-hidden={!active}
                  className={`transition-all duration-700 ease-out ${
                    i > 0 ? "absolute inset-0" : ""
                  } ${active ? "opacity-100 translate-y-0" : "pointer-events-none opacity-0 translate-y-4"}`}
                >
                  <span className="block text-9xl font-light leading-none text-white/15 lg:text-[13rem]">
                    {step.n}
                  </span>
                  <h2 className="mt-6 text-5xl font-light tracking-tight lg:-mt-10 lg:text-7xl">
                    {step.title}
                  </h2>
                  <p className="mt-4 label-data">{step.kicker}</p>
                  <p className="mt-8 max-w-xl text-lg leading-relaxed text-smoke lg:text-xl">
                    {step.body}
                  </p>
                </div>
              );
            })}

            {/* Phase rail: which of the three moments is pinned. */}
            <div className="mt-12 flex items-center gap-2">
              {steps.map((step, i) => (
                <span
                  key={step.n}
                  className={`h-px transition-all duration-500 ${
                    phase === i + 1 ? "w-14 bg-paper" : "w-6 bg-white/25"
                  }`}
                />
              ))}
            </div>
          </div>

        </div>
      </div>
    </div>
  );
}
