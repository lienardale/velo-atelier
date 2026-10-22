/**
 * A SAVED bike's partial checkup, in a real browser (`.debug/017` §5.10,
 * §5.11) — which no `?parts=` spec covered before: every other one runs on the
 * demo bike, whose run lives whole in `localStorage`.
 *
 *   the reload        a partial checkup, an answer, a reload, an answer, the
 *                     list: until 2026-10-22 the save after the reload posted
 *                     a scope naming no part, answered ok, and the server
 *                     deleted the run's stored answers;
 *   the banner        the workspace's "Reprendre le contrôle" — no `?parts=`
 *                     for a saved bike — resumes the run as a full checkup,
 *                     its answers kept, and says so;
 *   a full run        opened under `?parts=`: resumed whole, never trimmed;
 *   the scope rule    a checkup limited to the rear caliper says nothing about
 *                     the front one; one limited to the front tyre lists the
 *                     front tyre only;
 *   the other side    a run on the rear caliper, its pads reported worn, then
 *                     the FRONT caliper picked (§5.12, R1): until the review of
 *                     2026-10-22 it was resumed on the front caliper and its
 *                     finding became "replace the FRONT pads"; until §5.13 a
 *                     saved bike's carried on as the full checkup and listed
 *                     both sides' pads. Both are now taken back to the rear
 *                     caliper — a guest's by its stored scope, a saved bike's
 *                     by its row, which names the rear caliper — and so is a
 *                     saved bike's through the resume banner (RA-3);
 *   both sides        a saved bike's run whose rows cannot tell its parts —
 *                     both calipers' pads reported worn, then the front
 *                     caliper — carries on as the full checkup, the answer put
 *                     back in front of the visitor, both lines kept (RA-1);
 *   stale addresses   a guest's run reached through a `?resume=` an earlier
 *                     run left goes back to its own parts (V1-1, V1-2).
 *
 * What is asserted is what PostgreSQL holds (`pg`, the pattern of
 * `checkup-twelfth-run.spec.ts`). Every test writes its own user and bike
 * (label = locale + project): the Playwright projects share one database.
 */
/* eslint-disable security/detect-object-injection -- locale-keyed message fixtures, indexed by a Locale literal */
import { Client } from "pg";

import enCheckup from "../../messages/en/checkup.json";
import frCheckup from "../../messages/fr/checkup.json";
import { buildOf, deriveBike } from "../../lib/bike/rules";
import { BIKE_PRESETS } from "../../lib/domain/data/presets";
import { resolveTestEnv } from "../_fakes/db";

import { storedBuildList, storedCheckup } from "./_checkup";
import { expect, forEachLocale, href, test, type Locale } from "./_fixtures";

const CHECKUP: Record<Locale, typeof frCheckup> = { fr: frCheckup, en: enCheckup };

const PAD_WEAR = "check-brakes-disc#pad-wear";
const ALIGNMENT = "check-brakes-disc#caliper-alignment";
const CHAIN = "check-drivetrain#chain-wear";
const TREAD = "check-wheels-tires#tread-sidewalls-tubeless";

/** The labels the covered-parts sentence names, per locale (`messages/*\/parts.json`). */
const REAR_PADS: Record<Locale, string> = {
  fr: "Plaquettes ou patins arrière",
  en: "Rear pads",
};

/** The pads question's title, in each guide's language (`content/guides/check-brakes-disc`). */
const PADS_TITLE: Record<Locale, string> = {
  fr: "Mesurer l’usure des plaquettes",
  en: "Measure pad wear",
};

/** The rear caliper's label (`messages/*\/parts.json`). */
const REAR_CALIPER: Record<Locale, string> = {
  fr: "Étrier de frein arrière",
  en: "Rear brake caliper",
};

/** The front caliper's label (`messages/*\/parts.json`). */
const FRONT_CALIPER: Record<Locale, string> = {
  fr: "Étrier de frein avant",
  en: "Front brake caliper",
};

async function withDb<T>(run: (client: Client) => Promise<T>): Promise<T> {
  const client = new Client({ connectionString: resolveTestEnv().POSTGRES_URL });
  await client.connect();
  try {
    return await run(client);
  } finally {
    await client.end();
  }
}

interface Fixture {
  user: { id: string; email: string; locale: Locale };
  bikeId: string;
}

/** A gravel bike (hydraulic discs, tubeless) of a fresh user, every part UNKNOWN. */
async function savedBike(label: string, locale: Locale): Promise<Fixture> {
  return withDb(async (client) => {
    const email = `resume+${label}@velo-atelier.test`;
    const derived = deriveBike(BIKE_PRESETS["gravel-1x11"]);
    const build = buildOf(derived);
    const { rows: users } = await client.query<{ id: string }>(
      `INSERT INTO "User" (name, email, locale, "updatedAt") VALUES ($1, $2, $3, now())
       ON CONFLICT (email) DO UPDATE SET name = EXCLUDED.name RETURNING id`,
      ["Camille", email, locale],
    );
    const userId = users[0].id;
    await client.query(`DELETE FROM "Bike" WHERE "userId" = $1`, [userId]);
    const { rows: bikes } = await client.query<{ id: string }>(
      `INSERT INTO "Bike" ("userId", name, answers, spec, parts, "updatedAt")
       VALUES ($1, 'Gravel', $2, $3, $4, now()) RETURNING id`,
      [
        userId,
        JSON.stringify(derived.answers),
        JSON.stringify(build.spec),
        JSON.stringify(build.parts),
      ],
    );
    const bikeId = bikes[0].id;
    for (const part of build.parts) {
      await client.query(
        `INSERT INTO "BikePartState" ("bikeId", "partId", "updatedAt") VALUES ($1, $2, now())`,
        [bikeId, part.partId],
      );
    }
    return { user: { id: userId, email, locale }, bikeId };
  });
}

/**
 * What an earlier FULL checkup left: both sides' pads worn — two open lines on
 * the bike's one list — and both calipers `ATTENTION`.
 */
async function bothPadsWorn(bikeId: string): Promise<void> {
  await withDb(async (client) => {
    const started = new Date(Date.UTC(2026, 8, 1, 8));
    const { rows } = await client.query<{ id: string }>(
      `INSERT INTO "Checkup" ("bikeId", scope, status, "startedAt", "completedAt")
       VALUES ($1, 'FULL', 'COMPLETED', $2, $2) RETURNING id`,
      [bikeId, started],
    );
    const { rows: lists } = await client.query<{ id: string }>(
      `INSERT INTO "BuildList" ("bikeId", "checkupId", name, status, "createdAt", "updatedAt")
       VALUES ($1, $2, '', 'OPEN', $3, now()) RETURNING id`,
      [bikeId, rows[0].id, started],
    );
    await client.query(
      `INSERT INTO "BuildListItem"
         ("buildListId", "partId", action, "reasonKey", "guideSlug", done, "sortOrder", "updatedAt")
       VALUES ($1, 'brake-pads-front', 'REPLACE', 'pad-worn', 'replace-brake-pads-disc', false, 0, now()),
              ($1, 'brake-pads-rear', 'REPLACE', 'pad-worn', 'replace-brake-pads-disc', false, 1, now())`,
      [lists[0].id],
    );
    await client.query(
      `UPDATE "BikePartState" SET status = 'ATTENTION'
        WHERE "bikeId" = $1 AND "partId" IN ('brake-caliper-front', 'brake-caliper-rear')`,
      [bikeId],
    );
  });
}

interface BikeRows {
  checkups: { scope: string; status: string; items: string[] }[];
  lines: string[];
  states: Record<string, string>;
}

async function rowsOf(bikeId: string): Promise<BikeRows> {
  return withDb(async (client) => {
    const { rows: checkups } = await client.query<{ id: string; scope: string; status: string }>(
      `SELECT id, scope, status FROM "Checkup" WHERE "bikeId" = $1 ORDER BY "startedAt"`,
      [bikeId],
    );
    const result: BikeRows = { checkups: [], lines: [], states: {} };
    for (const checkup of checkups) {
      const { rows: items } = await client.query<{
        stepKey: string;
        result: string;
        partId: string;
      }>(
        `SELECT "stepKey", result, "partId" FROM "CheckupItem" WHERE "checkupId" = $1 ORDER BY "stepKey"`,
        [checkup.id],
      );
      result.checkups.push({
        scope: checkup.scope,
        status: checkup.status,
        items: items.map((item) => `${item.stepKey}=${item.result}@${item.partId}`),
      });
    }
    const { rows: lines } = await client.query<{
      partId: string;
      action: string;
      done: boolean;
      doneReason: string | null;
    }>(
      `SELECT i."partId", i.action, i.done, i."doneReason"
         FROM "BuildListItem" i JOIN "BuildList" l ON l.id = i."buildListId"
        WHERE l."bikeId" = $1 ORDER BY i."partId", i.action`,
      [bikeId],
    );
    result.lines = lines.map(
      (line) => `${line.action} ${line.partId}${line.done ? ` ${line.doneReason}` : ""}`,
    );
    const { rows: states } = await client.query<{ partId: string; status: string }>(
      `SELECT "partId", status FROM "BikePartState"
        WHERE "bikeId" = $1 AND status <> 'UNKNOWN' ORDER BY "partId"`,
      [bikeId],
    );
    result.states = Object.fromEntries(states.map((row) => [row.partId, row.status]));
    return result;
  });
}

type Page = import("@playwright/test").Page;

/** The question on screen, or the phase when there is none. */
async function onScreen(page: Page): Promise<string> {
  const phase = await page.getByTestId("checkup-wizard").getAttribute("data-phase");
  if (phase !== "step") return phase ?? "";
  return (await page.getByTestId("step-card").getAttribute("data-step-key")) ?? "";
}

/** Answer the question `key`, which must be on screen; wait for the wizard to move on. */
async function answer(page: Page, key: string, given: "ok" | { ko: string }): Promise<void> {
  await expect(page.getByTestId("step-card")).toHaveAttribute("data-step-key", key);
  if (given === "ok") {
    await page.getByTestId("verdict-ok").click();
  } else {
    await page.getByTestId("verdict-ko").click();
    await page.getByTestId(`symptom-${given.ko}`).click();
  }
  await expect.poll(() => onScreen(page)).not.toBe(key);
}

/** The 2 s autosave has answered. */
async function saved(page: Page): Promise<void> {
  await expect(page.getByTestId("checkup-save-state")).toHaveAttribute("data-state", "saved", {
    timeout: 10_000,
  });
}

forEachLocale((locale) => {
  const t = CHECKUP[locale];

  test(`a saved bike's partial checkup survives a reload: answered, reloaded, answered, finished (${locale})`, async ({
    page,
    signedInContext,
  }, testInfo) => {
    const { user, bikeId } = await savedBike(`reload-${locale}-${testInfo.project.name}`, locale);
    await signedInContext(user);
    await page.goto(
      href(locale, "/velo/[id]/controle", { id: bikeId }, { parts: "chain,brake-caliper-front" }),
    );
    await expect(page.getByTestId("checkup-scope")).toHaveText(t.scopePartial);
    await page.getByTestId("checkup-start").click();
    await answer(page, PAD_WEAR, { ko: "pad-worn" });
    await saved(page);

    await page.reload();
    await expect(page.getByTestId("checkup-scope")).toHaveText(t.scopePartial);
    await answer(page, ALIGNMENT, "ok");
    await saved(page);
    // Until 2026-10-22: 0 rows here, after a save that said "Sauvegardé".
    expect((await rowsOf(bikeId)).checkups).toEqual([
      {
        scope: "PARTIAL",
        status: "IN_PROGRESS",
        items: [`${ALIGNMENT}=OK@brake-caliper-front`, `${PAD_WEAR}=KO@brake-caliper-front`],
      },
    ]);

    await answer(page, CHAIN, { ko: "chain-elongation" });
    await page.getByTestId("summary-create").click();
    await page.waitForURL(
      (url) => url.pathname === href(locale, "/velo/[id]/liste", { id: bikeId }),
    );
    await expect(page.getByTestId("checkup-finish-error")).toHaveCount(0);
    expect(await rowsOf(bikeId)).toEqual({
      checkups: [
        {
          scope: "PARTIAL",
          status: "COMPLETED",
          items: [
            `${ALIGNMENT}=OK@brake-caliper-front`,
            `${PAD_WEAR}=KO@brake-caliper-front`,
            `${CHAIN}=KO@chain`,
          ],
        },
      ],
      lines: ["REPLACE brake-pads-front", "REPLACE chain"],
      states: { "brake-caliper-front": "ATTENTION", chain: "ATTENTION" },
    });
  });

  test(`back through the resume banner, a partial run carries on as a full checkup, its answer kept (${locale})`, async ({
    page,
    signedInContext,
  }, testInfo) => {
    const { user, bikeId } = await savedBike(`banner-${locale}-${testInfo.project.name}`, locale);
    await signedInContext(user);
    await page.goto(
      href(locale, "/velo/[id]/controle", { id: bikeId }, { parts: "chain,brake-caliper-front" }),
    );
    await page.getByTestId("checkup-start").click();
    await answer(page, PAD_WEAR, { ko: "pad-worn" });
    await saved(page);

    await page.goto(href(locale, "/velo/[id]", { id: bikeId }));
    await expect(page.getByTestId("resume-banner")).toBeVisible();
    // A saved bike's row does not say which parts: the link has no `?parts=`.
    const resume = href(locale, "/velo/[id]/controle", { id: bikeId });
    await expect(page.getByTestId("resume-cta")).toHaveAttribute("href", resume);
    // Followed by URL rather than by a click, as in `checkup-partial.spec.ts`:
    // the workspace under the banner is a WebGL canvas still settling.
    await page.goto(resume);
    await expect(page.getByTestId("checkup-scope")).toHaveText(t.scopeFull);
    // The pads' question names both calipers: the answer given on the picked
    // ones now counts for both, and the sentence NAMES it (`.debug/017` §5.12).
    await expect(page.getByTestId("checkup-resumed")).toHaveText(
      t.resumed.partialAsFullNamed.replace(
        "{questions}",
        t.resumed.question.replace("{title}", PADS_TITLE[locale]),
      ),
    );
    // …and opens on it: the answer, now counted for both sides, is shown
    // again first (`.debug/017` §5.13, RA-3).
    await expect(page.getByTestId("step-card")).toHaveAttribute("data-step-key", PAD_WEAR);
    await expect(page.getByTestId("verdict-bar")).toHaveAttribute("data-verdict", "ko");
    await answer(page, PAD_WEAR, { ko: "pad-worn" });
    await answer(page, await onScreen(page), "ok");
    await saved(page);
    // The address says what is on screen: the full checkup.
    expect(new URL(page.url()).searchParams.has("parts")).toBe(false);

    const { checkups } = await rowsOf(bikeId);
    expect(checkups).toHaveLength(1);
    expect(checkups[0]).toMatchObject({ scope: "FULL", status: "IN_PROGRESS" });
    expect(checkups[0].items).toHaveLength(2);
    expect(checkups[0].items).toContain(`${PAD_WEAR}=KO@brake-caliper-front`);
  });

  test(`the reload keeps a run on its own parts because the address says it is the run's own (${locale})`, async ({
    page,
    signedInContext,
  }, testInfo) => {
    // The pads' row names the front caliper — the front pads', or both pads'?
    // The address the wizard writes beside the parts (`?run=`) is what tells.
    const { user, bikeId } = await savedBike(`token-${locale}-${testInfo.project.name}`, locale);
    await signedInContext(user);
    await page.goto(
      href(locale, "/velo/[id]/controle", { id: bikeId }, { parts: "brake-caliper-front" }),
    );
    await page.getByTestId("checkup-start").click();
    await answer(page, PAD_WEAR, { ko: "pad-worn" });
    await saved(page);
    expect(new URL(page.url()).searchParams.get("run")).toMatch(/^\d+$/);
    await page.reload();
    await expect(page.getByTestId("checkup-scope")).toHaveText(t.scopePartial);
    // The same parts picked again, with no such address: the full checkup.
    await page.goto(
      href(locale, "/velo/[id]/controle", { id: bikeId }, { parts: "brake-caliper-front" }),
    );
    await expect(page.getByTestId("checkup-scope")).toHaveText(t.scopeFull);
  });

  test(`an unfinished full run opened under ?parts= is resumed whole, nothing trimmed (${locale})`, async ({
    page,
    signedInContext,
  }, testInfo) => {
    const { user, bikeId } = await savedBike(`full-${locale}-${testInfo.project.name}`, locale);
    await signedInContext(user);
    await page.goto(href(locale, "/velo/[id]/controle", { id: bikeId }));
    await page.getByTestId("checkup-start").click();
    for (let index = 0; index < 3; index += 1) {
      const key = await onScreen(page);
      await answer(page, key, "ok");
    }
    await saved(page);
    expect((await rowsOf(bikeId)).checkups[0].items).toHaveLength(3);

    await page.goto(href(locale, "/velo/[id]/controle", { id: bikeId }, { parts: "chain" }));
    await expect(page.getByTestId("checkup-scope")).toHaveText(t.scopeFull);
    await expect(page.getByTestId("checkup-resumed")).toHaveText(t.resumed.fullInProgress);
    await answer(page, await onScreen(page), "ok");
    await saved(page);
    const { checkups } = await rowsOf(bikeId);
    expect(checkups).toHaveLength(1);
    expect(checkups[0]).toMatchObject({ scope: "FULL", status: "IN_PROGRESS" });
    expect(checkups[0].items).toHaveLength(4);
  });

  test(`a checkup limited to the rear caliper, all OK, says nothing about the front one (${locale})`, async ({
    page,
    signedInContext,
  }, testInfo) => {
    const { user, bikeId } = await savedBike(`rear-${locale}-${testInfo.project.name}`, locale);
    await bothPadsWorn(bikeId);
    await signedInContext(user);
    await page.goto(
      href(locale, "/velo/[id]/controle", { id: bikeId }, { parts: "brake-caliper-rear" }),
    );
    await page.getByTestId("checkup-start").click();
    // The question speaks of every pad; the page says what the answer counts for.
    await expect(page.getByTestId("verdict-covered")).toContainText(REAR_PADS[locale]);
    await answer(page, PAD_WEAR, "ok");
    await answer(page, ALIGNMENT, "ok");
    await expect(page.getByTestId("checkup-summary")).toBeVisible();
    await expect(
      page.locator(`[data-step-key="${PAD_WEAR}"] [data-testid="summary-covered"]`),
    ).toContainText(REAR_PADS[locale]);
    await page.getByTestId("summary-create").click();
    await page.waitForURL(
      (url) => url.pathname === href(locale, "/velo/[id]/liste", { id: bikeId }),
    );

    expect(await rowsOf(bikeId)).toMatchObject({
      lines: ["REPLACE brake-pads-front", "REPLACE brake-pads-rear recheck-ok"],
      // The front caliper keeps what the earlier checkup said; the front
      // lever was never asked about, and is not "Bon état".
      states: { "brake-caliper-front": "ATTENTION", "brake-caliper-rear": "OK" },
    });
    const run = (await rowsOf(bikeId)).checkups.at(-1);
    expect(run).toEqual({
      scope: "PARTIAL",
      status: "COMPLETED",
      items: [`${ALIGNMENT}=OK@brake-caliper-rear`, `${PAD_WEAR}=OK@brake-caliper-rear`],
    });
    // On the list: the front pads still to replace.
    await expect(
      page.locator('[data-testid="build-item"][data-part-id="brake-pads-front"]'),
    ).toBeVisible();
  });

  test(`a checkup limited to the front tyre, KO, lists the front tyre only (${locale})`, async ({
    page,
    signedInContext,
  }, testInfo) => {
    const { user, bikeId } = await savedBike(`tyre-${locale}-${testInfo.project.name}`, locale);
    await signedInContext(user);
    await page.goto(href(locale, "/velo/[id]/controle", { id: bikeId }, { parts: "tire-front" }));
    await page.getByTestId("checkup-start").click();
    await answer(page, TREAD, { ko: "tire-worn" });
    await page.getByTestId("summary-create").click();
    await page.waitForURL(
      (url) => url.pathname === href(locale, "/velo/[id]/liste", { id: bikeId }),
    );
    await expect(
      page.locator('[data-testid="build-item"][data-part-id="tire-front"]'),
    ).toBeVisible();
    await expect(page.locator('[data-testid="build-item"][data-part-id="tire-rear"]')).toHaveCount(
      0,
    );
    expect(await rowsOf(bikeId)).toMatchObject({
      lines: ["REPLACE tire-front"],
      states: { "tire-front": "ATTENTION" },
    });
  });

  test(`a guest's rear pads reported worn, then the FRONT caliper picked: back on the rear caliper, the REAR pads on the list (${locale})`, async ({
    page,
  }) => {
    await page.goto(
      href(locale, "/velo/[id]/controle", { id: "demo" }, { parts: "brake-caliper-rear" }),
    );
    await page.getByTestId("checkup-start").click();
    await answer(page, PAD_WEAR, { ko: "pad-worn" });
    await expect.poll(async () => (await storedCheckup(page))?.answers[PAD_WEAR]).toBe("ko");

    await page.goto(
      href(locale, "/velo/[id]/controle", { id: "demo" }, { parts: "brake-caliper-front" }),
    );
    await page.waitForURL(
      (url) =>
        url.searchParams.get("parts") === "brake-caliper-rear" &&
        url.searchParams.get("resume") === "own",
    );
    await expect(page.getByTestId("checkup-scope")).toHaveText(t.scopePartial);
    await expect(page.getByTestId("checkup-resumed")).toHaveText(
      t.resumed.ownParts.replace("{parts}", REAR_CALIPER[locale]),
    );
    await answer(page, ALIGNMENT, "ok");
    await page.getByTestId("summary-create").click();
    await page.waitForURL(
      (url) => url.pathname === href(locale, "/velo/[id]/liste", { id: "demo" }),
    );
    const lines = ((await storedBuildList(page))?.items ?? []).map(
      (item) => `${item.action} ${item.partId}`,
    );
    // Until this fix: ["replace brake-pads-front"].
    expect(lines).toEqual(["replace brake-pads-rear"]);
    expect((await storedCheckup(page))?.scope).toEqual({
      kind: "parts",
      partIds: ["brake-caliper-rear"],
    });
  });

  test(`a saved bike's rear pads reported worn, then the FRONT caliper picked: back on the rear caliper, the REAR pads on the list (${locale})`, async ({
    page,
    signedInContext,
  }, testInfo) => {
    const { user, bikeId } = await savedBike(`side-${locale}-${testInfo.project.name}`, locale);
    await signedInContext(user);
    await page.goto(
      href(locale, "/velo/[id]/controle", { id: bikeId }, { parts: "brake-caliper-rear" }),
    );
    await page.getByTestId("checkup-start").click();
    await answer(page, PAD_WEAR, { ko: "pad-worn" });
    await saved(page);
    expect((await rowsOf(bikeId)).checkups[0].items).toEqual([`${PAD_WEAR}=KO@brake-caliper-rear`]);

    await page.goto(
      href(locale, "/velo/[id]/controle", { id: bikeId }, { parts: "brake-caliper-front" }),
    );
    // Until §5.12: "Contrôle partiel" on the front caliper, the KO stored
    // against it. Until §5.13: the full checkup, both sides' pads listed.
    await expect(page.getByTestId("checkup-scope")).toHaveText(t.scopePartial);
    await expect(page.getByTestId("checkup-resumed")).toHaveText(
      t.resumed.ownParts.replace("{parts}", REAR_CALIPER[locale]),
    );
    await expect
      .poll(() => new URL(page.url()).searchParams.get("parts"))
      .toBe("brake-caliper-rear");
    await answer(page, ALIGNMENT, "ok");
    await page.getByTestId("summary-create").click();
    await page.waitForURL(
      (url) => url.pathname === href(locale, "/velo/[id]/liste", { id: bikeId }),
    );
    expect(await rowsOf(bikeId)).toEqual({
      checkups: [
        {
          scope: "PARTIAL",
          status: "COMPLETED",
          items: [`${ALIGNMENT}=OK@brake-caliper-rear`, `${PAD_WEAR}=KO@brake-caliper-rear`],
        },
      ],
      lines: ["REPLACE brake-pads-rear"],
      states: { "brake-caliper-rear": "ATTENTION" },
    });
  });

  test(`a saved bike's rear pads answered OK, back through the banner: back on the rear caliper — the front pads' line stays open (${locale})`, async ({
    page,
    signedInContext,
  }, testInfo) => {
    const { user, bikeId } = await savedBike(
      `banner-rear-${locale}-${testInfo.project.name}`,
      locale,
    );
    await bothPadsWorn(bikeId);
    await signedInContext(user);
    await page.goto(
      href(locale, "/velo/[id]/controle", { id: bikeId }, { parts: "brake-caliper-rear" }),
    );
    await page.getByTestId("checkup-start").click();
    await answer(page, PAD_WEAR, "ok");
    await saved(page);

    // The banner's own link: no `?parts=`. The row names the rear caliper.
    await page.goto(href(locale, "/velo/[id]/controle", { id: bikeId }));
    await expect(page.getByTestId("checkup-scope")).toHaveText(t.scopePartial);
    await expect(page.getByTestId("checkup-resumed")).toHaveText(
      t.resumed.ownParts.replace("{parts}", REAR_CALIPER[locale]),
    );
    await answer(page, ALIGNMENT, "ok");
    await page.getByTestId("summary-create").click();
    await page.waitForURL(
      (url) => url.pathname === href(locale, "/velo/[id]/liste", { id: bikeId }),
    );
    // Until §5.13: both lines closed `recheck-ok`, both calipers `OK`.
    expect(await rowsOf(bikeId)).toMatchObject({
      lines: ["REPLACE brake-pads-front", "REPLACE brake-pads-rear recheck-ok"],
      states: { "brake-caliper-front": "ATTENTION", "brake-caliper-rear": "OK" },
    });
  });

  test(`a saved bike's run on both calipers, its pads reported worn, then the FRONT caliper picked: the full checkup, the answer first, both lines (${locale})`, async ({
    page,
    signedInContext,
  }, testInfo) => {
    const { user, bikeId } = await savedBike(`both-${locale}-${testInfo.project.name}`, locale);
    await signedInContext(user);
    await page.goto(
      href(
        locale,
        "/velo/[id]/controle",
        { id: bikeId },
        { parts: "brake-caliper-front,brake-caliper-rear" },
      ),
    );
    await page.getByTestId("checkup-start").click();
    await answer(page, PAD_WEAR, { ko: "pad-worn" });
    await saved(page);

    await page.goto(
      href(locale, "/velo/[id]/controle", { id: bikeId }, { parts: "brake-caliper-front" }),
    );
    // Until §5.13: "Contrôle partiel", no notice, and the rear pads' finding
    // gone from the list. The row names the front caliper — as a front-only
    // run's would: the page cannot tell the two apart.
    await expect(page.getByTestId("checkup-scope")).toHaveText(t.scopeFull);
    await expect(page.getByTestId("checkup-resumed")).toContainText(
      t.resumed.question.replace("{title}", PADS_TITLE[locale]),
    );
    await expect(page.getByTestId("step-card")).toHaveAttribute("data-step-key", PAD_WEAR);
    await answer(page, PAD_WEAR, { ko: "pad-worn" });
    for (let guard = 0; guard < 60 && (await onScreen(page)) !== "summary"; guard += 1) {
      await answer(page, await onScreen(page), "ok");
    }
    await page.getByTestId("summary-create").click();
    await page.waitForURL(
      (url) => url.pathname === href(locale, "/velo/[id]/liste", { id: bikeId }),
    );
    expect((await rowsOf(bikeId)).lines).toEqual([
      "REPLACE brake-pads-front",
      "REPLACE brake-pads-rear",
    ]);
  });

  test(`a guest's FRONT-caliper run reached through an address \`?parts=brake-caliper-rear&resume=own\` an earlier run left: back on the front caliper (${locale})`, async ({
    page,
  }) => {
    await page.goto(
      href(locale, "/velo/[id]/controle", { id: "demo" }, { parts: "brake-caliper-front" }),
    );
    await page.getByTestId("checkup-start").click();
    await answer(page, PAD_WEAR, { ko: "pad-worn" });
    await expect.poll(async () => (await storedCheckup(page))?.answers[PAD_WEAR]).toBe("ko");

    await page.goto(
      href(
        locale,
        "/velo/[id]/controle",
        { id: "demo" },
        { parts: "brake-caliper-rear", resume: "own" },
      ),
    );
    // Until §5.13: held on the rear caliper, the front pads' KO then listed
    // as the rear pads' (V1-1).
    await page.waitForURL((url) => url.searchParams.get("parts") === "brake-caliper-front");
    await expect(page.getByTestId("checkup-resumed")).toHaveText(
      t.resumed.ownParts.replace("{parts}", FRONT_CALIPER[locale]),
    );
    await answer(page, ALIGNMENT, "ok");
    await page.getByTestId("summary-create").click();
    await page.waitForURL(
      (url) => url.pathname === href(locale, "/velo/[id]/liste", { id: "demo" }),
    );
    const lines = ((await storedBuildList(page))?.items ?? []).map(
      (item) => `${item.action} ${item.partId}`,
    );
    expect(lines).toEqual(["replace brake-pads-front"]);
  });

  test(`a guest's FRONT-caliper run reached by Back onto the address an earlier rear-caliper run was sent to: back on the front caliper, its scope kept (${locale})`, async ({
    page,
  }) => {
    // [V1]'s V1-1b: no address typed by hand. A rear-caliper run, opened on
    // the front caliper, is sent to `?parts=brake-caliper-rear&resume=own` and
    // finished there; a front-caliper run follows; Back twice lands on that
    // address. Until §5.13 the front run was resumed there, and its stored
    // scope rewritten to the rear caliper.
    await page.goto(
      href(locale, "/velo/[id]/controle", { id: "demo" }, { parts: "brake-caliper-rear" }),
    );
    await page.getByTestId("checkup-start").click();
    await answer(page, PAD_WEAR, { ko: "pad-worn" });
    await expect.poll(async () => (await storedCheckup(page))?.answers[PAD_WEAR]).toBe("ko");
    await page.goto(
      href(locale, "/velo/[id]/controle", { id: "demo" }, { parts: "brake-caliper-front" }),
    );
    await page.waitForURL((url) => url.searchParams.get("resume") === "own");
    for (let guard = 0; guard < 10 && (await onScreen(page)) !== "summary"; guard += 1) {
      await answer(page, await onScreen(page), "ok");
    }
    await page.getByTestId("summary-create").click();
    await page.waitForURL(
      (url) => url.pathname === href(locale, "/velo/[id]/liste", { id: "demo" }),
    );

    await page.goto(
      href(locale, "/velo/[id]/controle", { id: "demo" }, { parts: "brake-caliper-front" }),
    );
    await page.getByTestId("checkup-start").click();
    await answer(page, PAD_WEAR, { ko: "pad-worn" });
    await expect
      .poll(async () => (await storedCheckup(page))?.scope)
      .toEqual({ kind: "parts", partIds: ["brake-caliper-front"] });
    await page.goBack();
    await page.goBack();
    await page.waitForURL(
      (url) =>
        url.searchParams.get("parts") === "brake-caliper-front" &&
        url.searchParams.get("resume") === "own",
    );
    await expect(page.getByTestId("checkup-resumed")).toHaveText(
      t.resumed.ownParts.replace("{parts}", FRONT_CALIPER[locale]),
    );
    expect((await storedCheckup(page))?.scope).toEqual({
      kind: "parts",
      partIds: ["brake-caliper-front"],
    });
  });

  test(`a guest's REAR-caliper run, the pads OK, reached through an address \`?resume=full\` an earlier run left: back on the rear caliper (${locale})`, async ({
    page,
  }) => {
    await page.goto(
      href(locale, "/velo/[id]/controle", { id: "demo" }, { parts: "brake-caliper-rear" }),
    );
    await page.getByTestId("checkup-start").click();
    await answer(page, PAD_WEAR, "ok");
    await expect.poll(async () => (await storedCheckup(page))?.answers[PAD_WEAR]).toBe("ok");

    await page.goto(href(locale, "/velo/[id]/controle", { id: "demo" }, { resume: "full" }));
    // Until §5.13: carried on as the full checkup, the rear-only OK counted
    // for both sides (V1-2).
    await page.waitForURL(
      (url) =>
        url.searchParams.get("parts") === "brake-caliper-rear" &&
        url.searchParams.get("resume") === "own",
    );
    await expect(page.getByTestId("checkup-scope")).toHaveText(t.scopePartial);
  });
});
