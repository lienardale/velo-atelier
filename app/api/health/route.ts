/**
 * `GET /api/health` — liveness plus a real database round-trip.
 *
 * Three callers depend on this endpoint, which is why it does an actual query
 * rather than returning a constant:
 *   - the CI **boot check**: `next build` then `next start`, then curl this.
 *     It is the tripwire for the Turbopack + Prisma 7 external-package
 *     resolution bug (prisma/prisma#29025) — a build that cannot load the
 *     generated client compiles fine and only fails when a query runs;
 *   - Playwright's `webServer.url`, so the suite starts on a server that can
 *     actually reach its database;
 *   - production and preview smoke checks (§4.8.7).
 *
 * It reports status only. No version, no host, no error text: the body is
 * public, and "which database driver failed how" is not.
 */

import { NextResponse } from "next/server";

import { prisma } from "@/lib/db/prisma";

/** Never prerendered, never cached — a cached health check is not one. */
export const dynamic = "force-dynamic";
export const revalidate = 0;

interface HealthBody {
  ok: boolean;
  db: boolean;
}

export async function GET(): Promise<NextResponse<HealthBody>> {
  let db = false;
  try {
    await prisma.$queryRaw`SELECT 1`;
    db = true;
  } catch (error) {
    // Logged server-side (where it is safe to be specific), never returned.
    console.error("[health] database check failed", error);
  }

  return NextResponse.json(
    { ok: db, db },
    {
      status: db ? 200 : 503,
      headers: { "Cache-Control": "no-store, max-age=0" },
    },
  );
}
