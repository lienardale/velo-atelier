/**
 * Playwright global setup — once per run, before the web server receives a
 * request that needs data.
 *
 * `.env.test` is loaded without overriding the process environment (the CI
 * e2e job runs in the Playwright container, where the database host is
 * `postgres`); anything that is not a local database named `*_test` is refused
 * before a connection is opened. Then: migrations applied, every table emptied,
 * demo seed loaded — so `DEMO_USER` can sign in and sign-up tests start from a
 * known state. See tests/_fakes/db.ts for why this is `migrate deploy` +
 * TRUNCATE rather than `migrate reset --force` (§7.2).
 */
import { prepareTestDatabase } from "../_fakes/db";

export default async function globalSetup(): Promise<void> {
  await prepareTestDatabase("playwright");
}
