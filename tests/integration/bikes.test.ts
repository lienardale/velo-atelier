/**
 * The bike actions against the real `_test` database (§4.8 AC6).
 *
 * The recording fake already proves the *shapes* — ownership in the `where`,
 * `.strict()` inputs, `TOO_MANY` on a quota. What only PostgreSQL can settle is
 * everything the schema declares and the fake only imitates:
 *
 *   - `@@unique([userId, guestLocalId])`: the same guest bike imported twice is
 *     one row, and two different accounts may both hold guest id `…0002`;
 *   - `onDelete: Cascade` from `Bike` down through part states, checkups,
 *     checkup items, build lists and build-list items — a `deleteBikeAction`
 *     that left orphans would pass every unit test;
 *   - `@@unique([bikeId, partId])` on `BikePartState`, which is what makes the
 *     re-derivation of §4.2 a idempotent rather than duplicating rows;
 *   - the `Json` round trip: a `spec` written as an object comes back as an
 *     object, not a string, and `validateBuild` still accepts it;
 *   - `VarChar(80)` on the name, enforced by the schema **and** by the action;
 *   - a row LOCK: `updateBikePartAction` edits one JSON column by reading it,
 *     changing it and writing it back, and two calls for one bike that overlap
 *     must not overwrite each other. The fake runs one call at a time.
 *
 * The seeded demo data is also checked here, because §4.8 AC1's promise —
 * "3 bikes, 1 completed checkup with exactly 2 KO items, 1 build list with 2
 * items" — is a statement about a real database, and `tests/integration/global-setup.ts`
 * has just loaded it.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

import { prisma } from "@/lib/db/prisma";
import {
  sameOriginHeaders,
  sessionFor,
  setRequestHeaders,
  setSession,
} from "@/tests/_fakes/session";
import { DEMO_BIKE_GUEST_IDS, DEMO_USER, DEMO_USERS } from "@/prisma/seed-data";

vi.mock("@/auth", async () => (await import("@/tests/_fakes/session")).authModule());

const { createBikeAction, updateBikeAction, renameBikeAction, deleteBikeAction } =
  await import("@/app/[locale]/(protected)/mes-velos/actions");
const { updateBikePartAction } = await import("@/app/[locale]/velo/[id]/actions");
const { updateBikeFitAction } = await import("@/app/[locale]/velo/[id]/reglages/actions");
const { loadBikeForRequest } = await import("@/lib/bike/load-bike");
const { BIKE_PRESETS } = await import("@/lib/domain/data/presets");
const { validateBuild } = await import("@/lib/domain/engine/validate-build");
const { BIKE_NAME_MAX } = await import("@/lib/bike/rules");
const { distinctBuild, formAttributes, isTyped, presetBuild } =
  await import("@/tests/_helpers/part-attributes");

async function signedInUser(email: string) {
  const user = await prisma.user.create({ data: { email, name: "Camille", locale: "fr" } });
  setSession(sessionFor({ id: user.id, email: user.email, name: user.name, locale: "fr" }));
  return user;
}

beforeEach(() => {
  setRequestHeaders(sameOriginHeaders());
});

describe("creating a bike", () => {
  it("stores the derived spec and parts and one part state per part", async () => {
    const user = await signedInUser("create@velo-atelier.test");

    const result = await createBikeAction({
      name: "Gravel",
      answers: BIKE_PRESETS["gravel-1x11"],
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const row = await prisma.bike.findUniqueOrThrow({
      where: { id: result.data.id },
      include: { partStates: true },
    });

    expect(row.userId).toBe(user.id);
    expect(row.specVersion).toBe(1);
    // JSON round trip: objects come back as objects the domain still accepts.
    expect(validateBuild({ spec: row.spec, parts: row.parts }).ok).toBe(true);
    expect(row.partStates).toHaveLength((row.parts as unknown[]).length);
    expect(new Set(row.partStates.map((state) => state.status))).toEqual(new Set(["UNKNOWN"]));
  });

  it("keeps one row per imported guest bike, and lets two accounts share a guest id", async () => {
    const first = await signedInUser("guest-a@velo-atelier.test");
    const created = await createBikeAction({
      name: "Gravel",
      answers: BIKE_PRESETS["gravel-1x11"],
      guestLocalId: DEMO_BIKE_GUEST_IDS.gravel,
    });
    expect(created.ok).toBe(true);

    // The same payload again: the unique constraint is what stops a duplicate.
    await expect(
      prisma.bike.create({
        data: {
          userId: first.id,
          name: "Gravel (bis)",
          answers: {},
          spec: {},
          parts: [],
          guestLocalId: DEMO_BIKE_GUEST_IDS.gravel,
        },
      }),
    ).rejects.toMatchObject({ code: "P2002" });

    // …but the constraint is per user, so somebody else may hold the same id.
    await signedInUser("guest-b@velo-atelier.test");
    const other = await createBikeAction({
      name: "Gravel",
      answers: BIKE_PRESETS["gravel-1x11"],
      guestLocalId: DEMO_BIKE_GUEST_IDS.gravel,
    });
    expect(other.ok).toBe(true);
  });

  it("refuses a name longer than the column", async () => {
    // Scoped to this user: `setup.integration.ts` truncates once per FILE, so
    // the rows the tests above created are still there.
    const user = await signedInUser("long@velo-atelier.test");
    const result = await createBikeAction({
      name: "x".repeat(BIKE_NAME_MAX + 1),
      answers: BIKE_PRESETS["gravel-1x11"],
    });
    expect(result).toMatchObject({ ok: false, code: "VALIDATION" });
    expect(await prisma.bike.count({ where: { userId: user.id } })).toBe(0);
  });
});

describe("re-describing a bike", () => {
  it("adds and removes part states without duplicating the ones that stayed", async () => {
    await signedInUser("redescribe@velo-atelier.test");
    const created = await createBikeAction({
      name: "Route",
      answers: BIKE_PRESETS["road-rim-2x11"],
    });
    expect(created.ok).toBe(true);
    if (!created.ok) return;

    const before = await prisma.bikePartState.findMany({
      where: { bikeId: created.data.id },
      select: { partId: true, id: true },
    });
    expect(before.map((state) => state.partId)).not.toContain("rotor-front");

    const updated = await updateBikeAction({
      bikeId: created.data.id,
      answers: BIKE_PRESETS["road-disc-2x12"],
    });
    expect(updated.ok).toBe(true);

    const after = await prisma.bikePartState.findMany({
      where: { bikeId: created.data.id },
      select: { partId: true, id: true },
    });
    const partIds = after.map((state) => state.partId);
    expect(partIds).toContain("rotor-front");
    expect(partIds).not.toContain("brake-pad-holder-front");
    expect(new Set(partIds).size).toBe(partIds.length);

    // A part that survived kept its row — and therefore its status and notes.
    const chainBefore = before.find((state) => state.partId === "chain");
    const chainAfter = after.find((state) => state.partId === "chain");
    expect(chainAfter?.id).toBe(chainBefore?.id);
  });

  it("carries an attribute edit across a change of answers", async () => {
    await signedInUser("carry@velo-atelier.test");
    const created = await createBikeAction({
      name: "Gravel",
      answers: BIKE_PRESETS["gravel-1x11"],
    });
    if (!created.ok) throw new Error("setup failed");

    await updateBikePartAction({
      bikeId: created.data.id,
      partId: "saddle",
      attributes: { "saddle-width": 155 },
    });
    await updateBikeAction({
      bikeId: created.data.id,
      answers: { ...BIKE_PRESETS["gravel-1x11"], "tire-system": "clincher-tube" },
    });

    const row = await prisma.bike.findUniqueOrThrow({ where: { id: created.data.id } });
    const parts = row.parts as unknown as { partId: string; attributes: Record<string, unknown> }[];
    expect(parts.find((part) => part.partId === "saddle")?.attributes["saddle-width"]).toBe(155);
  });
});

describe("editing parts of one bike from several calls at once", () => {
  type StoredParts = { partId: string; attributes: Record<string, unknown> }[];

  /**
   * Start every call before any of them has reached the database.
   *
   * One turn of the event loop apart, not in the same tick: `withUser` reaches
   * `next/headers` through an `import()`, and of several such imports issued in
   * one tick Vitest (4.1.11) hands the mocked module to the first only — the
   * others get the real one, which throws outside a request ("`headers` was
   * called outside a request scope", seen here with a plain `Promise.all`).
   * A turn is enough for a call to be past that import, and nowhere near
   * enough for it to have been answered by PostgreSQL.
   */
  async function sentTogether<T>(calls: (() => Promise<T>)[]): Promise<T[]> {
    const pending: Promise<T>[] = [];
    for (const call of calls) {
      pending.push(call());
      await new Promise((resolve) => setImmediate(resolve));
    }
    return Promise.all(pending);
  }

  /**
   * Until 2026-10-09 the action read the row, edited the build and wrote it
   * back with nothing held in between: of calls that overlap, each wrote its
   * own edit over the others' and every one of them answered ok. Next's client
   * does overlap them — an action dispatched while a navigation is under way
   * is sent at once, whatever is pending (`.debug/017` §5.8, "Review of the fix") — and
   * two tabs or two devices need no navigation at all.
   *
   * Twelve edits of twelve different fields, sent in the same tick. Without
   * the row's lock every call reads the bike before any has written, so the
   * last write is the only one left.
   */
  it("keeps every one of twelve edits sent together: none is written over another", async () => {
    await signedInUser("together@velo-atelier.test");
    const created = await createBikeAction({
      name: "Gravel",
      answers: BIKE_PRESETS["gravel-1x11"],
    });
    if (!created.ok) throw new Error("setup failed");
    const bikeId = created.data.id;

    // A value of its own for each typed field, from the catalogue — and one
    // the stock bike does not already hold, so that each can be told apart.
    const stock = formAttributes(presetBuild("gravel-1x11"));
    const edits = formAttributes(distinctBuild("gravel-1x11"))
      .filter((entry) => isTyped(entry.attribute))
      .filter((entry) =>
        stock.some(
          (was) =>
            was.partId === entry.partId &&
            was.attribute.key === entry.attribute.key &&
            was.value !== entry.value,
        ),
      )
      .slice(0, 12)
      .map((entry) => ({ partId: entry.partId, key: entry.attribute.key, value: entry.value! }));
    expect(edits).toHaveLength(12);
    expect(new Set(edits.map((edit) => edit.partId)).size).toBeGreaterThan(4);

    const answers = await sentTogether(
      edits.map(
        (edit) => () =>
          updateBikePartAction({
            bikeId,
            partId: edit.partId,
            attributes: { [edit.key]: edit.value },
          }),
      ),
    );

    for (const [index, answer] of answers.entries()) {
      // eslint-disable-next-line security/detect-object-injection -- the index of the loop
      const edit = edits[index];
      if (!answer.ok) throw new Error(`${edit.partId}.${edit.key} was refused: ${answer.code}`);
      // What a call answers with holds, at the least, its own edit.
      expect(
        answer.data.parts.find((part) => part.partId === edit.partId)?.attributes[edit.key],
      ).toBe(edit.value);
    }
    const row = await prisma.bike.findUniqueOrThrow({ where: { id: bikeId } });
    const stored = row.parts as unknown as StoredParts;
    expect(
      edits.map((edit) => ({
        ...edit,
        value: stored.find((part) => part.partId === edit.partId)?.attributes[edit.key],
      })),
    ).toEqual(edits);
  });

  it("two edits of the same field sent together: the bike holds one of them, whole, and the build is valid", async () => {
    await signedInUser("same-field@velo-atelier.test");
    const created = await createBikeAction({
      name: "Gravel",
      answers: BIKE_PRESETS["gravel-1x11"],
    });
    if (!created.ok) throw new Error("setup failed");

    const [first, second] = await sentTogether(
      [45, 50].map(
        (width) => () =>
          updateBikePartAction({
            bikeId: created.data.id,
            partId: "tire-front",
            attributes: { "etrto-width": width },
          }),
      ),
    );
    expect(first.ok && second.ok).toBe(true);

    const row = await prisma.bike.findUniqueOrThrow({ where: { id: created.data.id } });
    const stored = row.parts as unknown as StoredParts;
    expect([45, 50]).toContain(
      stored.find((part) => part.partId === "tire-front")?.attributes["etrto-width"],
    );
    expect(validateBuild({ spec: row.spec, parts: row.parts }).ok).toBe(true);
  });

  it("a refused edit leaves the row exactly as it was — the lock's own write is rolled back with it", async () => {
    // The lock is an UPDATE, and an UPDATE moves `updatedAt`, which "Mes
    // vélos" sorts by: a refusal must not send the bike to the top of the list.
    await signedInUser("refused-edit@velo-atelier.test");
    const created = await createBikeAction({
      name: "Gravel",
      answers: BIKE_PRESETS["gravel-1x11"],
    });
    if (!created.ok) throw new Error("setup failed");
    const before = await prisma.bike.findUniqueOrThrow({ where: { id: created.data.id } });
    await new Promise((resolve) => setTimeout(resolve, 5));

    expect(
      await updateBikePartAction({
        bikeId: created.data.id,
        partId: "tire-front",
        attributes: { "etrto-width": 999 },
      }),
    ).toEqual({
      ok: false,
      code: "VALIDATION",
      fieldErrors: { "etrto-width": "bike.errors.invalid-value" },
    });
    expect(
      await updateBikePartAction({
        bikeId: created.data.id,
        partId: "e-motor", // in the catalogue, not on this bike
        attributes: { "etrto-width": 45 },
      }),
    ).toEqual({ ok: false, code: "NOT_FOUND" });

    const after = await prisma.bike.findUniqueOrThrow({ where: { id: created.data.id } });
    expect(after.updatedAt.toISOString()).toBe(before.updatedAt.toISOString());
    expect(after.parts).toEqual(before.parts);

    // …and an accepted one does move it, as it always has.
    await updateBikePartAction({
      bikeId: created.data.id,
      partId: "tire-front",
      attributes: { "etrto-width": 45 },
    });
    const edited = await prisma.bike.findUniqueOrThrow({ where: { id: created.data.id } });
    expect(edited.updatedAt.getTime()).toBeGreaterThan(before.updatedAt.getTime());
  });

  it("an edit with a status and notes writes the part and its state together", async () => {
    await signedInUser("state-edit@velo-atelier.test");
    const created = await createBikeAction({
      name: "Gravel",
      answers: BIKE_PRESETS["gravel-1x11"],
    });
    if (!created.ok) throw new Error("setup failed");

    // Never BROKEN: the demo seed's check below counts every BROKEN state in the database.
    const answers = await sentTogether(
      (["ATTENTION", "OK", "UNKNOWN"] as const).map(
        (status) => () =>
          updateBikePartAction({
            bikeId: created.data.id,
            partId: "chain",
            status,
            notes: `noté ${status}`,
          }),
      ),
    );
    expect(answers.every((answer) => answer.ok)).toBe(true);

    const states = await prisma.bikePartState.findMany({
      where: { bikeId: created.data.id, partId: "chain" },
    });
    expect(states).toHaveLength(1);
    expect(states[0].notes).toBe(`noté ${states[0].status}`);
  });
});

describe("fit", () => {
  it("merges patches instead of replacing the object", async () => {
    await signedInUser("fit@velo-atelier.test");
    const created = await createBikeAction({
      name: "Gravel",
      answers: BIKE_PRESETS["gravel-1x11"],
    });
    if (!created.ok) throw new Error("setup failed");

    await updateBikeFitAction({ bikeId: created.data.id, fit: { riderKg: 72 } });
    await updateBikeFitAction({ bikeId: created.data.id, fit: { saddleHeightMm: 742 } });

    const row = await prisma.bike.findUniqueOrThrow({ where: { id: created.data.id } });
    expect(row.fit).toEqual({ riderKg: 72, saddleHeightMm: 742 });
  });
});

describe("deleting a bike", () => {
  it("takes its part states, checkups, items and lists with it", async () => {
    const user = await signedInUser("cascade@velo-atelier.test");
    const created = await createBikeAction({
      name: "Gravel",
      answers: BIKE_PRESETS["gravel-1x11"],
    });
    if (!created.ok) throw new Error("setup failed");
    const bikeId = created.data.id;

    const checkup = await prisma.checkup.create({
      data: {
        bikeId,
        scope: "FULL",
        status: "COMPLETED",
        items: {
          create: [
            {
              stepKey: "check-drivetrain#chain-wear",
              partId: "chain",
              guideSlug: "check-drivetrain",
              result: "KO",
            },
          ],
        },
      },
      include: { items: true },
    });
    await prisma.buildList.create({
      data: {
        bikeId,
        checkupId: checkup.id,
        name: "Révision",
        items: {
          create: [
            {
              partId: "chain",
              action: "REPLACE",
              reasonKey: "chain-elongation",
              checkupItemId: checkup.items[0].id,
            },
          ],
        },
      },
    });

    expect(await deleteBikeAction({ bikeId })).toEqual({ ok: true, data: null });

    expect(await prisma.bike.count({ where: { userId: user.id } })).toBe(0);
    expect(await prisma.bikePartState.count({ where: { bikeId } })).toBe(0);
    expect(await prisma.checkup.count({ where: { bikeId } })).toBe(0);
    expect(await prisma.checkupItem.count({ where: { checkupId: checkup.id } })).toBe(0);
    expect(await prisma.buildList.count({ where: { bikeId } })).toBe(0);
    expect(await prisma.buildListItem.count()).toBe(0);
  });
});

describe("loading a bike for a request", () => {
  it("returns the owner's bike, and 404s everybody else's", async () => {
    const owner = await signedInUser("owner@velo-atelier.test");
    const created = await createBikeAction({
      name: "Gravel",
      answers: BIKE_PRESETS["gravel-1x11"],
    });
    if (!created.ok) throw new Error("setup failed");

    class NotFound extends Error {}
    const onMissing = (): never => {
      throw new NotFound();
    };

    const loaded = await loadBikeForRequest(
      { kind: "db", id: created.data.id },
      { getUser: async () => ({ id: owner.id }), onMissing },
    );
    expect(loaded.name).toBe("Gravel");
    expect(validateBuild(loaded.build).ok).toBe(true);

    const stranger = await prisma.user.create({
      data: { email: "stranger@velo-atelier.test", locale: "fr" },
    });
    await expect(
      loadBikeForRequest(
        { kind: "db", id: created.data.id },
        { getUser: async () => ({ id: stranger.id }), onMissing },
      ),
    ).rejects.toBeInstanceOf(NotFound);
  });

  it("renames a bike and shows the new name on the next load", async () => {
    const owner = await signedInUser("rename@velo-atelier.test");
    const created = await createBikeAction({
      name: "Gravel",
      answers: BIKE_PRESETS["gravel-1x11"],
    });
    if (!created.ok) throw new Error("setup failed");

    expect(
      await renameBikeAction({ bikeId: created.data.id, name: "Gravel d'hiver" }),
    ).toMatchObject({ ok: true });
    const loaded = await loadBikeForRequest(
      { kind: "db", id: created.data.id },
      { getUser: async () => ({ id: owner.id }) },
    );
    expect(loaded.name).toBe("Gravel d'hiver");
  });
});

/**
 * The seed, as §4.8 AC1 describes it. This file runs after
 * `tests/integration/global-setup.ts`, which loads it — but `setup.integration.ts`
 * truncates before every file, so the rows are re-read from a fresh seed here.
 */
describe("the demo seed", () => {
  beforeEach(async () => {
    const { spawnSync } = await import("node:child_process");
    const result = spawnSync(
      process.execPath,
      ["node_modules/prisma/build/index.js", "db", "seed"],
      { cwd: process.cwd(), env: process.env, encoding: "utf8" },
    );
    if (result.status !== 0) throw new Error(`seed failed: ${result.stdout}${result.stderr}`);
  });

  it("gives the French demo account three bikes, one completed checkup and one list", async () => {
    const demo = await prisma.user.findUniqueOrThrow({
      where: { email: DEMO_USER.email },
      include: { bikes: { include: { checkups: { include: { items: true } }, buildLists: true } } },
    });

    expect(demo.bikes).toHaveLength(3);
    expect(demo.bikes.map((bike) => bike.name).sort()).toEqual([
      "Gravel",
      "VTT électrique",
      "Vélo de route",
    ]);

    const checkups = demo.bikes.flatMap((bike) => bike.checkups);
    expect(checkups).toHaveLength(1);
    expect(checkups[0].status).toBe("COMPLETED");
    expect(checkups[0].items.filter((item) => item.result === "KO")).toHaveLength(2);

    const lists = demo.bikes.flatMap((bike) => bike.buildLists);
    expect(lists).toHaveLength(1);
    expect(lists[0].name).toBe("Révision printemps");
    expect(await prisma.buildListItem.count({ where: { buildListId: lists[0].id } })).toBe(2);
  });

  it("marks exactly the two KO parts BROKEN, and only on the bike that was checked", async () => {
    const broken = await prisma.bikePartState.findMany({
      where: { status: "BROKEN" },
      select: { partId: true, bikeId: true },
    });
    expect(broken.map((state) => state.partId).sort()).toEqual(["brake-pads-rear", "chain"]);
    expect(new Set(broken.map((state) => state.bikeId)).size).toBe(1);
  });

  it("is idempotent: seeding again changes no row count", async () => {
    // Only the seeded rows: earlier tests in this file created their own users
    // and bikes, and the per-file truncate does not run between tests.
    const demoEmails = DEMO_USERS.map((user) => user.email);
    const demoOnly = { user: { email: { in: demoEmails } } };
    const before = await Promise.all([
      prisma.user.count({ where: { email: { in: demoEmails } } }),
      prisma.bike.count({ where: demoOnly }),
      prisma.bikePartState.count({ where: { bike: demoOnly } }),
      prisma.checkup.count({ where: { bike: demoOnly } }),
      prisma.checkupItem.count({ where: { checkup: { bike: demoOnly } } }),
      prisma.buildList.count({ where: { bike: demoOnly } }),
      prisma.buildListItem.count({ where: { buildList: { bike: demoOnly } } }),
    ]);

    const { spawnSync } = await import("node:child_process");
    spawnSync(process.execPath, ["node_modules/prisma/build/index.js", "db", "seed"], {
      cwd: process.cwd(),
      env: process.env,
      encoding: "utf8",
    });

    const after = await Promise.all([
      prisma.user.count({ where: { email: { in: demoEmails } } }),
      prisma.bike.count({ where: demoOnly }),
      prisma.bikePartState.count({ where: { bike: demoOnly } }),
      prisma.checkup.count({ where: { bike: demoOnly } }),
      prisma.checkupItem.count({ where: { checkup: { bike: demoOnly } } }),
      prisma.buildList.count({ where: { bike: demoOnly } }),
      prisma.buildListItem.count({ where: { buildList: { bike: demoOnly } } }),
    ]);

    expect(after).toEqual(before);
    expect(before[0]).toBe(DEMO_USERS.length);
    expect(before[1]).toBe(4);
  });
});
