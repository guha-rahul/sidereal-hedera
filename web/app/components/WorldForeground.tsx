// SPDX-License-Identifier: Apache-2.0

"use client";

import { useEffect, useRef } from "react";
import { setForegroundCanvas } from "@/lib/world/canvases";

// The near plane's surface. It has to be mounted here, as a sibling of the
// content, because a canvas nested inside Atmosphere is trapped in Atmosphere's
// stacking context at z-0 and can never paint over the copy.
//
// z-40 puts it above the page's content and below the nav and the rail — the
// reader's own furniture stays on top of the world, which is the right order.
// It never takes pointer events; nothing in it is interactive.
export function WorldForeground() {
  const ref = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    setForegroundCanvas(ref.current);
    return () => setForegroundCanvas(null);
  }, []);

  return (
    <canvas
      ref={ref}
      aria-hidden
      data-layer="foreground"
      className="pointer-events-none fixed inset-0 z-40 h-full w-full"
    />
  );
}
