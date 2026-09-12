// SPDX-License-Identifier: Apache-2.0

import { test, expect, type Page } from "@playwright/test";
import "./world-readout";

// The near plane. Two claims worth guarding, because both are easy to break by
// accident: that it really is above the page's content in the stacking order —
// otherwise it is just more backdrop — and that being above the content costs
// the reader nothing, because it never takes a pointer event.

test.describe.configure({ timeout: 120_000 });

const near = (page: Page) => page.locator("canvas[data-layer='foreground']");

async function worldReady(page: Page) {
  await page.waitForFunction(() => Boolean(window.__siderealWorld?.()), undefined, {
    timeout: 20_000,
  });
}

async function scrollToChapter(page: Page, index: number) {
  for (let i = 0; i < 6; i++) {
    await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
    await page.waitForTimeout(200);
  }
  const target = await page.evaluate((i) => {
    const sections = document.querySelectorAll<HTMLElement>("[data-chapter]");
    const el = sections[i];
    if (!el) return 0;
    const rect = el.getBoundingClientRect();
    return Math.round(rect.top + window.scrollY + rect.height / 2 - window.innerHeight / 2);
  }, index);
  await page.evaluate((y) => window.scrollTo(0, y), target);
  await page.waitForFunction((y) => Math.abs(window.scrollY - y) <= 2, target, { timeout: 8000 });
  // Wait for the damped value to converge rather than for a fixed duration.
  // Under a loaded machine the world's frames are starved, so wall-clock time
  // says nothing about whether the ledger value has arrived yet.
  await page.evaluate(async () => {
    const read = () => window.__siderealWorld?.()?.near ?? null;
    let previous = read();
    for (let i = 0; i < 240; i++) {
      await new Promise((resolve) => requestAnimationFrame(() => resolve(null)));
      const now = read();
      if (previous !== null && now !== null && Math.abs(now - previous) < 0.0005) return;
      previous = now;
    }
  });
}

test("the near plane is above the content and takes no pointer events", async ({ page }) => {
  await page.goto("/");
  await worldReady(page);

  const canvas = near(page);
  await expect(canvas).toHaveCSS("pointer-events", "none");
  await expect(canvas).toHaveCSS("z-index", "40");

  // Above the page's content, below the reader's own furniture.
  const order = await page.evaluate(() => {
    const value = (selector: string) => {
      const el = document.querySelector(selector);
      return el ? parseInt(getComputedStyle(el).zIndex || "0", 10) : Number.NaN;
    };
    return { content: value("main > div.relative"), foreground: 40, nav: value("header") };
  });
  expect(order.foreground).toBeGreaterThan(order.content);
  expect(order.nav).toBeGreaterThan(order.foreground);

  // The decisive check: what the browser thinks is under the cursor at the
  // middle of the frame is never the near plane, however much of it is drawn
  // there. If this fails the world has started eating clicks.
  const hit = await page.evaluate(() => {
    const el = document.elementFromPoint(window.innerWidth / 2, window.innerHeight / 2);
    return el ? (el as HTMLElement).dataset.layer ?? el.tagName : null;
  });
  expect(hit).not.toBe("foreground");
});

test("the near plane comes and goes with the chapter", async ({ page }) => {
  await page.goto("/");
  await worldReady(page);

  // Read what the renderer was actually handed rather than trying to infer it
  // from pixels: the pieces are dark, thin and few, so a screenshot of the
  // layer barely differs in size between empty and drawn, and a test that
  // cannot tell the two apart is not testing anything.
  const value = async () => (await page.evaluate(() => window.__siderealWorld?.() ?? null))?.near;

  await scrollToChapter(page, 0);
  // Chapter 0 is the clean establishing frame: nothing crosses the lens.
  expect(await value()).toBeLessThan(0.05);

  await scrollToChapter(page, 2);
  // Chapter 2's authored change is "structure passes the near plane on both
  // sides", and it is the only chapter that goes to full.
  expect(await value()).toBeGreaterThan(0.9);

  await scrollToChapter(page, 4);
  // And it stands down again rather than staying for the rest of the run.
  expect(await value()).toBeLessThan(0.4);
});

test("reduced motion leaves the near plane blank", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("/");
  await page.waitForFunction(() => document.documentElement.style.getPropertyValue("--tau"));
  await page.waitForTimeout(2000);

  // The world never starts, so nothing was ever drawn here — and three.js was
  // never fetched to draw it with.
  const started = await page.evaluate(() => Boolean(window.__siderealWorld));
  expect(started).toBe(false);
  await expect(near(page)).toHaveCSS("pointer-events", "none");
});
