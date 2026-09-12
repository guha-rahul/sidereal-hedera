// SPDX-License-Identifier: Apache-2.0

"use client";

import { Grain } from "@/components/Grain";
import { Scrim } from "@/components/Scrim";

// The hero's backdrop is the world.
//
// This used to be a metallic render with a liquid-warp filter over it. It was
// opaque, so the instrument's establishing shot — the whole reason the camera
// ledger opens wide and outside — was spent behind an image and never seen. A
// borrowed texture in front of the thing the page is actually about is the
// wrong trade, so the render is gone and chapter 0 is the hero.
//
// What is left is what the world cannot do for itself: a scrim to seat the
// headline, and the film grain that unifies the composite.
export function HeroBackground() {
  return (
    <div aria-hidden className="absolute inset-0">
      <Scrim side="left" />
      {/* A little extra weight at the foot so the scroll cue and the nav's
          underside both have something to sit on. */}
      <div className="pointer-events-none absolute inset-0 -z-10 bg-gradient-to-b from-ink/55 via-transparent to-ink/75" />
      <Grain className="absolute inset-0 -z-10" />
    </div>
  );
}
