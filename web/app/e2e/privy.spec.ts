import { test, expect } from "@playwright/test";

// Public modal smoke check; actual OTP/Google authentication is completed by
// a real user, not bypassed by this test.
test.describe("Privy entry", () => {
  test.skip(
    !process.env.NEXT_PUBLIC_PRIVY_APP_ID?.trim(),
    "requires a configured Privy app id",
  );
  test("uses email sign-in throughout the app and opens the real login modal", async ({
    page,
  }) => {
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await page.goto("/privy");
    await expect(
      page.getByRole("heading", { name: "Email to investment" }),
    ).toBeVisible({ timeout: 45_000 });
    await expect(
      page
        .locator("header")
        .getByRole("button", { name: "Connect wallet", exact: true }),
    ).toHaveCount(0);
    await expect(page.getByRole("dialog", { name: "Guided tour" })).toHaveCount(
      0,
    );
    await page
      .locator("header")
      .getByRole("button", { name: "Continue with email", exact: true })
      .first()
      .click();
    await expect(page.getByPlaceholder(/email/i)).toBeVisible({
      timeout: 30_000,
    });
    expect(errors).toEqual([]);
  });
});
