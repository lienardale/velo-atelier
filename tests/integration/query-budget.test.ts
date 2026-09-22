/**
 * The N+1 guard of §7.3, against real Postgres: the `/velo/[id]` data load and
 * those of its two server-planned sub-routes stay within three queries, and
 * none of them grows with the size of what it reads.
 *
 * `tests/unit/bike/load-bike.test.ts` counts the same loads against the
 * recording fake, one entry per delegate call. This tier counts what the REAL
 * client does, two ways:
 *
 *   operations  `countingClient` (`tests/_fakes/db.ts`) — a `$allOperations`
 *               query extension, one entry per model operation. The budget.
 *   statements  the client's own `query` log events — SQL actually sent. A
 *               nested `select` is one operation whatever it costs in SQL, so
 *               the budget cannot see a relation load that turned into one
 *               statement per row; comparing a one-line list with a
 *               thirty-line one can.
 */
import { PrismaPg } from "@prisma/adapter-pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { loadStoredCheckup } from "@/app/[locale]/velo/[id]/controle/load";
import { loadBuildList } from "@/app/[locale]/velo/[id]/liste/load";
import { loadBikeForRequest } from "@/lib/bike/load-bike";
import { deriveBike } from "@/lib/bike/rules";
import { getDatabaseUrls } from "@/lib/db/env";
import { BIKE_PRESETS } from "@/lib/domain/data/presets";
import { PrismaClient, type Prisma } from "@/lib/generated/prisma/client";
import { countingClient, expectQueryBudget } from "@/tests/_fakes/db";

/** §7.3: the `/velo/[id]` data load stays at or under three queries. */
const QUERY_BUDGET = 3;

/** A client of its own, emitting a `query` event per SQL statement. */
function loggingClient() {
  return new PrismaClient({
    adapter: new PrismaPg({ connectionString: getDatabaseUrls().direct, max: 1 }),
    log: [{ emit: "event", level: "query" }],
  });
}

let base: ReturnType<typeof loggingClient>;
const statements: string[] = [];

beforeAll(() => {
  base = loggingClient();
  base.$on("query", (event) => statements.push(event.query));
});

afterAll(async () => {
  await base?.$disconnect();
});

/** A user with a gravel bike, an in-progress checkup of `lines` answers, and a list of `lines` lines. */
async function seed(email: string, lines: number) {
  const derived = deriveBike(BIKE_PRESETS["gravel-1x11"]);
  const user = await base.user.create({ data: { email, locale: "fr" } });
  const bike = await base.bike.create({
    data: {
      userId: user.id,
      name: "Gravel",
      answers: derived.answers,
      spec: derived.spec,
      parts: derived.parts as unknown as Prisma.InputJsonValue,
      partStates: { create: derived.parts.map((part) => ({ partId: part.partId })) },
    },
  });
  const checkup = await base.checkup.create({ data: { bikeId: bike.id, scope: "FULL" } });
  const list = await base.buildList.create({
    data: { bikeId: bike.id, checkupId: checkup.id, name: "" },
  });
  for (const [index, part] of derived.parts.slice(0, lines).entries()) {
    const item = await base.checkupItem.create({
      data: {
        checkupId: checkup.id,
        stepKey: `check-drivetrain#step-${index}`,
        partId: part.partId,
        guideSlug: "check-drivetrain",
        result: "KO",
        reasonKeys: ["chain-elongation"],
      },
    });
    await base.buildListItem.create({
      data: {
        buildListId: list.id,
        checkupItemId: item.id,
        partId: part.partId,
        action: "REPLACE",
        reasonKey: "chain-elongation",
        sortOrder: index,
      },
    });
  }
  return { userId: user.id, bikeId: bike.id };
}

/** Run one route's data load through a counting client: operations and SQL statements. */
async function measure(
  load: (db: PrismaClient) => Promise<unknown>,
): Promise<{ operations: number; statements: number; models: (string | undefined)[] }> {
  const counter = countingClient(base);
  statements.length = 0;
  await load(counter.client);
  return {
    operations: counter.count(),
    statements: statements.length,
    models: counter.log.map((entry) => entry.model),
  };
}

const routes = {
  "/velo/[id]": (bikeId: string, userId: string) => (db: PrismaClient) =>
    loadBikeForRequest(
      { kind: "db", id: bikeId },
      {
        getUser: async () => ({ id: userId }),
        prisma: db as never,
        onMissing: () => {
          throw new Error("not found");
        },
      },
    ),
  "/velo/[id]/liste": (bikeId: string, userId: string) => async (db: PrismaClient) => {
    await routes["/velo/[id]"](bikeId, userId)(db);
    return loadBuildList(bikeId, userId, db);
  },
  "/velo/[id]/controle": (bikeId: string, userId: string) => async (db: PrismaClient) => {
    await routes["/velo/[id]"](bikeId, userId)(db);
    return loadStoredCheckup(bikeId, userId, "fr", db);
  },
} as const;

describe.each(Object.keys(routes) as (keyof typeof routes)[])("%s", (route) => {
  it("stays within the budget, and costs the same for thirty lines as for one", async () => {
    const small = await seed(`budget-1-${route.length}@velo-atelier.test`, 1);
    const large = await seed(`budget-30-${route.length}@velo-atelier.test`, 30);

    const one = await measure(routes[route](small.bikeId, small.userId));
    const thirty = await measure(routes[route](large.bikeId, large.userId));

    // The counter really saw the client work (verified on Prisma 7.10.0).
    expect(one.operations).toBeGreaterThan(0);
    expect(one.models.every((model) => typeof model === "string")).toBe(true);

    expectQueryBudget(thirty.operations, QUERY_BUDGET, `${route} data load`);
    expect(thirty.operations).toBe(one.operations);
    expect(thirty.statements, `${route}: SQL statements, 30 lines vs 1`).toBe(one.statements);
  });
});
