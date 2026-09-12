// SPDX-License-Identifier: Apache-2.0

"use client";

import { useEffect, useState } from "react";

/** Whether the 3D world has drawn and taken over from the 2D poster.
 *
 *  The Canvas 2D orrery is the first thing on screen and the permanent answer
 *  for reduced motion, a missing WebGL context, and the low tier. When the world
 *  does come up, the poster has to stand down — two charts drawing the same run
 *  is the exact mistake this rebuild is correcting. */

let live = false;
const listeners = new Set<(value: boolean) => void>();

export function setWorldLive(value: boolean) {
  if (live === value) return;
  live = value;
  for (const listener of listeners) listener(value);
}

export function useWorldLive(): boolean {
  const [value, setValue] = useState(live);
  useEffect(() => {
    setValue(live);
    listeners.add(setValue);
    return () => {
      listeners.delete(setValue);
    };
  }, []);
  return value;
}
