/**
 * The guest import against the real `_test` database (§4.8 AC6).
 *
 * The recording fake already proves the shapes. What only PostgreSQL can settle
 * is everything the schema declares and the fake imitates:
 *
 *   - `@@unique([userId, guestLocalId])` — the constraint the whole feature
 *     rests on. Importing the same browser twice is one row, and two accounts
 *     may hold the same guest id (a shared laptop).
 *   - `Checkup.guestKey` is **globally** unique, not unique per bike. That is
 *     why the import stores `${userId}:${stateId}`: with the bare state id, the
 *     second person to import from one browser would collide on a row they
 *     cannot see. This file is where that is more than an assertion about our
 *     own code.
 *   - `@@unique([checkupId, stepKey])` and `@@unique([buildListId, partId,
 *     action])`, which is what makes a payload that repeats itself one row.
 *   - `onDelete: Cascade` all the way down from `Bike`: an imported bike
 *     deleted from `/mes-velos` must leave no checkup, item, list or part state
 *     behind.
 *   - The `Json` round trip: `spec` and `parts` written as objects come back as
 *     objects that `validateBuild` still accepts.
 *   - **(verify)** whether Prisma 7 honours an explicit value for a field
 *     carrying `@updatedAt` on `create`. The import writes the guest's own
 *     `updatedAt` (clamped), so that `/mes-velos` orders an imported bike by
 *     when it was last touched rather than by when it arrived.
 *
 * One test goes through `importGuestStateAction` so the whole path — session,
 * origin, schema, rate limit, writes — is exercised once against a real
 * database. The rest drive `importGuestState` directly: the action's bucket is
 * three an hour per user, and a test suite is not a visitor.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

import { prisma } from "@/lib/db/prisma";
import {
  sameOriginHeaders,
  sessionFor,
  setRequestHeaders,
  setSession,
} from "@/tests/_fakes/session";

vi.mock("@/auth", async () => (await import("@/tests/_fakes/session")).authModule());

const { importGuestStateAction } = await import("@/app/[locale]/(protected)/import/actions");
const { guestCheckupKey, importGuestState } = await import("@/lib/guest/import");
const { GUEST_STATE_VERSION } = await import("@/lib/guest/schema");
const { deriveBike } = await import("@/lib/bike/rules");
const { BIKE_PRESETS } = await import("@/lib/domain/data/presets");
const { validateBuild } = await import("@/lib/domain/engine/validate-build");

type GuestBike = import("@/lib/guest/schema").GuestBike;
type GuestState = import("@/lib/guest/schema").GuestState;

const DERIVED = deriveBike(BIKE_PRESETS["gravel-1x11"]);
const ANSWERS = BIKE_PRESETS["gravel-1x11"] as Record<string, string>;
const LOCAL_ID = "11111111-2222-4333-8444-555555555555";
const CHECKUP_ID = "3f1d7a52-9c1e-4f2b-8d7a-0b4f2c6e1a90";
const GUEST_UPDATED_AT = "2026-09-14T09:00:00.000Z";

const CHECKUP = {
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
  ],
};

const LIST = {
  name: "Révision printemps",
  items: [
    {
      partId: "chain",
      action: "replace" as const,
      reasonKey: "chain-elongation",
      guideSlug: "replace-chain",
      done: false,
      sortOrder: 0,
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

function guestBike(patch: Partial<GuestBike> = {}): GuestBike {
  return {
    localId: LOCAL_ID,
    name: "Mon vélo",
    answers: ANSWERS,
    parts: DERIVED.parts,
    fit: { saddleHeightMm: 742 },
    updatedAt: GUEST_UPDATED_AT,
    checkups: [CHECKUP],
    lists: [LIST],
    ...patch,
  };
}

function state(...bikes: GuestBike[]): GuestState {
  return { version: GUEST_STATE_VERSION, bikes };
}

async function signedInUser(email: string) {
  const user = await prisma.user.create({ data: { email, name: "Camille", locale: "fr" } });
  setSession(sessionFor({ id: user.id, email: user.email, name: user.name, locale: "fr" }));
  return user;
}

beforeEach(() => {
  setRequestHeaders(sameOriginHeaders());
});

describe("importGuestStateAction end to end", () => {
  it("creates the bike, its part states, its checkup and its list in one call", async () => {
    const user = await signedInUser("import-action@velo-atelier.test");

    const result = await importGuestStateAction(state(guestBike()));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.imported).toBe(1);

    const row = await prisma.bike.findUniqueOrThrow({
      where: { id: result.data.bikeId ?? "" },
      include: {
        partStates: true,
        checkups: { include: { items: true } },
        buildLists: { include: { items: true } },
      },
    });

    expect(row.userId).toBe(user.id);
    expect(row.guestLocalId).toBe(LOCAL_ID);
    expect(row.fit).toEqual({ saddleHeightMm: 742 });
    // The Json round trip: objects in, objects out, and the domain still agrees.
    expect(validateBuild({ spec: row.spec, parts: row.parts }).ok).toBe(true);
    expect(row.partStates).toHaveLength((row.parts as unknown[]).length);

    const [checkup] = row.checkups;
    expect(checkup.guestKey).toBe(guestCheckupKey(user.id, CHECKUP_ID));
    expect(checkup.scope).toBe("PARTIAL");
    expect(checkup.status).toBe("COMPLETED");
    expect(checkup.items).toHaveLength(2);
    expect(checkup.items.find((item) => item.partId === "chain")?.result).toBe("KO");

    const [list] = row.buildLists;
    expect(list.name).toBe("Révision printemps");
    expect(list.checkupId).toBeNull();
    expect(list.items[0].action).toBe("REPLACE");
    expect(list.items[0].chosenProduct).toMatchObject({ vendor: "alltricks" });

    // §4.2 b: a finished checkup leaves its parts BROKEN or serviced.
    const states = new Map(row.partStates.map((partState) => [partState.partId, partState]));
    expect(states.get("chain")?.status).toBe("BROKEN");
    expect(states.get("cassette")?.status).toBe("OK");
    expect(states.get("cassette")?.lastServicedAt?.toISOString()).toBe(CHECKUP.completedAt);
  });

  it("keeps the guest's own updatedAt, which Prisma does NOT overwrite on create", async () => {
    // (verify) — `Bike.updatedAt` carries `@updatedAt`. Prisma fills it in when
    // the create does not, and uses the value when it does; `/mes-velos` orders
    // by it, so an imported bike sorts by when the visitor last touched it.
    await signedInUser("import-updated-at@velo-atelier.test");
    const result = await importGuestStateAction(state(guestBike()));
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const row = await prisma.bike.findUniqueOrThrow({ where: { id: result.data.bikeId ?? "" } });
    expect(row.updatedAt.toISOString()).toBe(GUEST_UPDATED_AT);
    expect(row.createdAt.getTime()).toBeGreaterThan(row.updatedAt.getTime());
  });
});

describe("the constraints the feature rests on", () => {
  it("keeps one row per imported guest bike (§6.8 AC8: an older copy is skipped)", async () => {
    const user = await signedInUser("import-twice@velo-atelier.test");

    const first = await importGuestState(prisma, user.id, state(guestBike()));
    expect(first.ok && first.data.imported).toBe(1);

    const older = guestBike({
      name: "Vieille copie",
      updatedAt: "2026-01-01T00:00:00.000Z",
      checkups: [],
      lists: [],
    });
    const second = await importGuestState(prisma, user.id, state(older));
    expect(second.ok).toBe(true);
    if (!second.ok) return;
    expect(second.data).toMatchObject({ imported: 0, skipped: 1 });

    const rows = await prisma.bike.findMany({ where: { userId: user.id } });
    expect(rows).toHaveLength(1);
    expect(rows[0].name).toBe("Mon vélo");
    expect(rows[0].updatedAt.toISOString()).toBe(GUEST_UPDATED_AT);
  });

  it("refuses a duplicate at the database level, not only in our code", async () => {
    const user = await signedInUser("import-constraint@velo-atelier.test");
    await importGuestState(prisma, user.id, state(guestBike({ checkups: [], lists: [] })));

    await expect(
      prisma.bike.create({
        data: {
          userId: user.id,
          name: "Doublon",
          answers: DERIVED.answers,
          spec: DERIVED.spec,
          // The domain's precise array type does not structurally satisfy
          // Prisma's `InputJsonValue`; same cast as the actions make.
          parts: DERIVED.parts as unknown as object[],
          guestLocalId: LOCAL_ID,
        },
      }),
    ).rejects.toMatchObject({ code: "P2002" });
  });

  it("lets two accounts import the same browser, checkup included", async () => {
    const mine = await prisma.user.create({
      data: { email: "share-a@velo-atelier.test", locale: "fr" },
    });
    const theirs = await prisma.user.create({
      data: { email: "share-b@velo-atelier.test", locale: "fr" },
    });

    expect((await importGuestState(prisma, mine.id, state(guestBike()))).ok).toBe(true);
    // The globally unique `Checkup.guestKey` would refuse this one if the import
    // stored the bare `CheckupState.id`.
    expect((await importGuestState(prisma, theirs.id, state(guestBike()))).ok).toBe(true);

    const keys = await prisma.checkup.findMany({
      where: { bike: { userId: { in: [mine.id, theirs.id] } } },
      select: { guestKey: true },
      orderBy: { guestKey: "asc" },
    });
    expect(keys.map((row) => row.guestKey).sort()).toEqual(
      [guestCheckupKey(mine.id, CHECKUP_ID), guestCheckupKey(theirs.id, CHECKUP_ID)].sort(),
    );
  });

  it("writes one row for a step key or a (part, action) pair the payload repeats", async () => {
    const user = await signedInUser("import-dupes@velo-atelier.test");
    const repeated = guestBike({
      checkups: [
        { ...CHECKUP, items: [CHECKUP.items[0], { ...CHECKUP.items[0], result: "ok" as const }] },
      ],
      lists: [{ ...LIST, items: [LIST.items[0], { ...LIST.items[0], done: true }] }],
    });

    const result = await importGuestState(prisma, user.id, state(repeated));
    expect(result.ok).toBe(true);
    expect(
      await prisma.checkupItem.count({ where: { checkup: { bike: { userId: user.id } } } }),
    ).toBe(1);
    expect(
      await prisma.buildListItem.count({ where: { buildList: { bike: { userId: user.id } } } }),
    ).toBe(1);
  });

  it("cascades: deleting an imported bike leaves nothing behind", async () => {
    const user = await signedInUser("import-cascade@velo-atelier.test");
    const result = await importGuestState(prisma, user.id, state(guestBike()));
    expect(result.ok).toBe(true);
    if (!result.ok || result.data.bikeId === null) return;

    await prisma.bike.delete({ where: { id: result.data.bikeId } });

    expect(await prisma.bikePartState.count({ where: { bikeId: result.data.bikeId } })).toBe(0);
    expect(await prisma.checkup.count({ where: { bikeId: result.data.bikeId } })).toBe(0);
    expect(
      await prisma.checkupItem.count({ where: { checkup: { bikeId: result.data.bikeId } } }),
    ).toBe(0);
    expect(await prisma.buildList.count({ where: { bikeId: result.data.bikeId } })).toBe(0);
    expect(
      await prisma.buildListItem.count({ where: { buildList: { bikeId: result.data.bikeId } } }),
    ).toBe(0);
  });
});
