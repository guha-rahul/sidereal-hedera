// SPDX-License-Identifier: Apache-2.0

import { test, expect, type Page } from "@playwright/test";

// The scroll conductor is the landing page's one clock: it measures the
// data-chapter sections and publishes --tau (0 at issuance, 1 at maturity) plus
// the active chapter on the root element. The unit tests cover the mapping
// arithmetic; this covers the part only a browser can answer — that the anchors
// were measured off a real layout and the variables actually move.

const tau = (page: Page) =>
  page.evaluate(() =>
    parseFloat(getComputedStyle(document.documentElement).getPropertyValue("--tau") || "NaN"),
  );

const activeChapter = (page: Page) =>
  page.evaluate(() => document.documentElement.dataset.activeChapter);

const maxScroll = (page: Page) =>
  page.evaluate(() => document.documentElement.scrollHeight - window.innerHeight);

/** Scroll, wait for the position to actually arrive, then let the conductor's
 *  damped values settle. Lenis eases a programmatic jump rather than taking it,
 *  and a long jump takes well over a second — a fixed timeout reads the page
 *  mid-flight. */
async function scrollTo(page: Page, y: number) {
  await page.evaluate((to) => window.scrollTo(0, to), y);
  await page.waitForFunction((to) => Math.abs(window.scrollY - to) <= 2, y, { timeout: 5000 });
  await page.waitForTimeout(300);
}

/** Wait for the conductor to be live, then drive the page to its true bottom.
 *  One jump is not enough: the footer spacer is measured after hydration, so
 *  the document is still growing under an early `scrollHeight` read, and Lenis
 *  clamps a jump to whatever page limit it last cached. Scroll until the
 *  position actually lands on the floor rather than assuming it did. */
async function settleAtBottom(page: Page) {
  await page.waitForFunction(() => document.documentElement.style.getPropertyValue("--tau"));
  for (let attempt = 0; attempt < 8; attempt++) {
    await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
    await page.waitForTimeout(300);
    const landed = await page.evaluate(
      () =>
        Math.abs(
          window.scrollY - (document.documentElement.scrollHeight - window.innerHeight),
        ) <= 2,
    );
    if (landed) break;
  }
  return maxScroll(page);
}

test("the conductor publishes tau across the landing page", async ({ page }) => {
  await page.goto("/");
  await page.waitForFunction(() => document.documentElement.style.getPropertyValue("--tau"));

  expect(await tau(page)).toBeCloseTo(0, 2);
  expect(await activeChapter(page)).toBe("0");

  expect(await settleAtBottom(page)).toBeGreaterThan(0);
  expect(await tau(page)).toBeCloseTo(1, 2);

  // Five sections carry data-chapter, so the last one is index four.
  expect(await activeChapter(page)).toBe("4");

  await scrollTo(page, 0);
  expect(await tau(page)).toBeCloseTo(0, 2);
  expect(await activeChapter(page)).toBe("0");
});

test("tau advances monotonically down the page", async ({ page }) => {
  await page.goto("/");

  // Settle the layout first so the sampled positions are measured against the
  // height the page actually ends up at.
  const max = await settleAtBottom(page);
  await scrollTo(page, 0);

  let previous = -1;
  for (const fraction of [0, 0.2, 0.4, 0.6, 0.8]) {
    await scrollTo(page, Math.round(max * fraction));
    const value = await tau(page);
    expect(value).toBeGreaterThanOrEqual(previous);
    previous = value;
  }

  await settleAtBottom(page);
  const end = await tau(page);
  expect(end).toBeGreaterThanOrEqual(previous);
  expect(end).toBeCloseTo(1, 2);
});

test("the hero stands down one piece at a time", async ({ page }) => {
  await page.goto("/");
  await page.waitForFunction(() => document.documentElement.style.getPropertyValue("--tau"));

  const opacities = () =>
    page.evaluate(() =>
      Object.fromEntries(
        Array.from(document.querySelectorAll<HTMLElement>("[data-exit]")).map((el) => [
          el.dataset.exit,
          parseFloat(getComputedStyle(el).opacity),
        ]),
      ),
    );

  // At rest every piece is whole and nothing has been written inline, or the
  // page's own entrance reveal would have been pre-empted.
  const atRest = await opacities();
  expect(Object.keys(atRest).sort()).toEqual(["actions", "cue", "headline", "lede"]);
  for (const value of Object.values(atRest)) expect(value).toBe(1);

  // Part way out: the cue has gone, the statement has not.
  const viewport = page.viewportSize();
  const height = viewport ? viewport.height : 720;
  await scrollTo(page, Math.round(height * 0.58 * 0.45));
  const midway = await opacities();
  expect(midway.cue).toBeLessThan(0.2);
  expect(midway.headline).toBe(1);
  expect(midway.actions).toBeLessThan(1);
  expect(midway.actions).toBeGreaterThan(midway.cue!);

  // Spent: the statement is the last thing still leaving.
  await scrollTo(page, Math.round(height * 0.58));
  const spent = await opacities();
  expect(spent.cue).toBe(0);
  expect(spent.actions).toBe(0);
  expect(spent.lede).toBe(0);
  expect(spent.headline).toBeLessThan(0.2);

  // Scrolling back hands everything over intact, styles cleared.
  await scrollTo(page, 0);
  const returned = await opacities();
  for (const value of Object.values(returned)) expect(value).toBe(1);
  const inlineStyles = await page.evaluate(() =>
    Array.from(document.querySelectorAll<HTMLElement>("[data-exit]")).map(
      (el) => el.getAttribute("style") ?? "",
    ),
  );
  for (const style of inlineStyles) expect(style).toBe("");
});

test("a faded-out call to action stops taking clicks", async ({ page }) => {
  await page.goto("/");
  await page.waitForFunction(() => document.documentElement.style.getPropertyValue("--tau"));

  const viewport = page.viewportSize();
  await scrollTo(page, Math.round((viewport ? viewport.height : 720) * 0.58));

  const pointerEvents = await page
    .locator("[data-exit='actions']")
    .evaluate((el) => getComputedStyle(el).pointerEvents);
  expect(pointerEvents).toBe("none");
});

test.describe("reduced motion", () => {
  test("the hero scrolls away untouched", async ({ page }) => {
    // Set before navigating so the conductor reads it on its first frame.
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.goto("/");
    expect(
      await page.evaluate(
        () => window.matchMedia("(prefers-reduced-motion: reduce)").matches,
      ),
    ).toBe(true);

    // tau is state, not motion, so the conductor still publishes it.
    await page.waitForFunction(() => document.documentElement.style.getPropertyValue("--tau"));

    const viewport = page.viewportSize();
    await scrollTo(page, Math.round((viewport ? viewport.height : 720) * 0.58));

    const written = await page.evaluate(() =>
      Array.from(document.querySelectorAll<HTMLElement>("[data-exit]")).map((el) => ({
        opacity: getComputedStyle(el).opacity,
        style: el.getAttribute("style") ?? "",
      })),
    );
    expect(written).toHaveLength(4);
    for (const item of written) {
      expect(item.opacity).toBe("1");
      expect(item.style).toBe("");
    }
  });
});

test("the hero copy is a damped parallax plane", async ({ page }) => {
  await page.goto("/");
  await page.waitForFunction(() => document.documentElement.style.getPropertyValue("--tau"));

  // The hero's backdrop is the 3D world now, so the parallax plane that remains
  // is the copy itself. It must move with scroll, and by less than the page
  // travelled — the lag is the depth cue.
  const hero = page.locator("section[data-chapter='issuance'] [data-parallax]").first();
  await expect(hero).toBeAttached();
  await scrollTo(page, 600);
  const shift = await hero.evaluate((el) => {
    const matrix = new DOMMatrixReadOnly(getComputedStyle(el).transform);
    return matrix.m42;
  });
  expect(shift).toBeGreaterThan(0);
  expect(shift).toBeLessThan(600);
});
