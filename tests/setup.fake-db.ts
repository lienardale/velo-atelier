/**
 * Fake-database tiers (unit, ui, security): `@/lib/db/prisma` is the
 * recording in-memory fake from tests/_fakes/prisma.ts.
 *
 * Nothing in these tiers can open a socket to PostgreSQL — which is what lets
 * `npx vitest run --project unit --project ui --project bike3d --project security`
 * pass with Docker stopped (§7.6 AC2). Tables and the call log are emptied
 * after every test, so no test sees another's rows.
 *
 * A test that needs the module in a specific shape (e.g. a `$queryRaw` that
 * rejects) can still `vi.doMock("@/lib/db/prisma", …)` and re-import, as
 * tests/unit/api/health.test.ts does.
 */
import { afterEach, vi } from "vitest";

import { fakeDb } from "./_fakes/prisma";

vi.mock("@/lib/db/prisma", async () => {
  const { fakeDb: db } = await import("./_fakes/prisma");
  return {
    prisma: db.client,
    disconnectPrisma: async () => undefined,
  };
});

afterEach(() => {
  fakeDb.reset();
});
