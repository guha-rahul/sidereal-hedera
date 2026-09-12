// SPDX-License-Identifier: Apache-2.0

import { test, expect, type Page } from "@playwright/test";

// The 2D chart in its actual role: the poster the page draws first, and the
// permanent fallback for reduced motion, a missing WebGL context and the low
// device tier. Every test here forces reduced motion so the 3D world never
// starts and the chart stays the live reading — otherwise the world takes over,
// the chart stops drawing, and these assertions read a stale canvas.
//
// The unit tests cover the model. These cover what only a browser can answer:
// that it draws, that the amber accent is alive while the yield is and out at
// maturity, and that the run completes where the reader can see it.

test.beforeEach(async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
});

async function scrollTo(page: Page, y: number) {
  await page.evaluate((to) => window.scrollTo(0, to), y);
  await page.waitForFunction((to) => Math.abs(window.scrollY - to) <= 2, y, { timeout: 5000 });
  await page.waitForTimeout(400);
}

/** Count lit pixels on the chart, and how many of them are the amber accent. */
const ink = (page: Page) =>
  page.evaluate(() => {
    const canvas = document.querySelector<HTMLCanvasElement>("canvas[data-layer='chart']");
    if (!canvas) return null;
    const ctx = canvas.getContext("2d");
    if (!ctx) return null;
    const { data } = ctx.getImageData(0, 0, canvas.width, canvas.height);
    let lit = 0;
    let amber = 0;
    for (let i = 0; i < data.length; i += 4) {
      const [r, g, b, a] = [data[i]!, data[i + 1]!, data[i + 2]!, data[i + 3]!];
      if (a === 0) continue;
      lit++;
      if (r > 150 && g > 80 && g < 200 && b < 90) amber++;
    }
    return { lit, amber };
  });

/** Scroll so the last chapter — maturity — is centred in the viewport. */
async function scrollToMaturity(page: Page) {
  // Settle the layout first: the footer spacer mounts after hydration.
  for (let i = 0; i < 6; i++) {
    await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
    await page.waitForTimeout(250);
  }
  const target = await page.evaluate(() => {
    const sections = document.querySelectorAll<HTMLElement>("[data-chapter]");
    const last = sections[sections.length - 1];
    if (!last) return null;
    const rect = last.getBoundingClientRect();
    return Math.round(rect.top + window.scrollY + rect.height / 2 - window.innerHeight / 2);
  });
  expect(target).not.toBeNull();
  await scrollTo(page, target!);
  return target!;
}

test("the chart draws", async ({ page }) => {
  await page.goto("/");
  await page.waitForFunction(() => document.documentElement.style.getPropertyValue("--tau"));
  await page.waitForTimeout(400);

  const drawn = await ink(page);
  expect(drawn).not.toBeNull();
  expect(drawn!.lit).toBeGreaterThan(500);
});

test("the amber is alive while the yield is, and out at maturity", async ({ page }) => {
  await page.goto("/");
  await page.waitForFunction(() => document.documentElement.style.getPropertyValue("--tau"));

  // Issuance: one whole position, no leg to mark.
  expect((await ink(page))!.amber).toBe(0);

  // Mid-run: the yield leg exists and is the one accented thing on the page.
  await scrollToMaturity(page);
  const max = await page.evaluate(
    () => document.documentElement.scrollHeight - window.innerHeight,
  );
  await scrollTo(page, Math.round(max * 0.45));
  expect((await ink(page))!.amber).toBeGreaterThan(0);

  // Maturity: the yield is spent and the accent goes out.
  await scrollToMaturity(page);
  expect((await ink(page))!.amber).toBe(0);
});

test("the run completes on content, not behind the footer", async ({ page }) => {
  await page.goto("/");
  await page.waitForFunction(() => document.documentElement.style.getPropertyValue("--tau"));

  const completedAt = await scrollToMaturity(page);

  // The chart has landed on par by the time the last section is centred.
  const tau = await page.evaluate(() =>
    parseFloat(getComputedStyle(document.documentElement).getPropertyValue("--tau")),
  );
  expect(tau).toBeCloseTo(1, 2);

  // And it got there with scroll to spare — the page ends by revealing an
  // opaque footer from under the content, and spending the end of the run
  // inside that reveal would hide the very thing it was building to.
  const max = await page.evaluate(
    () => document.documentElement.scrollHeight - window.innerHeight,
  );
  expect(completedAt).toBeLessThan(max);
  expect(max - completedAt).toBeGreaterThan(100);
});
