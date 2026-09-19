/**
 * `importGuestState` against the recording fake.
 *
 * The fake is driven by `prisma/schema.prisma` itself, so the constraints that
 * carry this feature — `@@unique([userId, guestLocalId])`, the unique
 * `Checkup.guestKey`, `@@unique([buildListId, partId, action])` — behave here
 * the way they behave in Postgres. `tests/integration/guest-import.test.ts` is
 * where the real database confirms it.
 *
 * What is proven here: the row shapes, the derivation rules, the idempotency,
 * the clamps, and what happens to the items the corpus has moved under.
 */
import { beforeEach, describe, expect, it } from "vitest";

import { fakeDb } from "@/tests/_fakes/prisma";
import { deriveBike, QUOTAS } from "@/lib/bike/rules";
import { BIKE_PRESETS } from "@/lib/domain/data/presets";
import { validateBuild } from "@/lib/domain/engine/validate-build";

import { guestCheckupKey, importGuestState } from "./import";
import { GUEST_STATE_VERSION, type GuestBike, type GuestState } from "./schema";

const NOW = Date.parse("2026-09-15T12:00:00.000Z");
const now = () => NOW;

const ANSWERS = BIKE_PRESETS["gravel-1x11"] as Record<string, string>;
const DERIVED = deriveBike(BIKE_PRESETS["gravel-1x11"]);
const LOCAL_ID = "11111111-2222-4333-8444-555555555555";
const CHECKUP_ID = "3f1d7a52-9c1e-4f2b-8d7a-0b4f2c6e1a90";

function guestBike(patch: Partial<GuestBike> = {}): GuestBike {
  return {
    localId: LOCAL_ID,
    name: "Mon vélo",
    answers: ANSWERS,
    parts: DERIVED.parts,
    fit: { saddleHeightMm: 742 },
    updatedAt: "2026-09-14T09:00:00.000Z",
    checkups: [],
    lists: [],
    ...patch,
  };
}

function state(...bikes: GuestBike[]): GuestState {
  return { version: GUEST_STATE_VERSION, bikes };
}

const COMPLETED_CHECKUP = {
  guestKey: CHECKUP_ID,
  scope: "parts" as const,
  startedAt: "2026-09-14T08:00:00.000Z",
  completedAt: "2026-09-14T08:20:00.000Z",
  items: [
    {
      stepKey: "check-drivetrain#chain-wear",
      partId: "chain",
      guideSlug: "check-drivetrain",
      result: "ko" as const,
      notes: "élongation 0,8 %",
    },
    {
      stepKey: "check-drivetrain#cassette-teeth",
      partId: "cassette",
      guideSlug: "check-drivetrain",
      result: "ok" as const,
    },
    {
      stepKey: "check-wheels-tires#tire-wear",
      partId: "tire-front",
      guideSlug: "check-wheels-tires",
      result: "skipped" as const,
    },
  ],
};

let userId: string;

beforeEach(async () => {
  fakeDb.reset();
  const user = (await fakeDb.seed("User", {
    email: "camille@velo-atelier.test",
    locale: "fr",
  })) as { id: string };
  userId = user.id;
  fakeDb.resetCalls();
});

describe("a bike", () => {
  it("is created with derived answers, spec and parts, and one part state each", async () => {
    const result = await importGuestState(fakeDb.client, userId, state(guestBike()), { now });
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.data).toMatchObject({ imported: 1, skipped: 0 });
    const [row] = fakeDb.rows("Bike") as Record<string, unknown>[];
    expect(row.userId).toBe(userId);
    expect(row.guestLocalId).toBe(LOCAL_ID);
    expect(row.name).toBe("Mon vélo");
    expect(row.answers).toEqual(DERIVED.answers);
    expect(row.spec).toEqual(DERIVED.spec);
    expect(validateBuild({ spec: row.spec, parts: row.parts }).ok).toBe(true);
    expect(fakeDb.rows("BikePartState")).toHaveLength(DERIVED.parts.length);
    expect(row.fit).toEqual({ saddleHeightMm: 742 });
  });

  it("keeps the owner's attribute edits", async () => {
    const edited = DERIVED.parts.map((part) =>
      part.partId === "chainring" ? { ...part, attributes: { teeth: 42 } } : part,
    );
    await importGuestState(fakeDb.client, userId, state(guestBike({ parts: edited })), { now });

    const [row] = fakeDb.rows("Bike") as {
      parts: { partId: string; attributes: Record<string, unknown> }[];
    }[];
    expect(row.parts.find((part) => part.partId === "chainring")?.attributes.teeth).toBe(42);
  });

  it("keeps none of them when the build as a whole is not one this bike could have", async () => {
    // `validateBuild` is the only entry for supplied parts (§1.2), and it is
    // all-or-nothing: an attribute key that belongs to no part makes the whole
    // build untrusted, and the defaults for this spec are used instead.
    const edited = DERIVED.parts.map((part) =>
      part.partId === "chainring"
        ? { ...part, attributes: { teeth: 42, "not-an-attribute": "x" } }
        : part,
    );
    await importGuestState(fakeDb.client, userId, state(guestBike({ parts: edited })), { now });

    const [row] = fakeDb.rows("Bike") as { parts: unknown[] }[];
    expect(row.parts).toEqual(DERIVED.parts);
  });

  it("falls back to the default parts when the payload's build is not valid", async () => {
    const result = await importGuestState(
      fakeDb.client,
      userId,
      state(guestBike({ parts: [{ partId: "__proto__", attributes: {} }] })),
      { now },
    );
    expect(result.ok).toBe(true);
    const [row] = fakeDb.rows("Bike") as { parts: unknown[] }[];
    expect(row.parts).toEqual(DERIVED.parts);
  });

  it("drops a fit measurement it does not recognise instead of refusing the bike", async () => {
    await importGuestState(
      fakeDb.client,
      userId,
      state(guestBike({ fit: { saddleHeightMm: 742, nope: 1, reachMm: 99_999 } })),
      { now },
    );
    const [row] = fakeDb.rows("Bike") as Record<string, unknown>[];
    expect(row.fit).toEqual({ saddleHeightMm: 742 });
  });

  it("stores no fit at all when nothing survives", async () => {
    await importGuestState(fakeDb.client, userId, state(guestBike({ fit: { nope: 1 } })), { now });
    expect((fakeDb.rows("Bike")[0] as Record<string, unknown>).fit).toBeNull();
  });

  it("never stores a date the visitor's clock put in the future (§4.7)", async () => {
    const ahead = guestBike({ updatedAt: "2087-01-01T00:00:00.000Z" });
    await importGuestState(fakeDb.client, userId, state(ahead), { now });
    const [row] = fakeDb.rows("Bike") as { updatedAt: Date }[];
    expect(row.updatedAt.getTime()).toBe(NOW);
  });
});

describe("importing twice", () => {
  it("skips a bike this account already imported, and writes nothing", async () => {
    const first = await importGuestState(fakeDb.client, userId, state(guestBike()), { now });
    expect(first.ok && first.data.imported).toBe(1);
    const before = fakeDb.rows("Bike")[0] as Record<string, unknown>;

    // The laptop's copy: same guest bike, older, with a checkup the phone never had.
    const stale = guestBike({
      name: "Autre nom",
      updatedAt: "2026-01-01T00:00:00.000Z",
      checkups: [COMPLETED_CHECKUP],
    });
    const second = await importGuestState(fakeDb.client, userId, state(stale), { now });

    expect(second.ok).toBe(true);
    if (!second.ok) return;
    expect(second.data).toMatchObject({ imported: 0, skipped: 1, bikeId: before.id });
    expect(second.data.bikes[0].skipped).toBe("already-imported");
    expect(fakeDb.rows("Bike")).toHaveLength(1);
    expect(fakeDb.rows("Bike")[0]).toEqual(before);
    expect(fakeDb.rows("Checkup")).toHaveLength(0);
  });

  it("lets another account import the same browser's bike", async () => {
    const other = (await fakeDb.seed("User", { email: "autre@velo-atelier.test" })) as {
      id: string;
    };
    await importGuestState(
      fakeDb.client,
      userId,
      state(guestBike({ checkups: [COMPLETED_CHECKUP] })),
      { now },
    );
    const second = await importGuestState(
      fakeDb.client,
      other.id,
      state(guestBike({ checkups: [COMPLETED_CHECKUP] })),
      { now },
    );

    expect(second.ok && second.data.imported).toBe(1);
    expect(fakeDb.rows("Bike")).toHaveLength(2);
    // The globally unique `Checkup.guestKey` is scoped by user, or this second
    // import would have collided on a row it cannot see.
    expect((fakeDb.rows("Checkup") as { guestKey: string }[]).map((row) => row.guestKey)).toEqual([
      guestCheckupKey(userId, CHECKUP_ID),
      guestCheckupKey(other.id, CHECKUP_ID),
    ]);
  });

  it("reports what the winner wrote when two devices race", async () => {
    // A row created between the ownership read and the create: exactly what the
    // unique constraint is there to catch.
    const racer = { ...guestBike(), localId: LOCAL_ID };
    await fakeDb.seed("Bike", {
      userId,
      name: "Posé par l'autre appareil",
      answers: DERIVED.answers,
      spec: DERIVED.spec,
      parts: DERIVED.parts,
      guestLocalId: LOCAL_ID,
    });

    const result = await importGuestState(fakeDb.client, userId, state(racer), { now });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.bikes[0].skipped).toBe("already-imported");
    expect(fakeDb.rows("Bike")).toHaveLength(1);
  });
});

describe("checkups", () => {
  it("become a checkup and its items, with a user-scoped idempotency key", async () => {
    await importGuestState(
      fakeDb.client,
      userId,
      state(guestBike({ checkups: [COMPLETED_CHECKUP] })),
      { now },
    );

    const [checkup] = fakeDb.rows("Checkup") as Record<string, unknown>[];
    expect(checkup.guestKey).toBe(guestCheckupKey(userId, CHECKUP_ID));
    expect(checkup.scope).toBe("PARTIAL");
    expect(checkup.status).toBe("COMPLETED");
    expect((checkup.completedAt as Date).toISOString()).toBe(COMPLETED_CHECKUP.completedAt);

    const items = fakeDb.rows("CheckupItem") as Record<string, unknown>[];
    expect(items.map((item) => item.result)).toEqual(["KO", "OK", "SKIPPED"]);
    expect(items[0].notes).toBe("élongation 0,8 %");
  });

  it("is IN_PROGRESS while it has no end", async () => {
    const running = { ...COMPLETED_CHECKUP, completedAt: undefined, scope: "full" as const };
    await importGuestState(fakeDb.client, userId, state(guestBike({ checkups: [running] })), {
      now,
    });
    const [checkup] = fakeDb.rows("Checkup") as Record<string, unknown>[];
    expect(checkup.status).toBe("IN_PROGRESS");
    expect(checkup.scope).toBe("FULL");
    expect(checkup.completedAt).toBeNull();
  });

  it("clamps both ends, and never finishes before it started", async () => {
    const skewed = {
      ...COMPLETED_CHECKUP,
      startedAt: "2087-01-01T00:00:00.000Z",
      completedAt: "2000-01-01T00:00:00.000Z",
    };
    await importGuestState(fakeDb.client, userId, state(guestBike({ checkups: [skewed] })), {
      now,
    });
    const [checkup] = fakeDb.rows("Checkup") as { startedAt: Date; completedAt: Date }[];
    expect(checkup.startedAt.getTime()).toBe(NOW);
    expect(checkup.completedAt.getTime()).toBe(NOW);
  });

  it("drops an item whose part the catalogue no longer has, and keeps the rest", async () => {
    const stale = {
      ...COMPLETED_CHECKUP,
      items: [
        ...COMPLETED_CHECKUP.items,
        {
          stepKey: "check-drivetrain#gone",
          partId: "part-from-2019",
          guideSlug: "check-drivetrain",
          result: "ko" as const,
        },
      ],
    };
    await importGuestState(fakeDb.client, userId, state(guestBike({ checkups: [stale] })), {
      now,
    });
    expect(fakeDb.rows("CheckupItem")).toHaveLength(3);
  });

  it("writes one row for a step key the payload repeats", async () => {
    const duplicated = {
      ...COMPLETED_CHECKUP,
      items: [COMPLETED_CHECKUP.items[0], { ...COMPLETED_CHECKUP.items[0], result: "ok" as const }],
    };
    await importGuestState(fakeDb.client, userId, state(guestBike({ checkups: [duplicated] })), {
      now,
    });
    expect(fakeDb.rows("CheckupItem")).toHaveLength(1);
  });

  it("applies §4.2 b: a finished checkup leaves its parts BROKEN or serviced", async () => {
    await importGuestState(
      fakeDb.client,
      userId,
      state(guestBike({ checkups: [COMPLETED_CHECKUP] })),
      { now },
    );
    const states = new Map(
      (
        fakeDb.rows("BikePartState") as {
          partId: string;
          status: string;
          lastServicedAt: Date | null;
        }[]
      ).map((row) => [row.partId, row]),
    );
    expect(states.get("chain")?.status).toBe("BROKEN");
    expect(states.get("cassette")?.status).toBe("OK");
    expect(states.get("cassette")?.lastServicedAt?.toISOString()).toBe(
      COMPLETED_CHECKUP.completedAt,
    );
    // SKIPPED says nothing about the part.
    expect(states.get("tire-front")?.status).toBe("UNKNOWN");
  });

  it("leaves the parts alone while the checkup is unfinished", async () => {
    const running = { ...COMPLETED_CHECKUP, completedAt: undefined };
    await importGuestState(fakeDb.client, userId, state(guestBike({ checkups: [running] })), {
      now,
    });
    const statuses = new Set(
      (fakeDb.rows("BikePartState") as { status: string }[]).map((row) => row.status),
    );
    expect(statuses).toEqual(new Set(["UNKNOWN"]));
  });
});

describe("build lists", () => {
  const list = {
    name: "Révision printemps",
    items: [
      {
        partId: "chain",
        action: "replace" as const,
        reasonKey: "chain-elongation",
        guideSlug: "replace-chain",
        done: false,
        sortOrder: 0,
      },
      {
        partId: "chain",
        action: "clean" as const,
        reasonKey: "chain-dirty",
        guideSlug: "clean-drivetrain",
        done: true,
        sortOrder: 1,
        refinement: { speeds: "11" },
        chosenProduct: {
          brand: "Shimano",
          model: "CN-HG601",
          size: "11v",
          vendor: "alltricks",
          url: "https://www.alltricks.fr/chaine",
        },
      },
    ],
  };

  it("become a list and its items, with the domain's actions in the database's vocabulary", async () => {
    await importGuestState(fakeDb.client, userId, state(guestBike({ lists: [list] })), { now });

    const [row] = fakeDb.rows("BuildList") as Record<string, unknown>[];
    expect(row.name).toBe("Révision printemps");
    expect(row.status).toBe("OPEN");
    expect(row.checkupId).toBeNull();

    const items = fakeDb.rows("BuildListItem") as Record<string, unknown>[];
    expect(items.map((item) => item.action)).toEqual(["REPLACE", "CLEAN"]);
    expect(items[1].done).toBe(true);
    expect(items[1].refinement).toEqual({ speeds: "11" });
    expect(items[1].chosenProduct).toMatchObject({ vendor: "alltricks" });
  });

  it("writes one row per (part, action) — the pair is unique per list", async () => {
    const duplicated = { ...list, items: [list.items[0], { ...list.items[0], done: true }] };
    await importGuestState(fakeDb.client, userId, state(guestBike({ lists: [duplicated] })), {
      now,
    });
    expect(fakeDb.rows("BuildListItem")).toHaveLength(1);
  });

  it("drops a line about a part the catalogue no longer has", async () => {
    const stale = {
      ...list,
      items: [{ ...list.items[0], partId: "part-from-2019" }],
    };
    await importGuestState(fakeDb.client, userId, state(guestBike({ lists: [stale] })), { now });
    expect(fakeDb.rows("BuildListItem")).toHaveLength(0);
  });
});

describe("quotas", () => {
  it("refuses TOO_MANY rather than the twenty-first bike, and writes nothing", async () => {
    for (let index = 0; index < QUOTAS.bikesPerUser; index++) {
      await fakeDb.seed("Bike", {
        userId,
        name: `Vélo ${index}`,
        answers: DERIVED.answers,
        spec: DERIVED.spec,
        parts: DERIVED.parts,
      });
    }
    fakeDb.resetCalls();

    const result = await importGuestState(fakeDb.client, userId, state(guestBike()), { now });
    expect(result).toEqual({ ok: false, code: "TOO_MANY" });
    expect(fakeDb.rows("Bike")).toHaveLength(QUOTAS.bikesPerUser);
    expect(fakeDb.calls.filter((call) => call.op === "create")).toHaveLength(0);
  });

  it("counts only this account's bikes", async () => {
    const other = (await fakeDb.seed("User", { email: "voisin@velo-atelier.test" })) as {
      id: string;
    };
    for (let index = 0; index < QUOTAS.bikesPerUser + 5; index++) {
      await fakeDb.seed("Bike", {
        userId: other.id,
        name: `Vélo ${index}`,
        answers: DERIVED.answers,
        spec: DERIVED.spec,
        parts: DERIVED.parts,
      });
    }
    const result = await importGuestState(fakeDb.client, userId, state(guestBike()), { now });
    expect(result.ok).toBe(true);
  });
});

describe("an empty payload", () => {
  it("is a success that imported nothing", async () => {
    const result = await importGuestState(fakeDb.client, userId, state(), { now });
    expect(result).toEqual({
      ok: true,
      data: { bikeId: null, bikes: [], imported: 0, skipped: 0 },
    });
  });
});
