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
 * …and, since 2026-10-07, the claim the first three never made: **the rows are
 * there.** Until then this file seeded a checkup that carried `steps` — a shape
 * the wizard stopped storing in W3 — and asserted nothing about a `Checkup`
 * row. Production imported the bike and the list, wrote no checkup, left
 * `BuildList.checkupId` NULL and every part `UNKNOWN`, and then cleared the
 * checkup from the browser (`.debug/017` §5.6). So:
 *
 *   4. what is seeded is what the wizard STORES — `tests/_helpers/guest-work.ts`
 *      runs the real plan and the real reducer and writes `toStored(state)`
 *      and the list through their own writers — and after the import the
 *      DATABASE holds, for that bike: one `Checkup`, its items, a `BuildList`
 *      whose `checkupId` is that checkup, lines whose `checkupItemId` is set,
 *      and part states that are no longer all `UNKNOWN`;
 *   5. a checkup the browser cannot read is not imported, the visitor is told,
 *      and the key is STILL in `localStorage` afterwards;
 *   6. the same journey with NO fixture for the checkup at all: the guest
 *      answers it in the real wizard, which writes the two keys itself — the
 *      walk that found the bug (`docs/deploy.md` §5.2, Journey B), as a test.
 *
 * `localStorage` is written with `page.evaluate` rather than the `addInitScript`
 * of `_local-bike.ts`: that helper re-seeds on every document load, which is
 * exactly what claim 2 must not have happening behind it.
 */
import { Client } from "pg";

import { expect, forEachLocale, href, test, type Locale } from "./_fixtures";
import { localBikePayload } from "./_local-bike";

import { buildListKey, checkupKey, LOCAL_BIKE_KEY } from "../../lib/bike/storage-keys";
import { BIKE_PRESETS } from "../../lib/domain/data/presets";
import accountEn from "../../messages/en/account.json";
import accountFr from "../../messages/fr/account.json";
import authEn from "../../messages/en/auth.json";
import authFr from "../../messages/fr/auth.json";
import { resolveTestEnv } from "../_fakes/db";
import { guestRun, guestWork, partsScope, type GuestWork } from "../_helpers/guest-work";

/* eslint-disable security/detect-object-injection, security/detect-non-literal-regexp -- locale-keyed message fixtures, and patterns built from paths this file computed itself */
const ACCOUNT: Record<Locale, typeof accountFr> = { fr: accountFr, en: accountEn };
const AUTH: Record<Locale, typeof authFr> = { fr: authFr, en: authEn };

const PASSWORD = "Guidon-Tandem-47!";
const CHECKUP_ID = "3f1d7a52-9c1e-4f2b-8d7a-0b4f2c6e1a90";
const UUID = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/;

const CHAIN = "check-drivetrain#chain-wear";
const CASSETTE = "check-drivetrain#cassette-teeth";

const KEYS = [LOCAL_BIKE_KEY, checkupKey("local"), buildListKey("local")] as const;

/**
 * A guest bike, a FINISHED partial checkup — the chain is worn, the cassette is
 * fine — and the to-fix list "Créer ma liste" left behind, each written by the
 * code the wizard writes it with.
 *
 * `bikeId` and `updatedAt` are passed in for claim 3, which is about the SAME
 * guest bike arriving twice: a second payload with a fresh id would be a second
 * bike, which is not what "already imported" means.
 */
function guestWorkFor(options: { bikeId?: string; updatedAt?: string } = {}): GuestWork {
  const startedAt = options.updatedAt ?? "2026-09-14T08:00:00.000Z";
  return guestWork({
    answers: BIKE_PRESETS["gravel-1x11"],
    fit: { saddleHeightMm: 742 },
    ...options,
    checkup: (build) =>
      guestRun({
        id: CHECKUP_ID,
        build,
        scope: partsScope("chain", "cassette"),
        verdicts: {
          [CHAIN]: { ko: ["chain-elongation"], notes: "élongation 0,8 %" },
          [CASSETTE]: "ok",
        },
        startedAt,
        completedAt: startedAt,
      }),
  });
}

async function withDb<T>(run: (client: Client) => Promise<T>): Promise<T> {
  const client = new Client({ connectionString: resolveTestEnv().POSTGRES_URL });
  await client.connect();
  try {
    return await run(client);
  } finally {
    await client.end();
  }
}

interface ImportedRows {
  checkups: { id: string; status: string; scope: string; guestKey: string | null }[];
  items: {
    id: string;
    checkupId: string;
    stepKey: string;
    partId: string;
    guideSlug: string;
    result: string;
    notes: string | null;
    reasonKeys: string[];
  }[];
  lists: { id: string; checkupId: string | null }[];
  lines: { partId: string; action: string; checkupItemId: string | null }[];
  /** `partId` → status, for every part that is not `UNKNOWN`. */
  known: Record<string, string>;
  partStates: number;
  userId: string;
}

/** Everything the database holds for one bike — what the import wrote. */
async function rowsOf(bikeId: string): Promise<ImportedRows> {
  return withDb(async (client) => {
    const { rows: bikes } = await client.query<{ userId: string }>(
      `SELECT "userId" FROM "Bike" WHERE id = $1`,
      [bikeId],
    );
    const { rows: checkups } = await client.query<ImportedRows["checkups"][number]>(
      `SELECT id, status, scope, "guestKey" FROM "Checkup" WHERE "bikeId" = $1`,
      [bikeId],
    );
    const { rows: items } = await client.query<ImportedRows["items"][number]>(
      `SELECT i.id, i."checkupId", i."stepKey", i."partId", i."guideSlug", i.result, i.notes,
              i."reasonKeys"
         FROM "CheckupItem" i JOIN "Checkup" c ON c.id = i."checkupId"
        WHERE c."bikeId" = $1 ORDER BY i."stepKey" DESC`,
      [bikeId],
    );
    const { rows: lists } = await client.query<ImportedRows["lists"][number]>(
      `SELECT id, "checkupId" FROM "BuildList" WHERE "bikeId" = $1`,
      [bikeId],
    );
    const { rows: lines } = await client.query<ImportedRows["lines"][number]>(
      `SELECT l."partId", l.action, l."checkupItemId"
         FROM "BuildListItem" l JOIN "BuildList" b ON b.id = l."buildListId"
        WHERE b."bikeId" = $1 ORDER BY l."sortOrder"`,
      [bikeId],
    );
    const { rows: states } = await client.query<{ partId: string; status: string }>(
      `SELECT "partId", status FROM "BikePartState" WHERE "bikeId" = $1`,
      [bikeId],
    );
    return {
      checkups,
      items,
      lists,
      lines,
      known: Object.fromEntries(
        states.filter((row) => row.status !== "UNKNOWN").map((row) => [row.partId, row.status]),
      ),
      partStates: states.length,
      userId: bikes[0]?.userId ?? "",
    };
  });
}

forEachLocale((locale) => {
  const account = ACCOUNT[locale];
  const auth = AUTH[locale];

  /** Put what `storage` holds under the three guest keys of this browser. */
  async function seedGuestWork(
    page: import("@playwright/test").Page,
    storage: GuestWork["storage"],
  ): Promise<void> {
    const entries = KEYS.flatMap((key): [string, string][] => {
      const value = storage.getItem(key);
      return value === null ? [] : [[key, value]];
    });
    await page.evaluate((pairs: [string, string][]) => {
      for (const [key, value] of pairs) window.localStorage.setItem(key, value);
    }, entries);
  }

  const storedKeys = (page: import("@playwright/test").Page) =>
    page.evaluate(
      (keys: string[]) => keys.map((key) => window.localStorage.getItem(key)),
      [...KEYS],
    );

  /** A guest signs up; the garage is empty, and the banner is the way in. */
  async function signUpAndStartImport(
    page: import("@playwright/test").Page,
    signupEmail: string,
  ): Promise<void> {
    await page.goto(href(locale, "/inscription"));
    await page.getByLabel(auth.fields.email, { exact: true }).fill(signupEmail);
    await page.getByLabel(auth.fields.password, { exact: true }).fill(PASSWORD);
    await page.getByRole("button", { name: auth.signUp.submit }).click();
    await page.waitForURL(`**${href(locale, "/mes-velos")}`);

    await expect(page.getByTestId("my-bikes-empty")).toBeVisible();
    await expect(page.getByTestId("guest-banner")).toBeVisible();
    await page.getByTestId("guest-banner-cta").click();
  }

  const bikeUrlPattern = new RegExp(`${href(locale, "/velo/[id]", { id: "" })}(${UUID.source})`);

  test(`a guest's bike, checkup and list follow them into a new account (${locale})`, async ({
    page,
    signupEmail,
  }) => {
    // The longest journey in the suite: a sign-up, two imports, and two loads of
    // `/velo/<uuid>` — the heaviest route in the app, which the import pushes to
    // with `router.replace` (the URL only changes once its RSC payload lands).
    // It measures ~15 s alone and over the 45 s default when the tests of this
    // file share four workers, so the budget is tripled rather than left to
    // whatever else the machine is doing. Nothing below is relaxed.
    test.slow();

    // A guest with work in this browser — as the wizard left it.
    const work = guestWorkFor();
    // What is about to be seeded is the shape the wizard stores: answers, no plan.
    const seeded = JSON.parse(work.storage.getItem(checkupKey("local")) ?? "{}") as object;
    expect(seeded).not.toHaveProperty("steps");
    expect(seeded).toMatchObject({ answers: { [CHAIN]: "ko", [CASSETTE]: "ok" } });

    await page.goto(href(locale, "/"));
    await seedGuestWork(page, work.storage);
    expect((await storedKeys(page)).every((value) => value !== null)).toBe(true);

    // …who signs up.
    await signUpAndStartImport(page, signupEmail);

    // `/import` runs by itself and opens the bike it just created.
    //
    // The toast first, the URL second, because that is the order they happen in:
    // `/import` raises the toast and calls `router.replace` in the same tick, and
    // the URL only changes once `/velo/<uuid>` — the heaviest route in the app —
    // has sent its payload. sonner hides a toast after four seconds, so asserting
    // it AFTER the navigation is a race the transition wins often enough to be
    // red (seen on the second import, where the sonner chunk is already cached
    // and the toast is therefore raised sooner).
    await expect(page.getByText(account.import.done)).toBeVisible();
    await page.waitForURL(bikeUrlPattern);
    const bikeUrl = page.url();
    const bikeId = bikeUrlPattern.exec(bikeUrl)?.[1] ?? "";
    expect(bikeId).toMatch(UUID);
    // The checkup WAS imported: there is nothing to tell the visitor about it.
    for (const sentence of Object.values(account.import.checkupKept)) {
      await expect(page.getByText(sentence)).toHaveCount(0);
    }

    // Claim 2: the browser no longer holds what the account now holds.
    expect(await storedKeys(page)).toEqual([null, null, null]);

    // Claim 4: and the account DOES hold it — the rows, read from Postgres.
    const imported = await rowsOf(bikeId);
    // A `Checkup` row exists for the imported bike…
    expect(imported.checkups).toHaveLength(1);
    const [checkup] = imported.checkups;
    expect(checkup).toMatchObject({
      status: "COMPLETED",
      scope: "PARTIAL",
      guestKey: `${imported.userId}:${CHECKUP_ID}`,
    });
    // …with one item per answered step, about the part and the guide the
    // SERVER's plan gives it (the browser sent neither).
    expect(imported.items).toEqual([
      {
        id: expect.any(String),
        checkupId: checkup.id,
        stepKey: CHAIN,
        partId: "chain",
        guideSlug: "check-drivetrain",
        result: "KO",
        notes: "élongation 0,8 %",
        reasonKeys: ["chain-elongation"],
      },
      {
        id: expect.any(String),
        checkupId: checkup.id,
        stepKey: CASSETTE,
        partId: "cassette",
        guideSlug: "check-drivetrain",
        result: "OK",
        notes: null,
        reasonKeys: [],
      },
    ]);
    // `BuildList.checkupId` is set, to that checkup…
    expect(imported.lists).toEqual([{ id: expect.any(String), checkupId: checkup.id }]);
    // …and EVERY line's `checkupItemId` is set: the one line this checkup
    // derives, linked to the item of the step that derived it.
    expect(imported.lines.length).toBeGreaterThan(0);
    expect(imported.lines.every((line) => line.checkupItemId !== null)).toBe(true);
    expect(imported.lines).toEqual([
      {
        partId: "chain",
        action: "REPLACE",
        checkupItemId: imported.items.find((item) => item.stepKey === CHAIN)?.id,
      },
    ]);
    // The part states are no longer all UNKNOWN (§4.2 b).
    expect(imported.known).toEqual({ chain: "BROKEN", cassette: "OK" });
    expect(imported.partStates).toBeGreaterThan(2);

    // Claim 1: exactly one bike, and the banner is gone with the storage.
    await page.goto(href(locale, "/mes-velos"));
    await expect(page.getByTestId("my-bikes-list").locator("> li")).toHaveCount(1);
    await expect(page.getByTestId("guest-banner")).toHaveCount(0);

    // Claim 3: the laptop's older copy of the same guest bike, imported later.
    const older = guestWorkFor({ bikeId: work.bike.id, updatedAt: "2026-01-01T00:00:00.000Z" });
    await seedGuestWork(page, older.storage);
    await page.reload();
    await expect(page.getByTestId("guest-banner")).toBeVisible();
    await page.getByTestId("guest-banner-cta").click();

    await expect(page.getByText(account.import.alreadyDone)).toBeVisible();
    await page.waitForURL(bikeUrlPattern);
    // The same bike as the first import, not a second one.
    expect(page.url()).toBe(bikeUrl);
    // The account already holds that checkup, so the browser forgets its copy.
    expect(await storedKeys(page)).toEqual([null, null, null]);
    // Nothing was written the second time: the same rows, to the id.
    expect(await rowsOf(bikeId)).toEqual(imported);

    await page.goto(href(locale, "/mes-velos"));
    await expect(page.getByTestId("my-bikes-list").locator("> li")).toHaveCount(1);
  });

  test(`a checkup the browser cannot read is not imported, is said, and is kept (${locale})`, async ({
    page,
    signupEmail,
  }) => {
    test.slow();

    // The same guest work — and a checkup key that got corrupted: the first
    // half of what the wizard wrote.
    const work = guestWorkFor();
    const stored = work.storage.getItem(checkupKey("local")) ?? "";
    const corrupted = stored.slice(0, Math.floor(stored.length / 2));
    expect(() => JSON.parse(corrupted) as unknown).toThrow();
    work.storage.setItem(checkupKey("local"), corrupted);

    await page.goto(href(locale, "/"));
    await seedGuestWork(page, work.storage);
    await signUpAndStartImport(page, signupEmail);

    // The bike IS imported — and the visitor is told, in their language, that
    // the checkup is not, and where it is.
    await expect(page.getByText(account.import.done)).toBeVisible();
    await expect(page.getByText(account.import.checkupKept.unreadable)).toBeVisible();
    await page.waitForURL(bikeUrlPattern);
    const bikeId = bikeUrlPattern.exec(page.url())?.[1] ?? "";

    // The key is STILL there, byte for byte; the bike and the list are gone
    // from the browser because the account has them.
    expect(await storedKeys(page)).toEqual([null, corrupted, null]);

    // In the database: the bike and its list, and no checkup — so nothing is
    // linked and no part has a status.
    const imported = await rowsOf(bikeId);
    expect(imported.userId).not.toBe("");
    expect(imported.lists).toEqual([{ id: expect.any(String), checkupId: null }]);
    expect(imported.lines).toEqual([{ partId: "chain", action: "REPLACE", checkupItemId: null }]);
    expect(imported.checkups).toEqual([]);
    expect(imported.items).toEqual([]);
    expect(imported.known).toEqual({});

    // One bike in the garage, and no invitation left: the banner follows the
    // BIKE key, so a checkup that stayed behind does not offer the import again.
    await page.goto(href(locale, "/mes-velos"));
    await expect(page.getByTestId("my-bikes-list").locator("> li")).toHaveCount(1);
    await expect(page.getByTestId("guest-banner")).toHaveCount(0);
    expect(await storedKeys(page)).toEqual([null, corrupted, null]);
  });

  test(`a checkup answered in the wizard itself is imported with its rows (${locale})`, async ({
    page,
    signupEmail,
  }) => {
    test.slow();

    // A guest bike, and nothing else: the checkup and the list are about to be
    // written by the application, not by this file.
    const { raw, specCode } = localBikePayload(BIKE_PRESETS["gravel-1x11"]);
    await page.goto(href(locale, "/"));
    await page.evaluate(
      ([key, value]) => window.localStorage.setItem(key, value),
      [LOCAL_BIKE_KEY, raw],
    );

    // The guest checks the chain, finds it worn, and asks for the list.
    await page.goto(
      href(locale, "/velo/[id]/controle", { id: "local" }, { spec: specCode, parts: "chain" }),
    );
    await page.getByTestId("checkup-start").click();
    await expect(page.getByTestId("step-card")).toHaveAttribute("data-step-key", CHAIN);
    await page.getByTestId("verdict-ko").click();
    await page.getByTestId("symptom-chain-elongation").click();
    await page.getByTestId("summary-create").click();
    // Finishing opens the list (`router.push` after the write): let it land
    // before navigating away (.debug/015 §8).
    await page.waitForURL(
      (url) => url.pathname === href(locale, "/velo/[id]/liste", { id: "local" }),
    );

    // What the WIZARD left under the key — the shape the old importer could
    // not read: answers, a completion date, and no plan.
    const [, storedCheckup, storedList] = await storedKeys(page);
    expect(storedList).not.toBeNull();
    const stored = JSON.parse(storedCheckup ?? "null") as {
      id: string;
      answers: Record<string, string>;
      completedAt?: string;
    };
    expect(stored).not.toHaveProperty("steps");
    expect(stored.answers).toEqual({ [CHAIN]: "ko" });
    expect(stored.completedAt).toBeDefined();

    await signUpAndStartImport(page, signupEmail);
    await expect(page.getByText(account.import.done)).toBeVisible();
    await page.waitForURL(bikeUrlPattern);
    const bikeId = bikeUrlPattern.exec(page.url())?.[1] ?? "";
    expect(await storedKeys(page)).toEqual([null, null, null]);

    // The rows the walk of 2026-10-07 looked for and did not find.
    const imported = await rowsOf(bikeId);
    expect(imported.checkups).toEqual([
      {
        id: expect.any(String),
        status: "COMPLETED",
        scope: "PARTIAL",
        guestKey: `${imported.userId}:${stored.id}`,
      },
    ]);
    const [checkup] = imported.checkups;
    expect(imported.items).toEqual([
      {
        id: expect.any(String),
        checkupId: checkup.id,
        stepKey: CHAIN,
        partId: "chain",
        guideSlug: "check-drivetrain",
        result: "KO",
        notes: null,
        reasonKeys: ["chain-elongation"],
      },
    ]);
    expect(imported.lists).toEqual([{ id: expect.any(String), checkupId: checkup.id }]);
    expect(imported.lines).toEqual([
      { partId: "chain", action: "REPLACE", checkupItemId: imported.items[0].id },
    ]);
    expect(imported.known).toEqual({ chain: "BROKEN" });
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
