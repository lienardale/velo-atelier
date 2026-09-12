/**
 * Integration tier — once per run, before any integration file.
 *
 * Guards the target (local host, database name ending in `_test`), waits for
 * PostgreSQL, applies every committed migration, empties every table and
 * loads the demo seed. See tests/_fakes/db.ts for why this is `migrate deploy`
 * + TRUNCATE rather than `migrate reset --force`.
 *
 * Only runs when the `integration` project is selected; the DB-less tiers never
 * reach it (verified: `--project unit` with Docker stopped does not call it).
 */
import { prepareTestDatabase } from "../_fakes/db";

export default async function setup(): Promise<void> {
  await prepareTestDatabase("vitest:integration");
}
