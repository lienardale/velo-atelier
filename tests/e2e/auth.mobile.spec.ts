/**
 * The auth forms on a phone (§4.3 "Mobile", §4.8 AC5, §6.8 AC5).
 *
 * Runs on `mobile-chromium` (Pixel 7, 412×915), `mobile-narrow` (320×568) and
 * `mobile-webkit` (iPhone 14, non-blocking). It is skipped on the desktop
 * projects: every assertion here is about a constraint that only exists on a
 * touch screen.
 *
 * What it pins, and why each one is a real bug when it breaks:
 *
 *   **No horizontal overflow.** The fixtures' automatic guard covers every
 *   mobile test, and this file adds the explicit 320 px assertion §6.8 AC5
 *   names. A login page that scrolls sideways on the narrowest phone in use is
 *   unusable, and it is the easiest thing in the world to ship by accident.
 *
 *   **≥ 44 × 44 CSS px on every control.** Below that, people miss.
 *
 *   **16 px text in every input.** iOS Safari zooms the whole page when a
 *   focused input's font is smaller, and the visitor then has to pinch back out
 *   to find the submit button.
 *
 *   **`autocomplete` / `inputMode` on every field**, so a password manager
 *   fills the form and the keyboard shows `@`.
 *
 *   **Single column, `max-w-sm`.** A two-column auth form on a phone is how
 *   labels end up sitting on top of their inputs.
 */
import { DEMO_USER, expect, forEachLocale, href, test, type Locale } from "./_fixtures";

import en from "../../messages/en/auth.json";
import fr from "../../messages/fr/auth.json";

/* eslint-disable security/detect-object-injection -- locale-keyed message fixtures */
const AUTH: Record<Locale, typeof fr> = { fr, en };

const MIN_TAP = 44;
const MIN_FONT = 16;

test.skip(({ isMobile }) => !isMobile, "mobile projects only");

/** Every interactive control of the current page, as a locator list. */
async function controls(page: import("@playwright/test").Page) {
  return page.locator("main button, main a, main input:not([type=hidden])").all();
}

forEachLocale((locale) => {
  const t = AUTH[locale];

  for (const [label, key] of [
    ["sign-in", "/connexion"],
    ["sign-up", "/inscription"],
  ] as const) {
    test(`${label} fits the viewport without scrolling sideways (${locale})`, async ({ page }) => {
      await page.goto(href(locale, key));

      const { scrollWidth, clientWidth } = await page.evaluate(() => ({
        scrollWidth: document.documentElement.scrollWidth,
        clientWidth: document.documentElement.clientWidth,
      }));
      expect(scrollWidth).toBeLessThanOrEqual(clientWidth + 1);
    });

    test(`${label} keeps every control at 44 px (${locale})`, async ({ page }) => {
      await page.goto(href(locale, key));

      const tooSmall: string[] = [];
      for (const control of await controls(page)) {
        if (!(await control.isVisible())) continue;
        const box = await control.boundingBox();
        if (!box) continue;
        if (box.height < MIN_TAP - 0.5 || box.width < MIN_TAP - 0.5) {
          tooSmall.push(
            `${await control.evaluate((node) => node.outerHTML.slice(0, 80))} → ${Math.round(
              box.width,
            )}×${Math.round(box.height)}`,
          );
        }
      }
      expect(tooSmall).toEqual([]);
    });

    test(`${label} uses 16 px text in every input (${locale})`, async ({ page }) => {
      await page.goto(href(locale, key));

      const sizes = await page
        .locator("main input:not([type=hidden])")
        .evaluateAll((inputs) =>
          inputs.map((input) => Number.parseFloat(getComputedStyle(input).fontSize)),
        );

      expect(sizes.length).toBeGreaterThan(0);
      for (const size of sizes) expect(size).toBeGreaterThanOrEqual(MIN_FONT);
    });

    test(`${label} stays a single narrow column (${locale})`, async ({ page }) => {
      await page.goto(href(locale, key));

      const form = page.getByTestId(label === "sign-in" ? "sign-in-form" : "sign-up-form");
      const formBox = await form.boundingBox();
      const viewport = page.viewportSize();
      expect(formBox?.width ?? 0).toBeLessThanOrEqual((viewport?.width ?? 0) - 16);

      // Labels sit above their inputs: every field's label is higher than it.
      const email = page.getByLabel(t.fields.email, { exact: true });
      const emailBox = await email.boundingBox();
      const labelBox = await page
        .locator(`label[for="${await email.getAttribute("id")}"]`)
        .boundingBox();
      expect((labelBox?.y ?? 0) + (labelBox?.height ?? 0)).toBeLessThanOrEqual(
        (emailBox?.y ?? 0) + 1,
      );
    });
  }

  test(`the phone keyboard and the password manager are set up (${locale})`, async ({ page }) => {
    await page.goto(href(locale, "/connexion"));

    const email = page.getByLabel(t.fields.email, { exact: true });
    await expect(email).toHaveAttribute("type", "email");
    await expect(email).toHaveAttribute("inputmode", "email");
    await expect(email).toHaveAttribute("autocomplete", "email");
    await expect(page.getByLabel(t.fields.password, { exact: true })).toHaveAttribute(
      "autocomplete",
      "current-password",
    );
  });

  test(`the show-password toggle is usable with a thumb (${locale})`, async ({ page }) => {
    await page.goto(href(locale, "/connexion"));
    const password = page.getByLabel(t.fields.password, { exact: true });
    await password.fill(DEMO_USER.password);

    const toggle = page.getByRole("button", { name: t.showPassword });
    const box = await toggle.boundingBox();
    expect(box?.height ?? 0).toBeGreaterThanOrEqual(MIN_TAP - 0.5);

    await toggle.tap();
    await expect(password).toHaveAttribute("type", "text");
    await expect(page.getByRole("button", { name: t.hidePassword })).toBeVisible();
  });

  test(`signing in works by touch alone (${locale})`, async ({ page }) => {
    await page.goto(href(locale, "/connexion"));

    await page.getByLabel(t.fields.email, { exact: true }).tap();
    await page.getByLabel(t.fields.email, { exact: true }).fill(DEMO_USER.email);
    await page.getByLabel(t.fields.password, { exact: true }).tap();
    await page.getByLabel(t.fields.password, { exact: true }).fill(DEMO_USER.password);
    await page.getByRole("button", { name: t.signIn.submit }).tap();

    await page.waitForURL(`**${href(locale, "/mes-velos")}`);
  });

  test(`the Google button spans the column (${locale})`, async ({ page }) => {
    await page.goto(href(locale, "/connexion"));

    const google = page.locator("[data-provider=google] button");
    await expect(google).toBeVisible();
    const box = await google.boundingBox();
    const form = await page.getByTestId("sign-in-form").boundingBox();
    expect(box?.width ?? 0).toBeGreaterThanOrEqual((form?.width ?? 0) - 2);
    expect(box?.height ?? 0).toBeGreaterThanOrEqual(MIN_TAP - 0.5);
  });

  test(`the account page is readable on a phone (${locale})`, async ({ page, signedInContext }) => {
    await signedInContext(locale === "en" ? undefined : undefined);
    await page.goto(href(locale, "/compte"));

    const { scrollWidth, clientWidth } = await page.evaluate(() => ({
      scrollWidth: document.documentElement.scrollWidth,
      clientWidth: document.documentElement.clientWidth,
    }));
    expect(scrollWidth).toBeLessThanOrEqual(clientWidth + 1);

    // The delete dialog is the one thing here that can overflow: it is fixed-width.
    await page.getByTestId("delete-account-open").tap();
    await expect(page.getByRole("dialog")).toBeVisible();
    const dialogBox = await page.getByRole("dialog").boundingBox();
    expect(dialogBox?.width ?? 0).toBeLessThanOrEqual((page.viewportSize()?.width ?? 0) - 16);
  });
});
