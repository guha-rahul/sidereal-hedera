// SPDX-License-Identifier: Apache-2.0

import { test, expect, type Page } from "@playwright/test";

// The position riding the machine. The semantics themselves are unit-tested on
// `orreryModel`, which the world and the 2D fallback both draw from; what only a
// browser can answer is whether the world is actually wired to tau — that the
// run reaches both ends, and that the accent is out at maturity rather than
// merely dim.

import { YIELD_INVISIBLE, type WorldReadout } from "./world-readout";

type Readout = WorldReadout;

test.describe.configure({ timeout: 120_000 });

async function worldReady(page: Page) {
  await page.waitForFunction(() => Boolean(window.__siderealWorld?.()), undefined, {
    timeout: 20_000,
  });
}

/** Read once the damped run position has stopped moving. */
async function settled(page: Page): Promise<Readout> {
  const readout = await page.evaluate(async () => {
    const read = () => window.__siderealWorld?.() ?? null;
    let previous = read();
    for (let i = 0; i < 240; i++) {
      await new Promise((resolve) => requestAnimationFrame(() => resolve(null)));
      const now = read();
      if (previous && now && Math.abs(now.tau - previous.tau) < 0.0002) return now;
      previous = now;
    }
    return read();
  });
  expect(readout).not.toBeNull();
  return readout!;
}

async function scrollTo(page: Page, y: number) {
  await page.evaluate((to) => window.scrollTo(0, to), y);
  await page.waitForFunction((to) => Math.abs(window.scrollY - to) <= 2, y, { timeout: 8000 });
  return settled(page);
}

async function bottom(page: Page) {
  for (let i = 0; i < 6; i++) {
    await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
    await page.waitForTimeout(220);
  }
  return page.evaluate(() => document.documentElement.scrollHeight - window.innerHeight);
}

test("the run is whole at issuance and spent at maturity", async ({ page }) => {
  await page.goto("/");
  await worldReady(page);

  const start = await settled(page);
  expect(start.tau).toBeCloseTo(0, 2);
  // One position, not yet resolved, and the yield ahead of it entirely intact.
  expect(start.separation).toBe(0);
  expect(start.ytLife).toBe(1);

  await bottom(page);
  const end = await settled(page);
  expect(end.tau).toBeCloseTo(1, 2);
  expect(end.separation).toBeCloseTo(1, 3);
  // The accent goes out. Not dim — out: below the threshold at which the body
  // is drawn at all. It cannot be asserted as exactly zero here, because the
  // run position the world reads is damped and settles just short of 1; the
  // model's own end is pinned exactly, in the unit tests.
  expect(end.ytLife).toBeLessThan(YIELD_INVISIBLE);
});

test("the legs resolve once and the yield only ever spends", async ({ page }) => {
  await page.goto("/");
  await worldReady(page);
  const max = await bottom(page);
  await scrollTo(page, 0);

  let separation = -1;
  let life = 2;
  for (const fraction of [0, 0.2, 0.4, 0.6, 0.8]) {
    const r = await scrollTo(page, Math.round(max * fraction));
    expect(r.separation).toBeGreaterThanOrEqual(separation - 0.001);
    expect(r.ytLife).toBeLessThanOrEqual(life + 0.001);
    separation = r.separation;
    life = r.ytLife;
  }

  // Mid-run the yield leg is both resolved and alive — that is the window the
  // accent exists to mark.
  const middle = await scrollTo(page, Math.round(max * 0.5));
  expect(middle.separation).toBeGreaterThan(0.5);
  expect(middle.ytLife).toBeGreaterThan(0.5);
});
