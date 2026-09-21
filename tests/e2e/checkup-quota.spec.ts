/**
 * §4.2 (c), as the visitor meets it: a saved bike that already holds the most
 * lists a bike can have (10) cannot get an 11th, and the wizard SAYS so.
 *
 * The user's ruling for W4 is the whole reason this file exists: the three
 * quotas are enforced literally — "finishing an 11th checkup on a bike that
 * already has 10 lists returns TOO_MANY" — and "the wizard must show that
 * error, never fail silently". Before W4 the wizard ignored
 * `finishCheckupAction`'s answer and navigated to a list that was never
 * written.
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

/** A user whose gravel bike already holds `lists` (empty) build lists. */
async function bikeAtListQuota(
  label: string,
  locale: Locale,
): Promise<{ user: { id: string; email: string; locale: Locale }; bikeId: string }> {
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
    for (let n = 1; n <= LISTS_PER_BIKE; n += 1) {
      await client.query(
        `INSERT INTO "BuildList" ("bikeId", name, "updatedAt") VALUES ($1, $2, now())`,
        [bikeId, `Liste ${n}`],
      );
    }
    return { user: { id: userId, email, locale }, bikeId };
  });
}

/** What the database holds for the bike after the refusal. */
async function bikeState(bikeId: string): Promise<{
  lists: number;
  completed: number;
  chainLines: number;
}> {
  return withDb(async (client) => {
    const count = async (sql: string): Promise<number> =>
      Number((await client.query<{ n: string }>(sql, [bikeId])).rows[0].n);
    return {
      lists: await count(`SELECT count(*) AS n FROM "BuildList" WHERE "bikeId" = $1`),
      completed: await count(
        `SELECT count(*) AS n FROM "Checkup" WHERE "bikeId" = $1 AND status = 'COMPLETED'`,
      ),
      chainLines: await count(
        `SELECT count(*) AS n FROM "BuildListItem" i JOIN "BuildList" l ON l.id = i."buildListId"
         WHERE l."bikeId" = $1 AND i."partId" = 'chain'`,
      ),
    };
  });
}

forEachLocale((locale) => {
  test(`finishing a checkup on a bike with 10 lists is refused out loud, and nothing is written (${locale})`, async ({
    page,
    signedInContext,
  }, testInfo) => {
    const { user, bikeId } = await bikeAtListQuota(`${locale}-${testInfo.project.name}`, locale);
    await signedInContext(user);
    const checkupUrl = href(locale, "/velo/[id]/controle", { id: bikeId }, { parts: "chain" });
    await page.goto(checkupUrl);

    // A KO with its symptom: the line this checkup would put on a list.
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
      chainLines: 0,
    });
  });
});
