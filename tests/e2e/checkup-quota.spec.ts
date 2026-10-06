/**
 * §4.2 (c), as the visitor meets it — and what W5 did to it.
 *
 * The user's ruling for W4 is why this file exists: the three quotas are
 * enforced literally, and "the wizard must show that error, never fail
 * silently". Before W4 the wizard ignored `finishCheckupAction`'s answer and
 * navigated to a list that was never written.
 *
 * W5 moved the 10-list limit without loosening it. A finish merges into the
 * bike's one OPEN build list, so the limit is only counted on the path that
 * would CREATE one — which a bike with an open list never takes. Both halves
 * are here, on the same fixture of ten lists:
 *
 *   ten lists, the newest OPEN   the finish goes through, into that list. This
 *                                is the old test's bike, and the old test's
 *                                refusal is exactly what must NOT happen now.
 *   ten lists, none open         still `TOO_MANY`, still named, still before
 *                                the first write. Nothing writes `DONE` yet
 *                                (`docs/backlog.md`), so this is the limit's
 *                                remaining reachable case — and the reason it
 *                                is still counted at all.
 *
 * The refusal itself is pinned in the security and integration tiers
 * (`tests/security/quotas.test.ts`, `tests/integration/checkups.test.ts`);
 * what only a browser can show is the rest of the promise: the message, in the
 * page's language, with `role="alert"`, the visitor still on the checkup with
 * their answers, and nothing written.
 *
 * Every test writes its own user and bike (label = locale + project): the
 * Playwright projects share one database.
 */
/* eslint-disable security/detect-object-injection -- locale-keyed message fixtures */
import { Client } from "pg";

import { buildOf, deriveBike } from "../../lib/bike/rules";
import { BIKE_PRESETS } from "../../lib/domain/data/presets";
import enCheckup from "../../messages/en/checkup.json";
import frCheckup from "../../messages/fr/checkup.json";
import { resolveTestEnv } from "../_fakes/db";

import { expect, forEachLocale, href, test, type Locale } from "./_fixtures";

const CHECKUP_T: Record<Locale, typeof frCheckup> = { fr: frCheckup, en: enCheckup };

/** `QUOTAS.listsPerBike` (§4.2 c) — spelled out, so a changed limit is a visible diff here. */
const LISTS_PER_BIKE = 10;

const CHAIN_STEP = "check-drivetrain#chain-wear";

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
  /** The ten lists, oldest first. */
  listIds: string[];
}

/**
 * A user whose gravel bike already holds `LISTS_PER_BIKE` (empty) build lists.
 *
 * `createdAt` is spelled out and increasing: "the bike's newest OPEN list" is
 * what a finish writes into, and ten `now()` defaults would make that a race.
 */
async function bikeAtListQuota(
  label: string,
  locale: Locale,
  status: "OPEN" | "DONE",
): Promise<Fixture> {
  return withDb(async (client) => {
    const email = `quota+${label}@velo-atelier.test`;
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
    const listIds: string[] = [];
    for (let n = 1; n <= LISTS_PER_BIKE; n += 1) {
      const { rows } = await client.query<{ id: string }>(
        `INSERT INTO "BuildList" ("bikeId", name, status, "createdAt", "updatedAt")
         VALUES ($1, $2, $3, $4, now()) RETURNING id`,
        [bikeId, `Liste ${n}`, status, new Date(Date.UTC(2026, 6, n, 8))],
      );
      listIds.push(rows[0].id);
    }
    return { user: { id: userId, email, locale }, bikeId, listIds };
  });
}

/** What the database holds for the bike after the finish. */
async function bikeState(bikeId: string): Promise<{
  lists: number;
  completed: number;
  chainLines: { listId: string; done: boolean }[];
}> {
  return withDb(async (client) => {
    const count = async (sql: string): Promise<number> =>
      Number((await client.query<{ n: string }>(sql, [bikeId])).rows[0].n);
    const { rows: lines } = await client.query<{ listId: string; done: boolean }>(
      `SELECT i."buildListId" AS "listId", i.done FROM "BuildListItem" i
         JOIN "BuildList" l ON l.id = i."buildListId"
        WHERE l."bikeId" = $1 AND i."partId" = 'chain'
        ORDER BY i.action`,
      [bikeId],
    );
    return {
      lists: await count(`SELECT count(*) AS n FROM "BuildList" WHERE "bikeId" = $1`),
      completed: await count(
        `SELECT count(*) AS n FROM "Checkup" WHERE "bikeId" = $1 AND status = 'COMPLETED'`,
      ),
      chainLines: lines,
    };
  });
}

forEachLocale((locale) => {
  test(`a bike with ten lists finishes into the newest open one (${locale})`, async ({
    page,
    signedInContext,
  }, testInfo) => {
    const { user, bikeId, listIds } = await bikeAtListQuota(
      `open-${locale}-${testInfo.project.name}`,
      locale,
      "OPEN",
    );
    await signedInContext(user);
    const checkupUrl = href(locale, "/velo/[id]/controle", { id: bikeId }, { parts: "chain" });
    const listPath = href(locale, "/velo/[id]/liste", { id: bikeId });
    await page.goto(checkupUrl);

    // A KO with its symptom: the line this checkup puts on the list.
    await page.getByTestId("checkup-start").click();
    await expect(page.getByTestId("step-card")).toHaveAttribute("data-step-key", CHAIN_STEP);
    await page.getByTestId("verdict-ko").click();
    await page.getByTestId("symptom-chain-elongation").click();
    await expect(page.getByTestId("checkup-summary")).toBeVisible();

    await page.getByTestId("summary-create").click();

    // No refusal, and the list the visitor lands on is the one that was
    // written — the newest OPEN one, which is also what `/liste` renders.
    await page.waitForURL((url) => url.pathname === listPath);
    await expect(page.getByTestId("checkup-finish-error")).toHaveCount(0);
    await expect(page.locator('[data-testid="build-item"][data-part-id="chain"]')).toBeVisible();

    expect(await bikeState(bikeId)).toEqual({
      lists: LISTS_PER_BIKE,
      completed: 1,
      chainLines: [{ listId: listIds[LISTS_PER_BIKE - 1], done: false }],
    });
  });

  test(`finishing is refused out loud when none of the ten lists is open, and nothing is written (${locale})`, async ({
    page,
    signedInContext,
  }, testInfo) => {
    const { user, bikeId } = await bikeAtListQuota(
      `done-${locale}-${testInfo.project.name}`,
      locale,
      "DONE",
    );
    await signedInContext(user);
    const checkupUrl = href(locale, "/velo/[id]/controle", { id: bikeId }, { parts: "chain" });
    await page.goto(checkupUrl);

    await page.getByTestId("checkup-start").click();
    await expect(page.getByTestId("step-card")).toHaveAttribute("data-step-key", CHAIN_STEP);
    await page.getByTestId("verdict-ko").click();
    await page.getByTestId("symptom-chain-elongation").click();
    await expect(page.getByTestId("checkup-summary")).toBeVisible();

    await page.getByTestId("summary-create").click();

    // Said, in the page's language, as an alert — the limit named, not "an error".
    const refusal = page.getByTestId("checkup-finish-error");
    await expect(refusal).toBeVisible();
    await expect(refusal).toHaveAttribute("role", "alert");
    await expect(refusal).toHaveText(CHECKUP_T[locale].finish.tooManyLists);

    // Still on the checkup, answers intact, and free to try again: no
    // navigation to a list that does not exist.
    expect(new URL(page.url()).pathname).toBe(new URL(checkupUrl, page.url()).pathname);
    await expect(page.getByTestId("checkup-summary")).toBeVisible();
    await expect(page.getByTestId("summary-group-ko").locator("li")).toHaveCount(1);
    await expect(page.getByTestId("summary-create")).toBeEnabled();

    // Checked before the first write (§4.2 c): no 11th list, no finished
    // checkup, no line.
    expect(await bikeState(bikeId)).toEqual({
      lists: LISTS_PER_BIKE,
      completed: 0,
      chainLines: [],
    });
  });
});
