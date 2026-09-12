/**
 * `GET /api/health` — both outcomes, without a database.
 *
 * The happy path against a real server is the CI boot check (`next build`,
 * `next start`, `curl /api/health`). This file covers what that job cannot
 * easily provoke: the database being down, and the guarantee that the public
 * body then says *that* it failed but never *how*.
 *
 * `vi.doMock` + a fresh import per case, so the result does not depend on
 * whatever `tests/setup.fake-db.ts` registers for `@/lib/db/prisma`.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const queryRaw = vi.fn();

async function loadRoute() {
  vi.resetModules();
  vi.doMock("@/lib/db/prisma", () => ({ prisma: { $queryRaw: queryRaw } }));
  return import("@/app/api/health/route");
}

beforeEach(() => {
  queryRaw.mockReset();
  vi.spyOn(console, "error").mockImplementation(() => undefined);
});

afterEach(() => {
  vi.doUnmock("@/lib/db/prisma");
  vi.restoreAllMocks();
});

describe("GET /api/health", () => {
  it("is never cached or prerendered", async () => {
    const route = await loadRoute();
    expect(route.dynamic).toBe("force-dynamic");
    expect(route.revalidate).toBe(0);
  });

  it("returns 200 {ok:true, db:true} when the database answers", async () => {
    queryRaw.mockResolvedValue([{ "?column?": 1 }]);
    const { GET } = await loadRoute();

    const response = await GET();

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true, db: true });
    expect(response.headers.get("cache-control")).toContain("no-store");
    expect(queryRaw).toHaveBeenCalledTimes(1);
  });

  it("returns 503 {ok:false, db:false} when the database does not", async () => {
    queryRaw.mockRejectedValue(
      new Error("connect ECONNREFUSED 10.1.2.3:5432 (password authentication failed)"),
    );
    const { GET } = await loadRoute();

    const response = await GET();
    const body = await response.json();

    expect(response.status).toBe(503);
    expect(body).toEqual({ ok: false, db: false });
  });

  it("does not leak the failure detail in the public body", async () => {
    queryRaw.mockRejectedValue(new Error("connect ECONNREFUSED 10.1.2.3:5432"));
    const { GET } = await loadRoute();

    const text = await (await GET()).text();

    expect(text).not.toMatch(/ECONNREFUSED|10\.1\.2\.3|5432/);
    // …but it is logged server-side, where an operator can act on it.
    expect(console.error).toHaveBeenCalled();
  });
});
