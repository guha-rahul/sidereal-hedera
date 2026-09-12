// SPDX-License-Identifier: Apache-2.0

import { test, expect, type Page } from "@playwright/test";

// The camera rig. A screenshot can show whether one composition reads; only a
// sampled route can show whether the travel between them is sound. These walk
// the whole page forward and back, reading the rig's own position each step.
//
// The failure this is really guarding against is a Catmull-Rom overshoot: the
// spline can bulge outside its control points on a tight direction change and
// fly the camera through a ring, and that is invisible in any single frame.

import type { WorldReadout } from "./world-readout";

type Readout = WorldReadout;

async function worldReady(page: Page) {
  await page.waitForFunction(() => Boolean(window.__siderealWorld?.()), undefined, {
    timeout: 20_000,
  });
}

async function settle(page: Page) {
  for (let i = 0; i < 6; i++) {
    await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
    await page.waitForTimeout(220);
  }
  return page.evaluate(() => document.documentElement.scrollHeight - window.innerHeight);
}

/** Read the rig once it has stopped moving.
 *
 *  Waiting a fixed number of milliseconds does not work here: the camera is on
 *  the conductor's damped channel, and when the whole suite runs in parallel
 *  every worker is driving its own WebGL scene, so frames are starved and the
 *  damping takes wall-clock time that has nothing to do with the rig. Wait for
 *  convergence, which is the thing actually being waited on. */
async function readSettled(page: Page): Promise<Readout> {
  const readout = await page.evaluate(async () => {
    const read = () => window.__siderealWorld?.() ?? null;
    let previous = read();
    for (let i = 0; i < 240; i++) {
      await new Promise((resolve) => requestAnimationFrame(() => resolve(null)));
      const now = read();
      if (previous && now) {
        const moved = Math.hypot(
          now.px - previous.px,
          now.py - previous.py,
          now.pz - previous.pz,
        );
        if (moved < 0.004) return now;
      }
      previous = now;
    }
    return read();
  });
  expect(readout).not.toBeNull();
  return readout!;
}

/** Walk the page and read the rig at each stop. */
async function walk(page: Page, positions: number[]): Promise<Readout[]> {
  const out: Readout[] = [];
  for (const y of positions) {
    await page.evaluate((to) => window.scrollTo(0, to), y);
    // Lenis eases a programmatic jump over more than a second, so wait for the
    // position to land before reading — otherwise a reverse walk samples
    // mid-flight and disagrees with the forward one for reasons having nothing
    // to do with the rig.
    await page.waitForFunction((to) => Math.abs(window.scrollY - to) <= 2, y, { timeout: 8000 });
    out.push(await readSettled(page));
  }
  return out;
}

// These walk the page a stop at a time and wait for Lenis to land each jump,
// so they are inherently minute-scale, not second-scale — and slower still when
// the rest of the suite is driving its own WebGL contexts on the same machine.
// The default per-test budget was never going to fit them.
test.describe.configure({ timeout: 150_000 });

const distance = (a: Readout, b: Readout) =>
  Math.hypot(a.px - b.px, a.py - b.py, a.pz - b.pz);

test.describe("desktop", () => {
  test.skip(({ viewport }) => (viewport?.width ?? 0) < 1024, "sampled on desktop only");

  test("the rig travels the whole instrument without a seam", async ({ page }) => {
    await page.goto("/");
    await worldReady(page);
    const max = await settle(page);

    const steps = Array.from({ length: 15 }, (_, i) => Math.round((max * i) / 14));
    const forward = await walk(page, steps);

    // It actually goes somewhere: the establishing shot and the last frame are
    // not the same composition.
    const travelled = distance(forward[0]!, forward[forward.length - 1]!);
    expect(travelled).toBeGreaterThan(8);

    // And it gets there continuously. Equal scroll steps are deliberately not
    // equal camera travel — chapters are anchored to their sections, so a short
    // section covers more of the route per pixel — which rules out comparing a
    // hop to the median. What a real discontinuity looks like instead is one
    // step swallowing a large share of the entire route.
    const hops = forward.slice(1).map((r, i) => distance(forward[i]!, r));
    const path = hops.reduce((sum, hop) => sum + hop, 0);
    expect(Math.max(...hops)).toBeLessThan(path * 0.3);

    // The rig never leaves the room, and never ends up inside the hub.
    for (const r of forward) {
      const fromCentre = Math.hypot(r.px, r.py, r.pz);
      expect(fromCentre).toBeLessThan(60);
      expect(fromCentre).toBeGreaterThan(1.5);
      expect(r.fov).toBeGreaterThan(20);
      expect(r.fov).toBeLessThan(90);
    }
  });

  test("reverse retraces the same route", async ({ page }) => {
    await page.goto("/");
    await worldReady(page);
    const max = await settle(page);

    const steps = [0, 0.25, 0.5, 0.75, 1].map((f) => Math.round(max * f));
    const down = await walk(page, steps);
    const up = await walk(page, [...steps].reverse());
    up.reverse();

    // Scroll is the only input to the route, so the same position must hand
    // back the same frame whichever direction it was reached from. If this
    // fails, something in the rig is integrating instead of reading.
    for (let i = 0; i < steps.length; i++) {
      expect(distance(down[i]!, up[i]!)).toBeLessThan(0.6);
      expect(Math.abs(down[i]!.fov - up[i]!.fov)).toBeLessThan(0.6);
    }
  });
});

/** Resize, then wait for the rig to have actually composed for the new frame.
 *  Reading straight after a resize catches the rig before its observer has
 *  fired, and `readSettled` happily reports the old frame as settled because
 *  nothing has started moving yet. */
async function resizeAndRead(page: Page, width: number, height: number): Promise<Readout> {
  await page.setViewportSize({ width, height });
  await page.waitForFunction((w) => (window.__siderealWorld?.()?.w ?? 0) === w, width, {
    timeout: 8000,
  });
  return readSettled(page);
}

test("a tall viewport pulls back rather than cropping", async ({ page }) => {
  await page.setViewportSize({ width: 1600, height: 900 });
  await page.goto("/");
  await worldReady(page);

  const wide = await resizeAndRead(page, 1600, 900);
  const square = await resizeAndRead(page, 900, 900);

  // Same waypoint, tall frame: the rig steps back along its own view axis and
  // opens the lens, rather than letting the sides of the instrument fall away.
  const squareDistance = Math.hypot(
    square.px - square.tx,
    square.py - square.ty,
    square.pz - square.tz,
  );
  const wideDistance = Math.hypot(wide.px - wide.tx, wide.py - wide.ty, wide.pz - wide.tz);
  expect(squareDistance).toBeGreaterThan(wideDistance + 1);
  expect(square.fov).toBeGreaterThan(wide.fov + 1);
});
