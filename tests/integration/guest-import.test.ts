/**
 * The guest import against the real `_test` database (§4.8 AC6).
 *
 * The recording fake already proves the shapes. What only PostgreSQL can settle
 * is everything the schema declares and the fake imitates:
 *
 *   - `@@unique([userId, guestLocalId])` — the constraint the whole feature
 *     rests on. Importing the same browser twice is one row, two devices
 *     importing at the same instant is one row, and two accounts may hold the
 *     same guest id (a shared laptop).
 *   - `Checkup.guestKey` is **globally** unique, not unique per bike. That is
 *     why the import stores `${userId}:${stateId}`: with the bare state id, the
 *     second person to import from one browser would collide on a row they
 *     cannot see. This file is where that is more than an assertion about our
 *     own code.
 *   - **The transaction.** Bike, part states, checkup, items, list and lines are
 *     one unit: the foreign keys the links need (`BuildList.checkupId`,
 *     `BuildListItem.checkupItemId`) point at rows created a statement earlier,
 *     with ids generated in Node, and a failure anywhere leaves no bike behind.
 *   - `@@unique([buildListId, partId, action])`, which is what makes a payload
 *     that repeats itself one row.
 *   - `onDelete: Cascade` all the way down from `Bike`: an imported bike
 *     deleted from `/mes-velos` must leave no checkup, item, list or part state
 *     behind.
 *   - The `Json` round trip: `spec` and `parts` written as objects come back as
 *     objects that `validateBuild` still accepts.
 *   - `startedAt` to the millisecond: an imported unfinished checkup is resumed
 *     and finished through `finishCheckupAction`, which recognises a run by
 *     that instant — as the SAME row, not a second one.
 *   - **(verify)** whether Prisma 7 honours an explicit value for a field
 *     carrying `@updatedAt` on `create`. The import writes the guest's own
 *     `updatedAt` (clamped), so that `/mes-velos` orders an imported bike by
 *     when it was last touched rather than by when it arrived.
 *
 * The fixtures are what the wizard stores (`tests/_helpers/guest-work.ts`:
 * the real plan, the reducer, `toStored` under the real key, collected back).
 * Until 2026-10-07 this file imported hand-written items and asserted
 * `list.checkupId` was NULL — which is exactly what production then did to a
 * real checkup (`.debug/017` §5.6).
 *
 * Two tests go through `importGuestStateAction` so the whole path — session,
 * origin, schema, rate limit, planner, writes — is exercised against a real
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

// The compiled corpus is a build artefact this tier does not produce; the
// frontmatter on disk carries the same plan (`tests/integration/checkups.test.ts`
// makes the same choice, for the same reason). `lib/content/collection.ts`
// reads BOTH collections at module scope, so the mock names both.
vi.mock("content-collections", async () => ({
  allGuides: (await import("@/tests/_helpers/guides")).diskGuides(),
  allLegalPages: [],
}));

const { importGuestStateAction } = await import("@/app/[locale]/(protected)/import/actions");
const { finishCheckupAction, saveCheckupAction } =
  await import("@/app/[locale]/velo/[id]/controle/actions");
const { loadStoredCheckup } = await import("@/app/[locale]/velo/[id]/controle/load");
const { guestCheckupKey, importGuestState } = await import("@/lib/guest/import");
const { GUEST_STATE_VERSION } = await import("@/lib/guest/schema");
// The planner the action injects — production's wiring, not a stand-in.
const { planForBuild } = await import("@/lib/content/checkup-plan");
const { deriveBike } = await import("@/lib/bike/rules");
const { reduce } = await import("@/lib/checkup/reducer");
const { fromStored, toStored } = await import("@/lib/checkup/storage");
const { BIKE_PRESETS } = await import("@/lib/domain/data/presets");
const { validateBuild } = await import("@/lib/domain/engine/validate-build");
const { guestRun, guestWork, partsScope } = await import("@/tests/_helpers/guest-work");

type GuestBike = import("@/lib/guest/schema").GuestBike;
type GuestState = import("@/lib/guest/schema").GuestState;
type GuestVerdict = import("@/tests/_helpers/guest-work").GuestVerdict;

const DERIVED = deriveBike(BIKE_PRESETS["gravel-1x11"]);
const LOCAL_ID = "11111111-2222-4333-8444-555555555555";
const CHECKUP_ID = "3f1d7a52-9c1e-4f2b-8d7a-0b4f2c6e1a90";
const GUEST_UPDATED_AT = "2026-09-14T09:00:00.000Z";
const STARTED_AT = "2026-09-14T08:00:00.123Z";
const COMPLETED_AT = "2026-09-14T08:20:00.000Z";

const CHAIN = "check-drivetrain#chain-wear";
const CASSETTE = "check-drivetrain#cassette-teeth";

const deps = { plan: planForBuild };

interface RunOptions {
  verdicts: Record<string, GuestVerdict>;
  /** `null` leaves the checkup in progress. */
  completedAt?: string | null;
}

/** The chain is worn (with a note), the cassette is fine — finished. */
const FINISHED: RunOptions = {
  verdicts: {
    [CHAIN]: { ko: ["chain-elongation"], notes: "élongation 0,8 %" },
    [CASSETTE]: "ok",
  },
};

/** The guest bike as `/import` sends it: what the wizard stored, collected back. */
function guestBike(run: RunOptions | null = FINISHED, patch: Partial<GuestBike> = {}): GuestBike {
  const work = guestWork({
    answers: BIKE_PRESETS["gravel-1x11"],
    bikeId: LOCAL_ID,
    fit: { saddleHeightMm: 742 },
    updatedAt: GUEST_UPDATED_AT,
    ...(run === null
      ? {}
      : {
          checkup: (build) =>
            guestRun({
              id: CHECKUP_ID,
              build,
              scope: partsScope("chain", "cassette"),
              verdicts: run.verdicts,
              startedAt: STARTED_AT,
              ...(run.completedAt === null ? {} : { completedAt: run.completedAt ?? COMPLETED_AT }),
            }),
        }),
  });
  const [bike] = (JSON.parse(JSON.stringify(work.collect().state)) as GuestState).bikes;
  return { ...bike, ...patch };
}

function state(...bikes: GuestBike[]): GuestState {
  return { version: GUEST_STATE_VERSION, bikes };
}

async function signedInUser(email: string) {
  const user = await prisma.user.create({ data: { email, name: "Camille", locale: "fr" } });
  setSession(sessionFor({ id: user.id, email: user.email, name: user.name, locale: "fr" }));
  return user;
}

/** Everything one account holds, as counts — for "nothing was written". */
async function countsFor(userId: string) {
  const bike = { userId };
  return {
    bikes: await prisma.bike.count({ where: bike }),
    partStates: await prisma.bikePartState.count({ where: { bike } }),
    checkups: await prisma.checkup.count({ where: { bike } }),
    items: await prisma.checkupItem.count({ where: { checkup: { bike } } }),
    lists: await prisma.buildList.count({ where: { bike } }),
    lines: await prisma.buildListItem.count({ where: { buildList: { bike } } }),
  };
}

const NOTHING = { bikes: 0, partStates: 0, checkups: 0, items: 0, lists: 0, lines: 0 };

beforeEach(() => {
  setRequestHeaders(sameOriginHeaders());
});

describe("importGuestStateAction end to end", () => {
  it("imports the checkup the wizard really stores — rows, links and part states", async () => {
    const user = await signedInUser("import-action@velo-atelier.test");

    const result = await importGuestStateAction(state(guestBike()));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.imported).toBe(1);
    expect(result.data.bikes[0].checkups).toEqual([{ guestKey: CHECKUP_ID, status: "imported" }]);

    const row = await prisma.bike.findUniqueOrThrow({
      where: { id: result.data.bikeId ?? "" },
      include: {
        partStates: true,
        checkups: { include: { items: { orderBy: { stepKey: "desc" } } } },
        buildLists: { include: { items: true } },
      },
    });

    expect(row.userId).toBe(user.id);
    expect(row.guestLocalId).toBe(LOCAL_ID);
    expect(row.fit).toEqual({ saddleHeightMm: 742 });
    // The Json round trip: objects in, objects out, and the domain still agrees.
    expect(validateBuild({ spec: row.spec, parts: row.parts }).ok).toBe(true);
    expect(row.partStates).toHaveLength((row.parts as unknown[]).length);

    // The Checkup — the row production did not write.
    expect(row.checkups).toHaveLength(1);
    const [checkup] = row.checkups;
    expect(checkup.guestKey).toBe(guestCheckupKey(user.id, CHECKUP_ID));
    expect(checkup.scope).toBe("PARTIAL");
    expect(checkup.status).toBe("COMPLETED");
    expect(checkup.startedAt.toISOString()).toBe(STARTED_AT);
    expect(checkup.completedAt?.toISOString()).toBe(COMPLETED_AT);

    // Its items: the part and the guide are the PLAN's, the payload named neither.
    expect(
      checkup.items.map((item) => ({
        stepKey: item.stepKey,
        partId: item.partId,
        guideSlug: item.guideSlug,
        result: item.result,
        notes: item.notes,
        reasonKeys: item.reasonKeys,
      })),
    ).toEqual([
      {
        stepKey: CHAIN,
        partId: "chain",
        guideSlug: "check-drivetrain",
        result: "KO",
        notes: "élongation 0,8 %",
        reasonKeys: ["chain-elongation"],
      },
      {
        stepKey: CASSETTE,
        partId: "cassette",
        guideSlug: "check-drivetrain",
        result: "OK",
        notes: null,
        reasonKeys: [],
      },
    ]);

    // The list, linked: to the checkup, and each derived line to its item.
    expect(row.buildLists).toHaveLength(1);
    const [list] = row.buildLists;
    expect(list.checkupId).toBe(checkup.id);
    expect(list.status).toBe("OPEN");
    expect(list.items).toHaveLength(1);
    expect(list.items[0]).toMatchObject({ partId: "chain", action: "REPLACE", done: false });
    expect(list.items[0].checkupItemId).toBe(
      checkup.items.find((item) => item.stepKey === CHAIN)?.id,
    );

    // §4.2 b: a finished checkup leaves its parts BROKEN or serviced.
    const states = new Map(row.partStates.map((partState) => [partState.partId, partState]));
    expect(states.get("chain")?.status).toBe("BROKEN");
    expect(states.get("cassette")?.status).toBe("OK");
    expect(states.get("cassette")?.lastServicedAt?.toISOString()).toBe(COMPLETED_AT);
    expect(row.partStates.filter((partState) => partState.status !== "UNKNOWN")).toHaveLength(2);
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

describe("an imported checkup that was not finished", () => {
  /*
   * A FULL checkup, on purpose. What is held here is the import's half of a
   * resume: the run keeps its `startedAt`, so the account's own actions find
   * the row the import wrote. The test replays what the wizard does with what
   * the page hands it — `fromStored` on `loadStoredCheckup`'s answer, the
   * reducer's events, `toStored` posted to the two actions — and changes
   * nothing on the way, the scope least of all.
   *
   * A PARTIAL checkup is not exercised: the parts the visitor picked have no
   * column (`Checkup.scope` is FULL or PARTIAL), on an account as after an
   * import, and how an account resumes a partial run is the account's own
   * path, which this change neither touches nor depends on.
   */
  it("is resumed and finished on the account as the SAME Checkup row (a full checkup)", async () => {
    const user = await signedInUser("import-resume@velo-atelier.test");
    // The whole bike, one question answered: the wizard was left on the next.
    const work = guestWork({
      answers: BIKE_PRESETS["gravel-1x11"],
      bikeId: LOCAL_ID,
      updatedAt: GUEST_UPDATED_AT,
      checkup: (build) =>
        guestRun({
          id: CHECKUP_ID,
          build,
          scope: { kind: "full" },
          verdicts: { [CHAIN]: { ko: ["chain-elongation"] } },
          startedAt: STARTED_AT,
        }),
    });
    const payload = JSON.parse(JSON.stringify(work.collect().state)) as GuestState;
    const result = await importGuestState(prisma, user.id, payload, deps);
    expect(result.ok).toBe(true);
    if (!result.ok || result.data.bikeId === null) return;
    const bikeId = result.data.bikeId;

    const imported = await prisma.checkup.findMany({
      where: { bikeId },
      include: { items: true },
    });
    expect(imported).toHaveLength(1);
    expect(imported[0]).toMatchObject({ status: "IN_PROGRESS", scope: "FULL", completedAt: null });
    expect(imported[0].items.map((item) => item.stepKey)).toEqual([CHAIN]);
    // Unfinished: no part state, and nothing links the (absent) list to it.
    expect(
      await prisma.bikePartState.count({ where: { bikeId, status: { not: "UNKNOWN" } } }),
    ).toBe(0);
    expect(await prisma.buildList.count({ where: { bikeId } })).toBe(0);

    // What the checkup page hands the wizard — the imported run, by its start…
    const stored = await loadStoredCheckup(bikeId, user.id, "fr");
    expect(stored).toMatchObject({
      scope: { kind: "full" },
      startedAt: STARTED_AT,
      answers: { [CHAIN]: "ko" },
      symptoms: { [CHAIN]: ["chain-elongation"] },
    });
    if (stored === null) return;
    // …and what the wizard makes of it (`restore`): the answers, on today's plan.
    const plan = planForBuild(work.build, stored.scope);
    let run = fromStored(stored, plan, stored.contentVersion);
    expect(run.answers).toEqual({ [CHAIN]: "ko" });
    expect(plan.length).toBeGreaterThan(2);

    // The visitor answers the next question: the autosave posts the state.
    const next = run.steps[run.cursor];
    expect(next.key).not.toBe(CHAIN);
    run = reduce(run, { type: "ANSWER", key: next.key, result: "ok" });
    expect(await saveCheckupAction({ bikeId, checkup: toStored(run) })).toEqual({
      ok: true,
      data: null,
    });
    // Written INTO the imported row — its answer still there, the new one beside it.
    const saved = await prisma.checkup.findMany({ where: { bikeId }, include: { items: true } });
    expect(saved).toHaveLength(1);
    expect(saved[0].id).toBe(imported[0].id);
    expect(saved[0].items.map((item) => item.stepKey).sort()).toEqual([CHAIN, next.key].sort());

    // Every other question, then "Créer ma liste".
    for (const step of run.steps) {
      if (!Object.hasOwn(run.answers, step.key)) {
        run = reduce(run, { type: "ANSWER", key: step.key, result: "ok" });
      }
    }
    const done = reduce(run, { type: "FINISH" });
    expect(done.completedAt).toBeDefined();
    const finished = await finishCheckupAction({ bikeId, checkup: toStored(done) });
    expect(finished.ok).toBe(true);

    const after = await prisma.checkup.findMany({ where: { bikeId }, include: { items: true } });
    // Not a second row: the one the import wrote, now finished.
    expect(after).toHaveLength(1);
    expect(after[0].id).toBe(imported[0].id);
    expect(after[0].status).toBe("COMPLETED");
    expect(after[0].guestKey).toBe(guestCheckupKey(user.id, CHECKUP_ID));
    expect(after[0].startedAt.toISOString()).toBe(STARTED_AT);
    expect(after[0].items).toHaveLength(plan.length);
    // The answer given as a guest is still the row's, symptom included.
    const chain = after[0].items.find((item) => item.stepKey === CHAIN);
    expect(chain).toMatchObject({ result: "KO", reasonKeys: ["chain-elongation"] });

    // And finishing is what links the list — to that same row.
    const lists = await prisma.buildList.findMany({ where: { bikeId }, include: { items: true } });
    expect(lists).toHaveLength(1);
    expect(lists[0].checkupId).toBe(imported[0].id);
    expect(lists[0].items.map((line) => `${line.action}|${line.partId}`)).toEqual([
      "REPLACE|chain",
    ]);
    expect(lists[0].items[0].checkupItemId).toBe(chain?.id);
  });
});

describe("the constraints the feature rests on", () => {
  it("keeps one row per imported guest bike (§6.8 AC8: an older copy is skipped)", async () => {
    const user = await signedInUser("import-twice@velo-atelier.test");

    const first = await importGuestState(prisma, user.id, state(guestBike()), deps);
    expect(first.ok && first.data.imported).toBe(1);
    const before = await countsFor(user.id);
    expect(before).toMatchObject({ bikes: 1, checkups: 1, items: 2, lists: 1, lines: 1 });

    // The same guest bike again, older, the chain now said to be fine.
    const older = guestBike(
      { verdicts: { [CHAIN]: "ok", [CASSETTE]: "ok" } },
      { name: "Vieille copie", updatedAt: "2026-01-01T00:00:00.000Z" },
    );
    const second = await importGuestState(prisma, user.id, state(older), deps);
    expect(second.ok).toBe(true);
    if (!second.ok) return;
    expect(second.data).toMatchObject({ imported: 0, skipped: 1 });
    // The account holds this checkup — as the first import wrote it.
    expect(second.data.bikes[0]).toMatchObject({
      skipped: "already-imported",
      checkups: [{ guestKey: CHECKUP_ID, status: "already-imported" }],
    });

    // Nothing written: never a second Checkup, and the first one's verdict stands.
    expect(await countsFor(user.id)).toEqual(before);
    const rows = await prisma.bike.findMany({ where: { userId: user.id } });
    expect(rows[0].name).toBe("Mon vélo");
    expect(rows[0].updatedAt.toISOString()).toBe(GUEST_UPDATED_AT);
    const chain = await prisma.checkupItem.findFirstOrThrow({
      where: { stepKey: CHAIN, checkup: { bike: { userId: user.id } } },
    });
    expect(chain.result).toBe("KO");
  });

  it("writes nothing for a checkup that arrives with a bike already imported", async () => {
    const user = await signedInUser("import-late-checkup@velo-atelier.test");
    await importGuestState(prisma, user.id, state(guestBike(null)), deps);
    const before = await countsFor(user.id);
    expect(before).toMatchObject({ bikes: 1, checkups: 0 });

    const second = await importGuestState(prisma, user.id, state(guestBike()), deps);
    expect(second.ok && second.data.bikes[0].checkups).toEqual([
      { guestKey: CHECKUP_ID, status: "skipped", reason: "bike-already-imported" },
    ]);
    expect(await countsFor(user.id)).toEqual(before);
  });

  it("is one bike and one checkup when two devices import at the same instant", async () => {
    const user = await signedInUser("import-concurrent@velo-atelier.test");
    const payload = state(guestBike());

    const results = await Promise.all([
      importGuestState(prisma, user.id, payload, deps),
      importGuestState(prisma, user.id, payload, deps),
      importGuestState(prisma, user.id, payload, deps),
    ]);

    // Every caller gets an answer — the losers too — and they all name one bike.
    const summaries = results.flatMap((result) => (result.ok ? [result.data] : []));
    expect(summaries).toHaveLength(3);
    expect(new Set(summaries.map((summary) => summary.bikeId)).size).toBe(1);
    expect(summaries.map((summary) => summary.imported).sort()).toEqual([0, 0, 1]);
    for (const summary of summaries.filter((candidate) => candidate.imported === 0)) {
      expect(summary.bikes[0]).toMatchObject({
        skipped: "already-imported",
        // What the winner wrote: the browser may forget its copy.
        checkups: [{ guestKey: CHECKUP_ID, status: "already-imported" }],
      });
    }

    expect(await countsFor(user.id)).toEqual({
      bikes: 1,
      partStates: DERIVED.parts.length,
      checkups: 1,
      items: 2,
      lists: 1,
      lines: 1,
    });
  });

  it("refuses a duplicate at the database level, not only in our code", async () => {
    const user = await signedInUser("import-constraint@velo-atelier.test");
    await importGuestState(prisma, user.id, state(guestBike(null)), deps);

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

    expect((await importGuestState(prisma, mine.id, state(guestBike()), deps)).ok).toBe(true);
    // The globally unique `Checkup.guestKey` would refuse this one if the import
    // stored the bare `CheckupState.id`.
    const second = await importGuestState(prisma, theirs.id, state(guestBike()), deps);
    expect(second.ok && second.data.bikes[0].checkups).toEqual([
      { guestKey: CHECKUP_ID, status: "imported" },
    ]);

    const keys = await prisma.checkup.findMany({
      where: { bike: { userId: { in: [mine.id, theirs.id] } } },
      select: { guestKey: true },
      orderBy: { guestKey: "asc" },
    });
    expect(keys.map((row) => row.guestKey).sort()).toEqual(
      [guestCheckupKey(mine.id, CHECKUP_ID), guestCheckupKey(theirs.id, CHECKUP_ID)].sort(),
    );
  });

  it("does not write twice a checkup the account holds under another bike", async () => {
    const user = await signedInUser("import-held@velo-atelier.test");
    await importGuestState(prisma, user.id, state(guestBike()), deps);

    // A NEW guest bike in the same browser, the wizard's checkup still under
    // the key: the unique `guestKey` would abort the whole transaction.
    const other = guestBike(FINISHED, { localId: "22222222-2222-4333-8444-555555555555" });
    const result = await importGuestState(prisma, user.id, state(other), deps);
    expect(result.ok && result.data).toMatchObject({ imported: 1 });
    expect(result.ok && result.data.bikes[0].checkups).toEqual([
      { guestKey: CHECKUP_ID, status: "already-imported" },
    ]);
    expect(await countsFor(user.id)).toMatchObject({ bikes: 2, checkups: 1, lists: 2 });
  });

  it("writes one row for a guestKey or a (part, action) pair the payload repeats", async () => {
    const user = await signedInUser("import-dupes@velo-atelier.test");
    const bike = guestBike();
    const repeated: GuestBike = {
      ...bike,
      checkups: [bike.checkups[0], { ...bike.checkups[0], answers: { [CHAIN]: "ok" } }],
      lists: [
        {
          ...bike.lists[0],
          items: [bike.lists[0].items[0], { ...bike.lists[0].items[0], done: true }],
        },
      ],
    };

    const result = await importGuestState(prisma, user.id, state(repeated), deps);
    expect(result.ok).toBe(true);
    expect(await countsFor(user.id)).toMatchObject({ checkups: 1, items: 2, lists: 1, lines: 1 });
  });

  it("cascades: deleting an imported bike leaves nothing behind", async () => {
    const user = await signedInUser("import-cascade@velo-atelier.test");
    const result = await importGuestState(prisma, user.id, state(guestBike()), deps);
    expect(result.ok).toBe(true);
    if (!result.ok || result.data.bikeId === null) return;
    expect(await countsFor(user.id)).toMatchObject({ checkups: 1, items: 2, lists: 1, lines: 1 });

    await prisma.bike.delete({ where: { id: result.data.bikeId } });
    expect(await countsFor(user.id)).toEqual(NOTHING);
  });
});

describe("all or nothing, per bike", () => {
  it("leaves no bike behind when the LIST write is refused by Postgres", async () => {
    const user = await signedInUser("import-atomic-list@velo-atelier.test");
    const bike = guestBike();
    // `BuildList.name` is VarChar(80). The action's schema would refuse this;
    // `importGuestState` called directly reaches Postgres with it, as the LAST
    // statement of the transaction — after the bike, its 34 part states, the
    // checkup and its items have all been inserted.
    const broken: GuestBike = { ...bike, lists: [{ ...bike.lists[0], name: "n".repeat(200) }] };

    await expect(importGuestState(prisma, user.id, state(broken), deps)).rejects.toThrow();
    // The bike row is the one that matters: if it stayed, every later import
    // would answer "already imported" and the checkup could never arrive.
    expect(await countsFor(user.id)).toEqual(NOTHING);

    // The same browser, retried with a list Postgres accepts: everything lands.
    const retry = await importGuestState(prisma, user.id, state(bike), deps);
    expect(retry.ok && retry.data.bikes[0].checkups).toEqual([
      { guestKey: CHECKUP_ID, status: "imported" },
    ]);
    expect(await countsFor(user.id)).toMatchObject({ bikes: 1, checkups: 1, lists: 1 });
  });

  it("leaves no bike behind when the CHECKUP write is refused by Postgres", async () => {
    const user = await signedInUser("import-atomic-checkup@velo-atelier.test");
    const bike = guestBike();
    // `CheckupItem.notes` is VarChar(2000): the checkup's nested insert fails,
    // one statement after the bike's.
    const broken: GuestBike = {
      ...bike,
      checkups: [{ ...bike.checkups[0], notes: { [CHAIN]: "n".repeat(2500) } }],
    };

    await expect(importGuestState(prisma, user.id, state(broken), deps)).rejects.toThrow();
    expect(await countsFor(user.id)).toEqual(NOTHING);
  });
});
