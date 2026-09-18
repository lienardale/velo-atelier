/**
 * `loadBikeForRequest` — the read every `/velo/[id]` page starts with, and the
 * N+1 guard of §7.3.
 *
 * Two properties are pinned here because both fail silently in production:
 *
 *  1. **The query budget.** The `/velo/[id]` data load stays at or under three
 *     queries. The recording fake counts them (`countQueries`), so a future
 *     `parts.map(async …)` fails this test instead of making the bike page 40
 *     round-trips slower for someone with 40 parts.
 *  2. **Ownership is in the `where`.** `expectScopedToUser` refuses a read that
 *     fetches a row and checks `userId` afterwards — the shape one refactor
 *     away from an IDOR (§4.7). A foreign id must find nothing, and nothing is
 *     404, never 403.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

import { loadBikeForRequest, loadDemoBike, loadLocalBike } from "@/lib/bike/load-bike";
import { encodeSpec } from "@/lib/bike/spec-codec";
import { deriveBike } from "@/lib/bike/rules";
import { BIKE_PRESETS, DEMO_PRESET_ID } from "@/lib/domain/data/presets";
import { validateBuild } from "@/lib/domain/engine/validate-build";
import { countQueries, expectQueryBudget } from "@/tests/_fakes/db";
import { expectScopedToUser, fakeDb } from "@/tests/_fakes/prisma";

/** The budget of §7.3 for one `/velo/[id]` data load. */
const QUERY_BUDGET = 3;

class NotFound extends Error {}
const onMissing = (): never => {
  throw new NotFound("notFound()");
};

const OWNER = "11111111-1111-4111-8111-111111111111";
const STRANGER = "22222222-2222-4222-8222-222222222222";

async function seedBike(userId: string): Promise<{ id: string }> {
  const user = (await fakeDb.seed("User", {
    id: userId,
    email: `${userId}@velo-atelier.test`,
    locale: "fr",
  })) as { id: string };
  const derived = deriveBike(BIKE_PRESETS["gravel-1x11"]);
  const bike = (await fakeDb.seed("Bike", {
    userId: user.id,
    name: "Gravel",
    answers: derived.answers,
    spec: derived.spec,
    parts: derived.parts,
    fit: { saddleHeightMm: 742 },
  })) as { id: string };
  for (const part of derived.parts) {
    await fakeDb.seed("BikePartState", { bikeId: bike.id, partId: part.partId, status: "UNKNOWN" });
  }
  return bike;
}

beforeEach(() => {
  fakeDb.reset();
});

describe("demo", () => {
  it("is the gravel preset, read-only, with no request API and no query", async () => {
    const loaded = await loadBikeForRequest({ kind: "demo" });

    expect(loaded.canEdit).toBe(false);
    expect(loaded.bikeId).toBeNull();
    expect(loaded.answers).toEqual(deriveBike(BIKE_PRESETS[DEMO_PRESET_ID]).answers);
    expect(validateBuild(loaded.build).ok).toBe(true);
    expect(countQueries(fakeDb.calls)).toBe(0);
  });

  it("is identical however it is reached", async () => {
    expect(await loadBikeForRequest({ kind: "demo" })).toEqual(loadDemoBike());
  });
});

describe("local", () => {
  it("knows nothing without a spec code — the client hydrates", async () => {
    const loaded = await loadBikeForRequest({ kind: "local" });
    expect(loaded.build).toBeNull();
    expect(loaded.answers).toBeNull();
    expect(loaded.canEdit).toBe(true);
    expect(countQueries(fakeDb.calls)).toBe(0);
  });

  it("resolves the bike from ?spec= on a server-planned route", async () => {
    const code = encodeSpec(BIKE_PRESETS["mtb-hardtail-1x12"]);
    const loaded = await loadBikeForRequest({ kind: "local" }, { specCode: code });

    expect(loaded.build).not.toBeNull();
    expect(loaded.build!.spec.discipline).toBe("mtb");
    expect(validateBuild(loaded.build).ok).toBe(true);
  });

  it("ignores a forged spec code rather than guessing", async () => {
    expect(loadLocalBike("../../etc").build).toBeNull();
    expect(loadLocalBike("").build).toBeNull();
    expect((await loadBikeForRequest({ kind: "local" }, { specCode: 42 })).build).toBeNull();
  });
});

describe("db", () => {
  it("loads the owner's bike inside the query budget", async () => {
    const bike = await seedBike(OWNER);
    fakeDb.resetCalls();

    const loaded = await loadBikeForRequest(
      { kind: "db", id: bike.id },
      {
        getUser: async () => ({ id: OWNER }),
        prisma: fakeDb.client as never,
        onMissing,
      },
    );

    expect(loaded.bikeId).toBe(bike.id);
    expect(loaded.name).toBe("Gravel");
    expect(loaded.canEdit).toBe(true);
    expect(loaded.fit).toEqual({ saddleHeightMm: 742 });
    expect(validateBuild(loaded.build).ok).toBe(true);
    expect(loaded.statuses["chain"]).toBe("UNKNOWN");

    expectQueryBudget(countQueries(fakeDb.calls), QUERY_BUDGET, "/velo/[id] data load");
    expect(countQueries(fakeDb.calls)).toBeLessThanOrEqual(QUERY_BUDGET);
  });

  it("carries the owner in the where clause of every query", async () => {
    const bike = await seedBike(OWNER);
    fakeDb.resetCalls();

    await loadBikeForRequest(
      { kind: "db", id: bike.id },
      { getUser: async () => ({ id: OWNER }), prisma: fakeDb.client as never, onMissing },
    );

    expectScopedToUser(fakeDb.calls, OWNER);
  });

  it("answers 404 for another user's bike — never 403, never the row", async () => {
    const bike = await seedBike(OWNER);
    await seedBike(STRANGER);

    await expect(
      loadBikeForRequest(
        { kind: "db", id: bike.id },
        { getUser: async () => ({ id: STRANGER }), prisma: fakeDb.client as never, onMissing },
      ),
    ).rejects.toBeInstanceOf(NotFound);
  });

  it("answers 404 for an anonymous visitor, before touching the database", async () => {
    const bike = await seedBike(OWNER);
    fakeDb.resetCalls();

    await expect(
      loadBikeForRequest(
        { kind: "db", id: bike.id },
        { getUser: async () => null, prisma: fakeDb.client as never, onMissing },
      ),
    ).rejects.toBeInstanceOf(NotFound);
    expect(countQueries(fakeDb.calls)).toBe(0);
  });

  it("does not ask who the caller is for demo or local", async () => {
    const getUser = vi.fn(async () => ({ id: OWNER }));
    await loadBikeForRequest({ kind: "demo" }, { getUser });
    await loadBikeForRequest({ kind: "local" }, { getUser });
    expect(getUser).not.toHaveBeenCalled();
  });

  it("re-derives the build from the stored answers, not from the cached parts", async () => {
    const user = (await fakeDb.seed("User", {
      id: OWNER,
      email: "owner@velo-atelier.test",
      locale: "fr",
    })) as { id: string };
    const derived = deriveBike(BIKE_PRESETS["road-disc-2x12"]);
    // A cache written by an older release: the answers say disc, `parts` say rim.
    const bike = (await fakeDb.seed("Bike", {
      userId: user.id,
      name: "Route",
      answers: derived.answers,
      spec: deriveBike(BIKE_PRESETS["road-rim-2x11"]).spec,
      parts: deriveBike(BIKE_PRESETS["road-rim-2x11"]).parts,
      fit: null,
    })) as { id: string };

    const loaded = await loadBikeForRequest(
      { kind: "db", id: bike.id },
      { getUser: async () => ({ id: OWNER }), prisma: fakeDb.client as never, onMissing },
    );

    expect(loaded.build!.spec.brakes.isDisc).toBe(true);
    expect(validateBuild(loaded.build).ok).toBe(true);
  });

  it("404s a row whose answers are not answers at all", async () => {
    const user = (await fakeDb.seed("User", {
      id: OWNER,
      email: "owner@velo-atelier.test",
      locale: "fr",
    })) as { id: string };
    const bike = (await fakeDb.seed("Bike", {
      userId: user.id,
      name: "Cassé",
      answers: "not-an-object",
      spec: {},
      parts: [],
      fit: null,
    })) as { id: string };

    await expect(
      loadBikeForRequest(
        { kind: "db", id: bike.id },
        { getUser: async () => ({ id: OWNER }), prisma: fakeDb.client as never, onMissing },
      ),
    ).rejects.toBeInstanceOf(NotFound);
  });
});
