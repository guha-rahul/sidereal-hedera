// SPDX-License-Identifier: Apache-2.0

import { test, expect, type Page } from "@playwright/test";

// The 3D world and its hand-off with the 2D poster. What matters at this gate is
// that the world comes up, takes the chart over so the page is never showing two
// readings of the same run, and stands aside cleanly when it should not run at
// all.

const layer = (page: Page, name: "chart" | "world") =>
  page.locator(`canvas[data-layer='${name}']`);

const worldReady = (page: Page) =>
  page.waitForFunction(
    () => {
      const canvas = document.querySelector<HTMLCanvasElement>("canvas[data-layer='world']");
      return Boolean(canvas && parseFloat(getComputedStyle(canvas).opacity) > 0.9);
    },
    undefined,
    { timeout: 20_000 },
  );

test("the world comes up and takes the chart over", async ({ page }) => {
  const failures: string[] = [];
  page.on("pageerror", (error) => failures.push(String(error)));

  await page.goto("/");
  await worldReady(page);

  // A live WebGL2 context, sized to the viewport.
  const context = await layer(page, "world").evaluate((el) => {
    const canvas = el as HTMLCanvasElement;
    return {
      webgl2: Boolean(canvas.getContext("webgl2")),
      width: canvas.width,
      height: canvas.height,
    };
  });
  expect(context.webgl2).toBe(true);
  expect(context.width).toBeGreaterThan(0);
  expect(context.height).toBeGreaterThan(0);

  // The poster has stood down. Two charts drawing the same run is the mistake
  // this world replaced.
  await expect(layer(page, "chart")).toHaveCSS("opacity", "0");

  expect(failures).toEqual([]);
});

test("the world renders the instrument rather than an empty frame", async ({ page }) => {
  await page.goto("/");
  await worldReady(page);
  // Past the hero, where the world is not behind the hero's own render.
  await page.evaluate(() => window.scrollTo(0, Math.round(window.innerHeight * 1.7)));
  await page.waitForTimeout(1500);

  const shot = await layer(page, "world").screenshot();
  // A frame with geometry in it compresses to more than a flat fill does.
  expect(shot.byteLength).toBeGreaterThan(6000);
});

test("reduced motion never starts the world", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("/");
  await page.waitForFunction(() => document.documentElement.style.getPropertyValue("--tau"));
  await page.waitForTimeout(2500);

  // The world only becomes visible once it has a context and has drawn, so a
  // canvas still at zero means the dynamic import branch was never taken and
  // three.js was never fetched.
  await expect(layer(page, "world")).toHaveCSS("opacity", "0");

  // The 2D chart is the live reading instead.
  await expect(layer(page, "chart")).toHaveCSS("opacity", "1");
});

// Note: whether three.js is absent from the landing route's initial JS is a
// property of the production build, not of a running page — the dev server this
// suite boots serves one unsplit bundle, so asserting transfer sizes here would
// only ever measure the dev server. That gate is checked against `next build`
// output in the performance pass.
