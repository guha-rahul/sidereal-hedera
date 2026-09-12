// SPDX-License-Identifier: Apache-2.0

"use client";

/** Where the foreground canvas is.
 *
 *  The world needs two surfaces in two different places in the document: the
 *  scene behind the page's content, and the near plane in front of it. Only a
 *  canvas that is above the copy in the stacking order can occlude the copy, and
 *  the one inside `Atmosphere` cannot escape its own context — so the near plane
 *  is mounted by the layout instead, and handed to the runtime through here. */

let foreground: HTMLCanvasElement | null = null;

export function setForegroundCanvas(canvas: HTMLCanvasElement | null) {
  foreground = canvas;
}

export function getForegroundCanvas(): HTMLCanvasElement | null {
  return foreground;
}
