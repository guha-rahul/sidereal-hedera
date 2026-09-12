// SPDX-License-Identifier: Apache-2.0

"use client";

import { useEffect, useRef, useState } from "react";
import { chapterLabel, railPosition } from "@/lib/chapters";
import { scrollToChapter } from "@/lib/conductor";
import { useConductor } from "@/lib/useConductor";

// Where the reader is in the run, and a way to travel it. The rail is an
// instrument, so unlike the chart behind it, it does not lag: the fill reads
// --tau straight off the root element in CSS, and the active tick reads the
// conductor's exact chapter rather than its damped one. A rail that settles
// into place a beat after the reader arrives is just wrong.
//
// Desktop only. On a phone it would sit under the thumb for no benefit, and the
// page is short enough there to hold in the head.

type Chapter = { slug: string; label: string };

export function MaturityRail() {
  const [chapters, setChapters] = useState<Chapter[]>([]);
  const [active, setActive] = useState(0);
  const activeRef = useRef(0);

  // Read the chapters from the same attribute the conductor measures, so a
  // chapter is still added by adding the attribute and nothing else.
  useEffect(() => {
    const sections = Array.from(document.querySelectorAll<HTMLElement>("[data-chapter]"));
    setChapters(
      sections.map((el) => {
        const slug = el.dataset.chapter ?? "";
        return { slug, label: chapterLabel(slug, el.dataset.chapterLabel) };
      }),
    );
  }, []);

  useConductor((f) => {
    if (f.chapter === activeRef.current) return;
    activeRef.current = f.chapter;
    setActive(f.chapter);
  });

  if (chapters.length < 2) return null;

  return (
    <nav
      aria-label="Chapters"
      className="fixed right-6 top-1/2 z-40 hidden -translate-y-1/2 lg:block"
    >
      <div className="relative h-[220px] w-px bg-white/15">
        {/* Time elapsed against the run. Pure CSS off the conductor's variable —
            no subscription, no per-frame work in React. */}
        <div
          className="absolute left-0 top-0 w-px bg-paper/70"
          style={{ height: "calc(var(--tau, 0) * 100%)" }}
        />

        {chapters.map((chapter, i) => {
          const current = i === active;
          return (
            <button
              key={chapter.slug}
              type="button"
              onClick={() => scrollToChapter(i)}
              aria-current={current ? "true" : undefined}
              className="group absolute right-0 flex -translate-y-1/2 items-center gap-3 py-2 pl-6 focus:outline-none"
              style={{ top: `${railPosition(i, chapters.length) * 100}%` }}
            >
              {/* Asked for, not offered: the tick carries the state, and a
                  label parked over the page permanently would be one more
                  thing competing with the content. Solid ink behind it because
                  it can be summoned over a white diagram. */}
              <span className="label-data whitespace-nowrap bg-ink px-2 py-1 opacity-0 transition-opacity duration-300 group-hover:opacity-100 group-focus-visible:opacity-100">
                {chapter.label}
              </span>
              <span
                className={`block h-px transition-all duration-500 group-hover:bg-paper group-focus-visible:bg-paper ${
                  current ? "w-5 bg-paper" : "w-2 bg-white/30"
                }`}
              />
            </button>
          );
        })}
      </div>
    </nav>
  );
}
