/**
 * §6.8 AC8 — a guest's work follows them into their account.
 *
 * The one journey that cannot be proved anywhere but in a browser: the bike,
 * the checkup and the to-fix list are in `localStorage`, the account is in
 * Postgres, and `/import` is the only thing that joins them. Three claims:
 *
 *   1. guest → sign up → `/import` → `/velo/<uuid>` with a toast, and
 *      `/mes-velos` lists exactly one bike;
 *   2. `va:bike:local` AND `va:checkup:local` are gone afterwards — a browser
 *      that keeps offering to import a bike it already imported is worse than
 *      one that never offered;
 *   3. re-importing an older copy (the laptop that was not there for step 1)
 *      is skipped: still one bike, still the fresh name.
 *
 * `localStorage` is written with `page.evaluate` rather than the `addInitScript`
 * of `_local-bike.ts`: that helper re-seeds on every document load, which is
 * exactly what claim 2 must not have happening behind it.
 */
import { expect, forEachLocale, href, test, type Locale } from "./_fixtures";
import { localBikePayload } from "./_local-bike";

import { buildListKey, checkupKey, LOCAL_BIKE_KEY } from "../../lib/bike/storage-keys";
import { BIKE_PRESETS } from "../../lib/domain/data/presets";
import accountEn from "../../messages/en/account.json";
import accountFr from "../../messages/fr/account.json";
import authEn from "../../messages/en/auth.json";
import authFr from "../../messages/fr/auth.json";

/* eslint-disable security/detect-object-injection, security/detect-non-literal-regexp -- locale-keyed message fixtures, and patterns built from paths this file computed itself */
const ACCOUNT: Record<Locale, typeof accountFr> = { fr: accountFr, en: accountEn };
const AUTH: Record<Locale, typeof authFr> = { fr: authFr, en: authEn };

const PASSWORD = "Guidon-Tandem-47!";
const CHECKUP_ID = "3f1d7a52-9c1e-4f2b-8d7a-0b4f2c6e1a90";
const UUID = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/;

/** A `CheckupState` as `lib/checkup/storage.ts` writes it (§5.4, W3-T1). */
function checkupState(startedAt: string) {
  return {
    id: CHECKUP_ID,
    bikeRef: { kind: "local" },
    scope: { kind: "parts", partIds: ["chain"] },
    locale: "fr",
    steps: [
      {
        key: "check-drivetrain#chain-wear",
        guideSlug: "check-drivetrain",
        stepId: "chain-wear",
        partIds: ["chain"],
        ko: [],
        skippable: true,
        tools: [],
      },
    ],
    cursor: 1,
    answers: { "check-drivetrain#chain-wear": "ko" },
    notes: { "check-drivetrain#chain-wear": "élongation 0,8 %" },
    toolsMissing: [],
    startedAt,
    completedAt: startedAt,
    contentVersion: "e2e",
    version: 1,
  };
}

/** The to-fix list that checkup produced (W3-T2's envelope, items per `lib/checkup/types.ts`). */
const buildListState = {
  name: "Révision",
  items: [
    {
      id: "check-drivetrain#chain-wear|chain|replace",
      stepKey: "check-drivetrain#chain-wear",
      sourceKeys: ["check-drivetrain#chain-wear"],
      partId: "chain",
      action: "replace",
      reasonKey: "chain-elongation",
      guideSlug: "replace-chain",
      done: false,
      sortOrder: 0,
    },
  ],
};

forEachLocale((locale) => {
  const account = ACCOUNT[locale];
  const auth = AUTH[locale];

  /**
   * Put a guest bike, a finished checkup and its list in this browser.
   *
   * `bike` is passed in rather than generated here, because claim 3 is about
   * the SAME guest bike arriving twice: a second payload with a fresh
   * `localId` would be a second bike, which is not what "already imported"
   * means.
   */
  async function seedGuestWork(
    page: import("@playwright/test").Page,
    bike: import("../../lib/bike/local-bike").LocalBike,
  ): Promise<void> {
    const entries: [string, string][] = [
      [LOCAL_BIKE_KEY, JSON.stringify(bike)],
      [checkupKey("local"), JSON.stringify(checkupState(bike.updatedAt))],
      [buildListKey("local"), JSON.stringify(buildListState)],
    ];
    await page.evaluate((pairs: [string, string][]) => {
      for (const [key, value] of pairs) window.localStorage.setItem(key, value);
    }, entries);
  }

  const storedKeys = (page: import("@playwright/test").Page) =>
    page.evaluate(
      (keys: string[]) => keys.map((key) => window.localStorage.getItem(key)),
      [LOCAL_BIKE_KEY, checkupKey("local"), buildListKey("local")],
    );

  test(`a guest's bike, checkup and list follow them into a new account (${locale})`, async ({
    page,
    signupEmail,
  }) => {
    // A guest with work in this browser.
    const { bike } = localBikePayload(BIKE_PRESETS["gravel-1x11"], { saddleHeightMm: 742 });
    await page.goto(href(locale, "/"));
    await seedGuestWork(page, bike);

    // …who signs up. The garage is empty, and the banner is the way in.
    await page.goto(href(locale, "/inscription"));
    await page.getByLabel(auth.fields.email, { exact: true }).fill(signupEmail);
    await page.getByLabel(auth.fields.password, { exact: true }).fill(PASSWORD);
    await page.getByRole("button", { name: auth.signUp.submit }).click();
    await page.waitForURL(`**${href(locale, "/mes-velos")}`);

    await expect(page.getByTestId("my-bikes-empty")).toBeVisible();
    await expect(page.getByTestId("guest-banner")).toBeVisible();
    await page.getByTestId("guest-banner-cta").click();

    // `/import` runs by itself and opens the bike it just created.
    await page.waitForURL(new RegExp(`${href(locale, "/velo/[id]", { id: "" })}${UUID.source}`));
    await expect(page.getByText(account.import.done)).toBeVisible();
    const bikeUrl = page.url();
    expect(bikeUrl).toMatch(UUID);

    // Claim 2: the browser no longer holds what the account now holds.
    expect(await storedKeys(page)).toEqual([null, null, null]);

    // Claim 1: exactly one bike, and the banner is gone with the storage.
    await page.goto(href(locale, "/mes-velos"));
    await expect(page.getByTestId("my-bikes-list").locator("> li")).toHaveCount(1);
    await expect(page.getByTestId("guest-banner")).toHaveCount(0);

    // Claim 3: the laptop's older copy of the same guest bike, imported later.
    await seedGuestWork(page, { ...bike, updatedAt: "2026-01-01T00:00:00.000Z" });
    await page.reload();
    await expect(page.getByTestId("guest-banner")).toBeVisible();
    await page.getByTestId("guest-banner-cta").click();

    await page.waitForURL(new RegExp(`${href(locale, "/velo/[id]", { id: "" })}${UUID.source}`));
    await expect(page.getByText(account.import.alreadyDone)).toBeVisible();
    // The same bike as the first import, not a second one.
    expect(page.url()).toBe(bikeUrl);
    expect(await storedKeys(page)).toEqual([null, null, null]);

    await page.goto(href(locale, "/mes-velos"));
    await expect(page.getByTestId("my-bikes-list").locator("> li")).toHaveCount(1);
  });

  test(`/import asks an anonymous visitor to sign in first (${locale})`, async ({ page }) => {
    await page.goto(href(locale, "/import"));
    await page.waitForURL(`**${href(locale, "/connexion")}**`);
    expect(new URL(page.url()).searchParams.get("callbackUrl")).toBe(href(locale, "/import"));
  });

  test(`/import sends a visitor with nothing stored back to the garage (${locale})`, async ({
    page,
    signedInContext,
  }) => {
    await signedInContext();
    await page.goto(href(locale, "/import"));
    await page.waitForURL(`**${href(locale, "/mes-velos")}`);
  });
});
