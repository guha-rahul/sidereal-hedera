// SPDX-License-Identifier: Apache-2.0

import { test, expect, type Page } from "@playwright/test";

// The maturity rail: where the reader is in the run, and a way to travel it.
// It is an instrument, so what matters is that it never lies — the tick it
// marks current has to be the chapter the reader is actually in, and a jump has
// to land on the anchor the tick stands for rather than near it.

test.describe("desktop", () => {
  test.skip(({ viewport }) => (viewport?.width ?? 0) < 1024, "the rail is desktop only");

  const rail = (page: Page) => page.getByRole("navigation", { name: "Chapters" });

  async function settle(page: Page) {
    await page.waitForFunction(() => document.documentElement.style.getPropertyValue("--tau"));
    for (let i = 0; i < 6; i++) {
      await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
      await page.waitForTimeout(250);
    }
    await page.evaluate(() => window.scrollTo(0, 0));
    await page.waitForFunction(() => window.scrollY <= 2, undefined, { timeout: 5000 });
    await page.waitForTimeout(300);
  }

  test("names one stop per chapter, in order", async ({ page }) => {
    await page.goto("/");
    await settle(page);

    // textContent, not innerText: the label style uppercases in CSS, and what
    // is being asserted here is the label the slug produced.
    const labels = await rail(page).getByRole("button").allTextContents();
    expect(labels).toEqual(["Issuance", "Split", "Mechanism", "Market", "Maturity"]);

    // The stops come from the same attribute the conductor measures.
    const declared = await page.evaluate(() =>
      Array.from(document.querySelectorAll<HTMLElement>("[data-chapter]")).map(
        (el) => el.dataset.chapter,
      ),
    );
    expect(declared).toEqual(["issuance", "split", "mechanism", "market", "maturity"]);
  });

  test("marks the chapter the reader is actually in", async ({ page }) => {
    await page.goto("/");
    await settle(page);

    const buttons = rail(page).getByRole("button");
    await expect(buttons.nth(0)).toHaveAttribute("aria-current", "true");

    // Exactly one stop is current at a time.
    await expect(rail(page).locator("[aria-current='true']")).toHaveCount(1);
  });

  test("a stop travels to the anchor it stands for", async ({ page }) => {
    await page.goto("/");
    await settle(page);

    for (const index of [2, 4, 1]) {
      await rail(page).getByRole("button").nth(index).click();
      // Lenis eases the jump, so wait for it to arrive rather than assuming.
      await page.waitForFunction(
        (i) => {
          const root = document.documentElement;
          return Math.abs(parseFloat(root.style.getPropertyValue("--tau")) * 4 - i) < 0.02;
        },
        index,
        { timeout: 6000 },
      );

      // Landing on the anchor means the rail now marks that same stop — a jump
      // that lands near it instead would leave the rail pointing elsewhere.
      await expect(rail(page).getByRole("button").nth(index)).toHaveAttribute(
        "aria-current",
        "true",
      );
      await expect(rail(page).locator("[aria-current='true']")).toHaveCount(1);
    }
  });

  test("the fill tracks the run", async ({ page }) => {
    await page.goto("/");
    await settle(page);

    const fillHeight = () =>
      rail(page)
        .locator("div > div")
        .first()
        .evaluate((el) => el.getBoundingClientRect().height);

    expect(await fillHeight()).toBeLessThan(2);

    await rail(page).getByRole("button").nth(4).click();
    await page.waitForFunction(
      () => parseFloat(document.documentElement.style.getPropertyValue("--tau")) > 0.99,
      undefined,
      { timeout: 6000 },
    );
    // The track is 220px tall; a completed run fills it.
    expect(await fillHeight()).toBeGreaterThan(210);
  });

  test("every stop is reachable by keyboard", async ({ page }) => {
    await page.goto("/");
    await settle(page);

    const first = rail(page).getByRole("button").first();
    await first.focus();
    await expect(first).toBeFocused();
    await page.keyboard.press("Enter");
    await expect(rail(page).locator("[aria-current='true']")).toHaveCount(1);
  });
});
