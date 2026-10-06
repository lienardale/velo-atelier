/**
 * A bike's twelfth checkup, through the wizard (W5 ruling).
 *
 * Eleven finished runs is past the 10-list quota that used to stop a bike
 * dead: every finished checkup opened a `BuildList`, nothing ever closed one,
 * and the eleventh finish was answered `TOO_MANY` for ever
 * (`.debug/013`, `docs/backlog.md`). One open list per bike is the fix, and
 * this is the row that proves it from the browser, where the payload is built
 * and the refusal would be shown.
 *
 * The eleven runs are seeded by SQL (the pattern of `checkup-quota.spec.ts`)
 * because eleven wizard runs is eleven minutes of CI; the twelfth is answered
 * by hand, and what it must do to the list is the whole ruling in one screen:
 *
 *   the cassette line an earlier run found   survives, open, untouched;
 *   the pads line a hand tick closed         stays closed, and stays `manual`;
 *   the chain the twelfth run condemns       is a new line on the same list.
 *
 * Every test writes its own user and bike (label = locale + project): the
 * Playwright projects share one database.
 */
import { Client } from "pg";

import { buildOf, deriveBike } from "../../lib/bike/rules";
import { BIKE_PRESETS } from "../../lib/domain/data/presets";
import { resolveTestEnv } from "../_fakes/db";

import { expect, forEachLocale, href, test, type Locale } from "./_fixtures";

const CHAIN_STEP = "check-drivetrain#chain-wear";

/** One past `QUOTAS.listsPerBike` (§4.2 c), the limit eleven runs used to meet. */
const SEEDED_RUNS = 11;

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
  listId: string;
}

/**
 * A gravel bike with eleven finished checkups and the one open list they
 * left, holding two lines: a cassette to replace, and pads the visitor
 * already ticked off by hand.
 */
async function bikeWithElevenRuns(label: string, locale: Locale): Promise<Fixture> {
  return withDb(async (client) => {
    const email = `twelfth+${label}@velo-atelier.test`;
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

    let lastCheckupId = "";
    for (let n = 1; n <= SEEDED_RUNS; n += 1) {
      const started = new Date(Date.UTC(2026, 7, n, 8));
      const { rows } = await client.query<{ id: string }>(
        `INSERT INTO "Checkup" ("bikeId", scope, status, "startedAt", "completedAt")
         VALUES ($1, 'FULL', 'COMPLETED', $2, $2) RETURNING id`,
        [bikeId, started],
      );
      lastCheckupId = rows[0].id;
    }

    // The one list those eleven runs left, named after the last of them.
    const { rows: lists } = await client.query<{ id: string }>(
      `INSERT INTO "BuildList" ("bikeId", "checkupId", name, status, "createdAt", "updatedAt")
       VALUES ($1, $2, '', 'OPEN', $3, now()) RETURNING id`,
      [bikeId, lastCheckupId, new Date(Date.UTC(2026, 7, 1, 8))],
    );
    const listId = lists[0].id;

    await client.query(
      `INSERT INTO "BuildListItem"
         ("buildListId", "partId", action, "reasonKey", "guideSlug", done, "doneReason", "sortOrder", "updatedAt")
       VALUES ($1, 'cassette', 'REPLACE', 'cassette-worn', 'replace-cassette', false, NULL, 0, now()),
              ($1, 'brake-pads-front', 'REPLACE', 'pad-worn', 'replace-brake-pads-disc', true, 'manual', 1, now())`,
      [listId],
    );

    return { user: { id: userId, email, locale }, bikeId, listId };
  });
}

interface BikeState {
  lists: number;
  completed: number;
  /** Every line of the bike, by `(partId, action)`. */
  lines: [string, string, boolean, string | null][];
  /** Which list the lines are on — one id, or the test has its answer. */
  listIds: string[];
}

async function bikeState(bikeId: string): Promise<BikeState> {
  return withDb(async (client) => {
    const count = async (sql: string): Promise<number> =>
      Number((await client.query<{ n: string }>(sql, [bikeId])).rows[0].n);
    const { rows } = await client.query<{
      listId: string;
      partId: string;
      action: string;
      done: boolean;
      doneReason: string | null;
    }>(
      `SELECT i."buildListId" AS "listId", i."partId", i.action, i.done, i."doneReason"
         FROM "BuildListItem" i JOIN "BuildList" l ON l.id = i."buildListId"
        WHERE l."bikeId" = $1 ORDER BY i."partId", i.action`,
      [bikeId],
    );
    return {
      lists: await count(`SELECT count(*) AS n FROM "BuildList" WHERE "bikeId" = $1`),
      completed: await count(
        `SELECT count(*) AS n FROM "Checkup" WHERE "bikeId" = $1 AND status = 'COMPLETED'`,
      ),
      lines: rows.map((row) => [row.partId, row.action, row.done, row.doneReason]),
      listIds: [...new Set(rows.map((row) => row.listId))],
    };
  });
}

forEachLocale((locale) => {
  test(`the twelfth checkup finishes into the list the eleven before it left (${locale})`, async ({
    page,
    signedInContext,
  }, testInfo) => {
    const { user, bikeId, listId } = await bikeWithElevenRuns(
      `${locale}-${testInfo.project.name}`,
      locale,
    );
    await signedInContext(user);
    const checkupUrl = href(locale, "/velo/[id]/controle", { id: bikeId }, { parts: "chain" });
    const listPath = href(locale, "/velo/[id]/liste", { id: bikeId });

    await page.goto(checkupUrl);
    await page.getByTestId("checkup-start").click();
    await expect(page.getByTestId("step-card")).toHaveAttribute("data-step-key", CHAIN_STEP);
    await page.getByTestId("verdict-ko").click();
    await page.getByTestId("symptom-chain-elongation").click();
    await expect(page.getByTestId("checkup-summary")).toBeVisible();

    await page.getByTestId("summary-create").click();

    // No refusal — the twelfth run is the one the 10-list quota used to stop.
    await page.waitForURL((url) => url.pathname === listPath);
    await expect(page.getByTestId("checkup-finish-error")).toHaveCount(0);

    // The page shows the new finding beside the line an earlier run left.
    await expect(page.locator('[data-testid="build-item"][data-part-id="chain"]')).toBeVisible();
    await expect(page.locator('[data-testid="build-item"][data-part-id="cassette"]')).toBeVisible();

    expect(await bikeState(bikeId)).toEqual({
      lists: 1,
      completed: SEEDED_RUNS + 1,
      lines: [
        // The hand tick is the visitor's: this checkup never mentioned the pads.
        ["brake-pads-front", "REPLACE", true, "manual"],
        // An earlier run's finding, still open twelve checkups later.
        ["cassette", "REPLACE", false, null],
        // And the twelfth run's own.
        ["chain", "REPLACE", false, null],
      ],
      listIds: [listId],
    });
  });
});
