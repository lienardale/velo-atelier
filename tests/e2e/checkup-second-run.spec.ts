/**
 * A saved bike's SECOND checkup is a run of its own (§4.2 b–c, §5.4, §6.7).
 *
 * The server knows a run by its `startedAt` (`existingCheckup` in
 * `controle/actions.ts`): the same `startedAt` again is the same checkup
 * finished again, which is how an edited verdict updates its own list. Until
 * the W4 review the wizard built the checkup it opens after a finished one
 * with the finished one's `startedAt`, so on an account the second checkup was
 * written INTO the first: its first autosave overwrote the first run's
 * verdicts, finishing deleted the line the first run had put on the list
 * instead of closing it `recheck-ok`, and the bike never got a second
 * `Checkup` or `BuildList` row — the 50-checkup and 10-list quotas (§4.2 c)
 * could never be reached from the UI. Every lower tier hands the server two
 * hand-picked dates; only the browser builds the payload, so only this row
 * covers what it sends.
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

async function withDb<T>(run: (client: Client) => Promise<T>): Promise<T> {
  const client = new Client({ connectionString: resolveTestEnv().POSTGRES_URL });
  await client.connect();
  try {
    return await run(client);
  } finally {
    await client.end();
  }
}

/** A user with one gravel bike and no checkup yet. */
async function ownGravelBike(
  label: string,
  locale: Locale,
): Promise<{ user: { id: string; email: string; locale: Locale }; bikeId: string }> {
  return withDb(async (client) => {
    const email = `second-run+${label}@velo-atelier.test`;
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
    return { user: { id: userId, email, locale }, bikeId: bikes[0].id };
  });
}

interface Run {
  status: string;
  chain: string | null;
  reasonKeys: string[] | null;
  lines: [string, string, boolean, string | null][];
}

/** The bike's checkups, oldest first: the chain verdict, and the lines of each run's list. */
async function runsOf(bikeId: string): Promise<Run[]> {
  return withDb(async (client) => {
    const { rows } = await client.query<{
      id: string;
      status: string;
      result: string | null;
      reason_keys: string[] | null;
    }>(
      `SELECT c.id, c.status, i.result, i."reasonKeys" AS reason_keys
         FROM "Checkup" c
         LEFT JOIN "CheckupItem" i ON i."checkupId" = c.id AND i."stepKey" = $2
        WHERE c."bikeId" = $1
        ORDER BY c."startedAt" ASC`,
      [bikeId, CHAIN_STEP],
    );
    const runs: Run[] = [];
    for (const row of rows) {
      const { rows: lines } = await client.query<{
        action: string;
        partId: string;
        done: boolean;
        doneReason: string | null;
      }>(
        `SELECT li.action, li."partId", li.done, li."doneReason"
           FROM "BuildListItem" li JOIN "BuildList" l ON l.id = li."buildListId"
          WHERE l."checkupId" = $1
          ORDER BY li."partId", li.action`,
        [row.id],
      );
      runs.push({
        status: row.status,
        chain: row.result,
        reasonKeys: row.reason_keys,
        lines: lines.map((line) => [line.action, line.partId, line.done, line.doneReason]),
      });
    }
    return runs;
  });
}

forEachLocale((locale) => {
  test(`a second checkup is a run of its own, and its OK closes the first run's line (${locale})`, async ({
    page,
    signedInContext,
  }, testInfo) => {
    const { user, bikeId } = await ownGravelBike(`${locale}-${testInfo.project.name}`, locale);
    await signedInContext(user);
    const checkupUrl = href(locale, "/velo/[id]/controle", { id: bikeId }, { parts: "chain" });
    const listPath = href(locale, "/velo/[id]/liste", { id: bikeId });

    // The first run: the chain is worn, and the list says to replace it.
    await page.goto(checkupUrl);
    await page.getByTestId("checkup-start").click();
    await expect(page.getByTestId("step-card")).toHaveAttribute("data-step-key", CHAIN_STEP);
    await page.getByTestId("verdict-ko").click();
    await page.getByTestId("symptom-chain-elongation").click();
    await page.getByTestId("summary-create").click();
    await page.waitForURL((url) => url.pathname === listPath);

    // The second run: a finished checkup is history, so the wizard opens a new
    // one on its tool list — and this time the chain is fine.
    await page.goto(checkupUrl);
    await expect(page.getByTestId("checkup-wizard")).toHaveAttribute("data-phase", "tools");
    await page.getByTestId("checkup-start").click();
    await expect(page.getByTestId("step-card")).toHaveAttribute("data-step-key", CHAIN_STEP);
    await page.getByTestId("verdict-ok").click();
    await page.getByTestId("summary-create").click();
    await page.waitForURL((url) => url.pathname === listPath);

    // Two rows, the first one untouched, and its line closed BY the second run.
    expect(await runsOf(bikeId)).toEqual([
      {
        status: "COMPLETED",
        chain: "KO",
        reasonKeys: ["chain-elongation"],
        lines: [["REPLACE", "chain", true, "recheck-ok"]],
      },
      { status: "COMPLETED", chain: "OK", reasonKeys: [], lines: [] },
    ]);
  });
});
