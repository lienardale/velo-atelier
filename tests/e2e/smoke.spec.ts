/**
 * Smoke — the app shell works end to end, in both locales (§8.1 W0-T2).
 *
 * - `/` redirects to `/fr` (localePrefix 'always', no Accept-Language detection);
 * - the home page answers 200 with the right `<html lang>`, title, landmarks,
 *   hreflang alternates, and no console error (hydration, CSP);
 * - the locale switcher lands on the other locale's URL and keeps the query;
 * - an unknown path is the localized 404 page WITH a 404 status (a streamed
 *   200 "not found" page is a soft 404 — see app/[locale]/[...rest]/page.tsx);
 * - the skip link moves focus to `<main>`;
 * - below `lg`, the header menu opens as a modal sheet and closes on Escape.
 *
 * Runs on every project, including `mobile-narrow` (320 px), where the
 * fixtures' overflow guard also checks that nothing scrolls sideways.
 */
/* eslint-disable security/detect-object-injection, security/detect-non-literal-regexp -- locale-keyed fixtures and patterns built from fixed paths */
import en from "../../messages/en/common.json";
import fr from "../../messages/fr/common.json";

import { expect, forEachLocale, href, test, type Locale } from "./_fixtures";

const COMMON: Record<Locale, typeof fr> = { fr, en };
const OTHER: Record<Locale, Locale> = { fr: "en", en: "fr" };

test("the bare origin redirects to the French home page", async ({ request }) => {
  const response = await request.get("/", { maxRedirects: 0 });
  expect(response.status()).toBe(307);
  expect(response.headers().location).toBe("/fr");
});

forEachLocale((locale) => {
  const t = COMMON[locale];

  test(`home page renders (${locale})`, async ({ page }) => {
    const errors: string[] = [];
    page.on("console", (message) => {
      if (message.type() === "error") errors.push(message.text());
    });
    page.on("pageerror", (error) => errors.push(error.message));

    const response = await page.goto(href(locale, "/"));
    expect(response?.status()).toBe(200);

    await expect(page.locator("html")).toHaveAttribute("lang", locale);
    await expect(page).toHaveTitle(`${t.site.name} — ${t.site.tagline}`);
    await expect(page.getByRole("heading", { level: 1 })).toHaveText(t.site.tagline);
    await expect(page.getByRole("banner")).toBeVisible();
    await expect(page.getByRole("main")).toBeVisible();
    await expect(page.getByRole("contentinfo")).toBeVisible();

    // hreflang: each locale points at both, x-default at French.
    for (const [hreflang, path] of [
      ["fr", "/fr"],
      ["en", "/en"],
      ["x-default", "/fr"],
    ] as const) {
      await expect(page.locator(`link[rel="alternate"][hreflang="${hreflang}"]`)).toHaveAttribute(
        "href",
        new RegExp(`${path}$`),
      );
    }
    await expect(page.locator('link[rel="canonical"]')).toHaveAttribute(
      "href",
      new RegExp(`/${locale}$`),
    );

    // "Mon vélo" is the demo bike until a guest bike exists (client island hydrated).
    await expect(
      page
        .getByRole("banner")
        .getByRole("link", { name: t.nav.myBike, includeHidden: true })
        .first(),
    ).toHaveAttribute("href", href(locale, "/velo/[id]", { id: "demo" }));

    expect(errors, errors.join("\n")).toEqual([]);
  });

  test(`locale switcher goes to the other locale and keeps the query (${locale})`, async ({
    page,
  }) => {
    const other = OTHER[locale];
    await page.goto(`${href(locale, "/")}?parts=chain&step=2`);

    await page
      .getByRole("banner")
      .getByRole("group", { name: t.localeSwitcher.label })
      .getByRole("button", { name: t.localeNames[other] })
      .click();

    await page.waitForURL((url) => url.pathname === `/${other}`);
    const url = new URL(page.url());
    expect(url.searchParams.get("parts")).toBe("chain");
    expect(url.searchParams.get("step")).toBe("2");
    await expect(page.locator("html")).toHaveAttribute("lang", other);
    await expect(page.getByRole("heading", { level: 1 })).toHaveText(COMMON[other].site.tagline);
    await expect(
      page.getByRole("banner").getByRole("button", { name: COMMON[other].localeNames[other] }),
    ).toHaveAttribute("aria-current", "true");

    const cookies = await page.context().cookies();
    expect(cookies.find((cookie) => cookie.name === "NEXT_LOCALE")?.value).toBe(other);
  });

  test(`unknown path is a localized 404 (${locale})`, async ({ page }) => {
    const response = await page.goto(`/${locale}/does-not-exist`);
    expect(response?.status()).toBe(404);
    await expect(page.locator("html")).toHaveAttribute("lang", locale);
    await expect(page.getByRole("heading", { level: 1 })).toHaveText(t.notFound.title);
    await expect(page.locator('meta[name="robots"]')).toHaveAttribute("content", /noindex/);
    await expect(
      page.getByRole("main").getByRole("link", { name: t.notFound.backHome }),
    ).toHaveAttribute("href", `/${locale}`);
  });
});

test("a nested unknown path is a 404 too", async ({ request }) => {
  const response = await request.get("/en/not/a/page/at-all");
  expect(response.status()).toBe(404);
});

test("the skip link moves focus to the main content", async ({ page }) => {
  await page.goto(href("fr", "/"));
  await page.keyboard.press("Tab");
  const skip = page.getByRole("link", { name: fr.skipLink });
  await expect(skip).toBeFocused();
  await expect(skip).toBeInViewport();
  await page.keyboard.press("Enter");
  await expect(page.locator("main#main-content")).toBeFocused();
});

test("below lg, the header menu is a modal sheet that closes on Escape", async ({ page }) => {
  const width = page.viewportSize()?.width ?? 1280;
  test.skip(width >= 1024, "the inline navigation is used from lg (1024 px) up");

  await page.goto(href("fr", "/"));
  const menuButton = page.getByRole("button", { name: fr.nav.openMenu });
  await expect(menuButton).toBeVisible();
  const box = await menuButton.boundingBox();
  expect(box?.width).toBeGreaterThanOrEqual(44);
  expect(box?.height).toBeGreaterThanOrEqual(44);

  await menuButton.click();
  const sheet = page.getByRole("dialog", { name: fr.nav.menu });
  await expect(sheet).toBeVisible();
  await expect(sheet.getByRole("link", { name: fr.nav.guides })).toBeVisible();
  await expect(menuButton).toHaveAttribute("aria-expanded", "true");

  await page.keyboard.press("Escape");
  await expect(sheet).toBeHidden();
  await expect(menuButton).toHaveAttribute("aria-expanded", "false");
  await expect(menuButton).toBeFocused();
});
