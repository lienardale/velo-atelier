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
 *   - **What Postgres refuses.** A U+0000 in a `text` column (22021) or in a
 *     `jsonb` one (22P05), and a date in year 0000 (22008), each abort the
 *     transaction: the action throws, a 500. Only the real database can say
 *     that those are refused and that year 0001 is not — which is what makes
 *     the contract's wall the right one, and in the right place.
 *
 * The fixtures are what the wizard stores (see below), including the two
 * sequences found in review on 2026-10-09: a run opened on one part and
 * carried on through another link (`resumeGuestRun` — the stored scope is
 * stale, and planning it kept 1 answer of 34), and an import whose answer was
 * lost before the guest carried on (the second import cleared the newer
 * answers on the strength of the checkup's id).
 *
 * A few tests go through `importGuestStateAction` so the whole path — session,
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
const { GUEST_STATE_VERSION, settleGuestImport } = await import("@/lib/guest/schema");
const { buildListKey, checkupKey, LOCAL_BIKE_KEY } = await import("@/lib/bike/storage-keys");
const { rateLimitKey } = await import("@/lib/auth/tokens");
// The planner the action injects — production's wiring, not a stand-in.
const { planForBuild } = await import("@/lib/content/checkup-plan");
const { deriveBike } = await import("@/lib/bike/rules");
const { reduce } = await import("@/lib/checkup/reducer");
const { fromStored, toStored } = await import("@/lib/checkup/storage");
const { BIKE_PRESETS, PRESET_IDS } = await import("@/lib/domain/data/presets");
const { validateBuild } = await import("@/lib/domain/engine/validate-build");
const { guestRun, guestWork, partsScope, resumeGuestRun } =
  await import("@/tests/_helpers/guest-work");

type GuestBike = import("@/lib/guest/schema").GuestBike;
type GuestState = import("@/lib/guest/schema").GuestState;
type GuestVerdict = import("@/tests/_helpers/guest-work").GuestVerdict;
type GuestWork = import("@/tests/_helpers/guest-work").GuestWork;
type CheckupState = import("@/lib/checkup/types").CheckupState;

const DERIVED = deriveBike(BIKE_PRESETS["gravel-1x11"]);
const LOCAL_ID = "11111111-2222-4333-8444-555555555555";
const CHECKUP_ID = "3f1d7a52-9c1e-4f2b-8d7a-0b4f2c6e1a90";
const GUEST_UPDATED_AT = "2026-09-14T09:00:00.000Z";
const STARTED_AT = "2026-09-14T08:00:00.123Z";
const COMPLETED_AT = "2026-09-14T08:20:00.000Z";

const CHAIN = "check-drivetrain#chain-wear";
const CASSETTE = "check-drivetrain#cassette-teeth";
const PAD_WEAR = "check-brakes-disc#pad-wear";

const deps = { plan: planForBuild };

/** The payload `/import` posts for what `work`'s storage holds — as JSON, like the wire. */
function payloadOf(work: GuestWork): GuestState {
  return JSON.parse(JSON.stringify(work.collect().state)) as GuestState;
}

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

    // The same guest bike again, older — bike and checkup as they were imported.
    const same = guestBike(FINISHED, {
      name: "Vieille copie",
      updatedAt: "2026-01-01T00:00:00.000Z",
    });
    const again = await importGuestState(prisma, user.id, state(same), deps);
    expect(again.ok && again.data).toMatchObject({ imported: 0, skipped: 1 });
    // The account holds this checkup, answer for answer: the browser may forget it.
    expect(again.ok && again.data.bikes[0]).toMatchObject({
      skipped: "already-imported",
      checkups: [{ guestKey: CHECKUP_ID, status: "already-imported" }],
    });
    expect(await countsFor(user.id)).toEqual(before);

    // And a copy whose checkup says something ELSE: the chain now said to be fine.
    const older = guestBike(
      { verdicts: { [CHAIN]: "ok", [CASSETTE]: "ok" } },
      { name: "Vieille copie", updatedAt: "2026-01-01T00:00:00.000Z" },
    );
    const second = await importGuestState(prisma, user.id, state(older), deps);
    expect(second.ok).toBe(true);
    if (!second.ok) return;
    expect(second.data).toMatchObject({ imported: 0, skipped: 1 });
    // Skipped like the bike — and NOT called "already imported": the account
    // holds a row under this key, with another verdict on the chain. Which of
    // the two is the right one cannot be known here, so the browser keeps its
    // own. (Until 2026-10-09 this was reported `already-imported` on the id
    // alone, and the browser cleared it.)
    expect(second.data.bikes[0]).toMatchObject({
      skipped: "already-imported",
      checkups: [{ guestKey: CHECKUP_ID, status: "skipped", reason: "bike-already-imported" }],
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
    // Not written — and not called imported either: see the next describe.
    expect(result.ok && result.data.bikes[0].checkups).toEqual([
      { guestKey: CHECKUP_ID, status: "skipped", reason: "other-bike" },
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

describe("an imported FINISHED checkup holds the rows a finish on the account writes", () => {
  /*
   * Adopted from the review of 2026-10-09: the same full checkup, answered the
   * same way, once imported from a browser and once finished natively through
   * `finishCheckupAction` on a saved bike of another account — on every
   * preset. The `CheckupItem` rows must be the same rows, and each list line
   * must be linked to the answer of the same step. (The PART STATES are not
   * compared: the import writes a KO as `BROKEN` on the part its row names,
   * the native finish `ATTENTION` through `statusByPart` — a separate ruling,
   * and neither side is to be aligned.)
   */
  function verdictsFor(build: Parameters<typeof planForBuild>[0]): Record<string, GuestVerdict> {
    return Object.fromEntries(
      planForBuild(build, { kind: "full" }).map((step, index): [string, GuestVerdict] => {
        const mode = index % 5;
        if (mode === 1) return [step.key, step.skippable ? "skipped" : "ok"];
        if (mode === 2 && step.ko.length > 0) {
          return [step.key, { ko: [step.ko[0].reasonKey], notes: `note ${index}` }];
        }
        // A KO with no symptom ticked: every consequence of the step lands.
        if (mode === 3) return [step.key, "ko"];
        if (mode === 4) return [step.key, { ok: true, notes: `ok ${index}` }];
        return [step.key, "ok"];
      }),
    );
  }

  it.each(PRESET_IDS)("%s", async (preset) => {
    const guest = await signedInUser(`import-parity-guest-${preset}@velo-atelier.test`);
    const work = guestWork({
      // eslint-disable-next-line security/detect-object-injection -- `preset` iterates the literal PRESET_IDS
      answers: BIKE_PRESETS[preset],
      checkup: (build) =>
        guestRun({
          id: crypto.randomUUID(),
          build,
          scope: { kind: "full" },
          verdicts: verdictsFor(build),
          startedAt: STARTED_AT,
          completedAt: COMPLETED_AT,
        }),
    });
    const imported = await importGuestState(prisma, guest.id, payloadOf(work), deps);
    expect(imported.ok && imported.data.bikes[0].checkups[0].status).toBe("imported");
    if (!imported.ok || imported.data.bikeId === null) return;

    // The same answers, finished natively on a saved bike of another account.
    const native = await signedInUser(`import-parity-native-${preset}@velo-atelier.test`);
    // eslint-disable-next-line security/detect-object-injection -- as above
    const derived = deriveBike(BIKE_PRESETS[preset]);
    const bike = await prisma.bike.create({
      data: {
        userId: native.id,
        name: "Natif",
        answers: derived.answers as object,
        spec: derived.spec as object,
        parts: derived.parts as unknown as object[],
        partStates: { create: derived.parts.map((part) => ({ partId: part.partId })) },
      },
    });
    const state: CheckupState = {
      ...(work.checkup as CheckupState),
      bikeRef: { kind: "db", id: bike.id },
    };
    expect((await finishCheckupAction({ bikeId: bike.id, checkup: toStored(state) })).ok).toBe(
      true,
    );

    const rowsOf = (bikeId: string) =>
      prisma.bike.findUniqueOrThrow({
        where: { id: bikeId },
        include: {
          checkups: { include: { items: true } },
          buildLists: { include: { items: true } },
        },
      });
    const [a, b] = [await rowsOf(imported.data.bikeId), await rowsOf(bike.id)];

    const itemsOf = (row: typeof a) =>
      row.checkups[0].items
        .map((item) => ({
          stepKey: item.stepKey,
          partId: item.partId,
          guideSlug: item.guideSlug,
          result: item.result,
          notes: item.notes,
          reasonKeys: item.reasonKeys,
        }))
        .sort((x, y) => x.stepKey.localeCompare(y.stepKey));
    expect(itemsOf(a).length).toBeGreaterThan(10);
    expect(itemsOf(a)).toEqual(itemsOf(b));
    expect(a.checkups[0]).toMatchObject({
      status: b.checkups[0].status,
      scope: b.checkups[0].scope,
    });

    const linesOf = (row: typeof a) => {
      const stepOfItem = new Map(row.checkups[0].items.map((item) => [item.id, item.stepKey]));
      return row.buildLists[0].items
        .map((line) => ({
          pair: `${line.action}|${line.partId}`,
          reasonKey: line.reasonKey,
          guideSlug: line.guideSlug,
          done: line.done,
          linkedStep: line.checkupItemId === null ? null : stepOfItem.get(line.checkupItemId),
        }))
        .sort((x, y) => x.pair.localeCompare(y.pair));
    };
    expect(a.buildLists).toHaveLength(1);
    expect(a.buildLists[0].checkupId).toBe(a.checkups[0].id);
    expect(linesOf(a).length).toBeGreaterThan(0);
    expect(linesOf(a)).toEqual(linesOf(b));
    // Every line of a list one finished checkup derived is linked to its answer.
    expect(linesOf(a).every((line) => line.linkedStep !== null)).toBe(true);
  });
});

describe("a run the guest left and carried on through another link (the stored scope is stale)", () => {
  /*
   * `components/checkup/Wizard.tsx`, `restore`: an unfinished stored run is
   * resumed against the plan of the URL — `fromStored(stored, props.steps)` —
   * and keeps the scope it was first opened with. `resumeGuestRun` replays it
   * call for call. Found in review on 2026-10-09, in a browser and here: the
   * import planned the STORED scope, kept 1 answer of 34, reported the checkup
   * `imported`, and the page cleared it.
   */
  function chainThen(link: Parameters<typeof resumeGuestRun>[1]) {
    const work = guestWork({
      answers: BIKE_PRESETS["gravel-1x11"],
      bikeId: LOCAL_ID,
      updatedAt: GUEST_UPDATED_AT,
      // "Contrôler cette pièce" on the chain: one answer, then the guest leaves.
      checkup: (build) =>
        guestRun({
          id: CHECKUP_ID,
          build,
          scope: partsScope("chain"),
          verdicts: { [CHAIN]: { ko: ["chain-elongation"] } },
          startedAt: STARTED_AT,
        }),
    });
    return resumeGuestRun(work, link);
  }

  it("then the FULL checkup, finished: every answer is in the account, linked, with its part states", async () => {
    const user = await signedInUser("import-stale-scope-full@velo-atelier.test");
    expect(await countsFor(user.id)).toEqual(NOTHING);
    const work = chainThen({
      scope: { kind: "full" },
      verdicts: { [PAD_WEAR]: { ko: ["pad-worn"], notes: "garniture à 0,5 mm" } },
      rest: "ok",
      completedAt: COMPLETED_AT,
    });
    const plan = planForBuild(work.build, { kind: "full" });
    const stored = JSON.parse(work.storage.getItem(checkupKey("local")) ?? "{}") as {
      scope: unknown;
      answers: Record<string, string>;
    };
    // What the wizard left: the scope of the FIRST visit, the answers of both.
    expect(stored.scope).toEqual({ kind: "parts", partIds: ["chain"] });
    expect(Object.keys(stored.answers)).toHaveLength(plan.length);
    expect(plan.length).toBeGreaterThan(30);

    const collection = work.collect();
    const result = await importGuestStateAction(payloadOf(work));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.bikes[0].checkups).toEqual([{ guestKey: CHECKUP_ID, status: "imported" }]);

    const row = await prisma.bike.findUniqueOrThrow({
      where: { id: result.data.bikeId ?? "" },
      include: {
        partStates: true,
        checkups: { include: { items: true } },
        buildLists: { include: { items: true } },
      },
    });
    const [checkup] = row.checkups;
    // Every answer the guest gave — not the one the stale scope asks.
    expect(checkup.items.map((item) => item.stepKey).sort()).toEqual(
      Object.keys(stored.answers).sort(),
    );
    expect(checkup).toMatchObject({ status: "COMPLETED", scope: "FULL" });
    expect(checkup.items.find((item) => item.stepKey === PAD_WEAR)).toMatchObject({
      result: "KO",
      notes: "garniture à 0,5 mm",
      reasonKeys: ["pad-worn"],
    });

    // The list the wizard wrote, and EVERY line of it linked to its answer.
    const [list] = row.buildLists;
    expect(list.checkupId).toBe(checkup.id);
    expect(list.items.map((line) => `${line.action}|${line.partId}`).sort()).toEqual([
      "REPLACE|brake-pads-front",
      "REPLACE|brake-pads-rear",
      "REPLACE|chain",
    ]);
    const itemIds = new Set(checkup.items.map((item) => item.id));
    expect(list.items.every((line) => itemIds.has(line.checkupItemId ?? ""))).toBe(true);

    // Part states for the whole checkup, not for the chain alone.
    const states = new Map(row.partStates.map((state) => [state.partId, state.status]));
    expect(states.get("chain")).toBe("BROKEN");
    expect(states.get("brake-caliper-front")).toBe("BROKEN");
    expect(states.get("cassette")).toBe("OK");
    expect(row.partStates.filter((state) => state.status !== "UNKNOWN").length).toBeGreaterThan(10);

    // Only now may the browser forget it: everything it held is in the account.
    expect(settleGuestImport(collection, result.data)).toEqual({
      checkup: { status: "imported" },
      clear: [LOCAL_BIKE_KEY, buildListKey("local"), checkupKey("local")],
    });
  });

  it("then ANOTHER part, finished: its answers are imported — the first part asks none of them", async () => {
    const user = await signedInUser("import-stale-scope-part@velo-atelier.test");
    const work = chainThen({
      scope: partsScope("brake-caliper-front"),
      verdicts: { [PAD_WEAR]: { ko: ["pad-worn"] } },
      rest: "ok",
      completedAt: COMPLETED_AT,
    });
    const stored = JSON.parse(work.storage.getItem(checkupKey("local")) ?? "{}") as {
      scope: unknown;
      answers: Record<string, string>;
    };
    expect(stored.scope).toEqual({ kind: "parts", partIds: ["chain"] });
    // The wizard's `reconcile` dropped the chain's answer under the brake's plan.
    expect(Object.keys(stored.answers)).not.toContain(CHAIN);
    expect(Object.keys(stored.answers).length).toBeGreaterThan(1);

    const result = await importGuestState(prisma, user.id, payloadOf(work), deps);
    // Before: `skipped: 'nothing-kept'`, no Checkup row, an unlinked list — the
    // production symptom again — and a bike in the account, so never a retry.
    expect(result.ok && result.data.bikes[0].checkups).toEqual([
      { guestKey: CHECKUP_ID, status: "imported" },
    ]);
    if (!result.ok || result.data.bikeId === null) return;
    const checkups = await prisma.checkup.findMany({
      where: { bikeId: result.data.bikeId },
      include: { items: true },
    });
    expect(checkups).toHaveLength(1);
    expect(checkups[0].items.map((item) => item.stepKey).sort()).toEqual(
      Object.keys(stored.answers).sort(),
    );
    expect(checkups[0].scope).toBe("FULL");
    const lines = await prisma.buildListItem.findMany({
      where: { buildList: { bikeId: result.data.bikeId } },
    });
    expect(lines.length).toBeGreaterThan(0);
    expect(lines.every((line) => line.checkupItemId !== null)).toBe(true);
  });

  it("then the full checkup, LEFT again: resumed on the account as the same row, no answer lost", async () => {
    const user = await signedInUser("import-stale-scope-resume@velo-atelier.test");
    // Two more answers under the full link, and the guest leaves again.
    const work = chainThen({
      scope: { kind: "full" },
      verdicts: { [CASSETTE]: "ok", [PAD_WEAR]: { ko: ["pad-worn"] } },
    });
    const result = await importGuestState(prisma, user.id, payloadOf(work), deps);
    expect(result.ok).toBe(true);
    if (!result.ok || result.data.bikeId === null) return;
    const bikeId = result.data.bikeId;

    const [imported] = await prisma.checkup.findMany({
      where: { bikeId },
      include: { items: true },
    });
    // Three answers, two of them beyond the chain: FULL — which is also what
    // lets the account's own resume plan every question they answer.
    expect(imported).toMatchObject({ status: "IN_PROGRESS", scope: "FULL" });
    expect(imported.items.map((item) => item.stepKey).sort()).toEqual(
      [CHAIN, CASSETTE, PAD_WEAR].sort(),
    );

    // The account's resume, as the page and the wizard do it.
    const stored = await loadStoredCheckup(bikeId, user.id, "fr");
    expect(stored?.scope).toEqual({ kind: "full" });
    if (stored == null) return;
    let run = fromStored(stored, planForBuild(work.build, stored.scope), stored.contentVersion);
    expect(Object.keys(run.answers).sort()).toEqual([CHAIN, CASSETTE, PAD_WEAR].sort());
    const next = run.steps[run.cursor];
    run = reduce(run, { type: "ANSWER", key: next.key, result: "ok" });
    expect((await saveCheckupAction({ bikeId, checkup: toStored(run) })).ok).toBe(true);

    const after = await prisma.checkup.findMany({ where: { bikeId }, include: { items: true } });
    expect(after).toHaveLength(1);
    expect(after[0].id).toBe(imported.id);
    // The three imported answers are still there, the new one beside them.
    expect(after[0].items.map((item) => item.stepKey).sort()).toEqual(
      [CHAIN, CASSETTE, PAD_WEAR, next.key].sort(),
    );
  });
});

describe("`already-imported` is a statement about the checkup's CONTENT, not its id", () => {
  it("an import whose answer was lost, then more work in the browser: nothing written, and the checkup KEPT", async () => {
    const user = await signedInUser("import-lost-answer@velo-atelier.test");

    // The guest: chain KO, the checkup left in progress. `/import` runs, the
    // server writes — and the response never reaches the page: keys kept.
    const work = guestWork({
      answers: BIKE_PRESETS["gravel-1x11"],
      bikeId: LOCAL_ID,
      checkup: (build) =>
        guestRun({
          id: CHECKUP_ID,
          build,
          scope: partsScope("chain", "cassette"),
          verdicts: { [CHAIN]: { ko: ["chain-elongation"] } },
          startedAt: STARTED_AT,
        }),
    });
    const first = await importGuestState(prisma, user.id, payloadOf(work), deps);
    expect(first.ok && first.data.imported).toBe(1);
    const afterFirst = await countsFor(user.id);
    expect(afterFirst).toMatchObject({ bikes: 1, checkups: 1, items: 1, lists: 0 });

    // The same browser, the same run: the cassette answered, "Créer ma liste".
    const resumed = resumeGuestRun(work, {
      scope: partsScope("chain", "cassette"),
      verdicts: { [CASSETTE]: { ko: ["cassette-worn"], notes: "dents en aileron de requin" } },
      completedAt: COMPLETED_AT,
    });
    const newer = resumed.storage.getItem(checkupKey("local"));
    expect(newer).toContain("cassette-worn");
    expect(resumed.storage.getItem(buildListKey("local"))).not.toBeNull();

    // `/import` again.
    const collection = resumed.collect();
    const second = await importGuestState(prisma, user.id, payloadOf(resumed), deps);
    expect(second.ok).toBe(true);
    if (!second.ok) return;

    // §6.8 AC8, unchanged: the bike is there, so NOTHING is written…
    expect(await countsFor(user.id)).toEqual(afterFirst);
    expect(second.data.bikes[0].skipped).toBe("already-imported");
    // …and therefore the account does NOT hold what the browser now does: the
    // cassette's answer, the completion. Reported `already-imported` on the
    // id, the page cleared all three keys and said nothing.
    expect(second.data.bikes[0].checkups).toEqual([
      { guestKey: CHECKUP_ID, status: "skipped", reason: "bike-already-imported" },
    ]);
    const settlement = settleGuestImport(collection, second.data);
    expect(settlement.checkup).toEqual({ status: "skipped", reason: "bike-already-imported" });
    // The bike and the list go, as ruled; the checkup STAYS.
    expect(settlement.clear).toEqual([LOCAL_BIKE_KEY, buildListKey("local")]);
    expect(resumed.storage.getItem(checkupKey("local"))).toBe(newer);
  });

  it("the same lost answer with NO further work: the copy is in the account, and the browser may forget it", async () => {
    const user = await signedInUser("import-lost-answer-same@velo-atelier.test");
    const work = guestWork({
      answers: BIKE_PRESETS["gravel-1x11"],
      bikeId: LOCAL_ID,
      checkup: (build) =>
        guestRun({
          id: CHECKUP_ID,
          build,
          scope: partsScope("chain", "cassette"),
          verdicts: { [CHAIN]: { ko: ["chain-elongation"], notes: "0,8 %" } },
          startedAt: STARTED_AT,
        }),
    });
    expect((await importGuestState(prisma, user.id, payloadOf(work), deps)).ok).toBe(true);
    const before = await countsFor(user.id);

    const collection = work.collect();
    const second = await importGuestState(prisma, user.id, payloadOf(work), deps);
    expect(second.ok && second.data.bikes[0].checkups).toEqual([
      { guestKey: CHECKUP_ID, status: "already-imported" },
    ]);
    expect(await countsFor(user.id)).toEqual(before);
    if (!second.ok) return;
    expect(settleGuestImport(collection, second.data).clear).toEqual([
      LOCAL_BIKE_KEY,
      buildListKey("local"),
      checkupKey("local"),
    ]);
  });

  it("a run carried on IN THE ACCOUNT since: the browser's older copy adds nothing, and may go", async () => {
    const user = await signedInUser("import-carried-on@velo-atelier.test");
    const work = guestWork({
      answers: BIKE_PRESETS["gravel-1x11"],
      bikeId: LOCAL_ID,
      checkup: (build) =>
        guestRun({
          id: CHECKUP_ID,
          build,
          scope: { kind: "full" },
          verdicts: { [CHAIN]: { ko: ["chain-elongation"] } },
          startedAt: STARTED_AT,
        }),
    });
    const first = await importGuestState(prisma, user.id, payloadOf(work), deps);
    if (!first.ok || first.data.bikeId === null) throw new Error("the first import failed");
    const bikeId = first.data.bikeId;

    // On the account: the next question answered through the real save action.
    const stored = await loadStoredCheckup(bikeId, user.id, "fr");
    if (stored === null) throw new Error("nothing to resume");
    let run = fromStored(stored, planForBuild(work.build, stored.scope), stored.contentVersion);
    run = reduce(run, { type: "ANSWER", key: run.steps[run.cursor].key, result: "ok" });
    expect((await saveCheckupAction({ bikeId, checkup: toStored(run) })).ok).toBe(true);
    expect(await prisma.checkupItem.count({ where: { checkup: { bikeId } } })).toBe(2);

    // The browser's copy — one answer, which the row has.
    const second = await importGuestState(prisma, user.id, payloadOf(work), deps);
    expect(second.ok && second.data.bikes[0].checkups).toEqual([
      { guestKey: CHECKUP_ID, status: "already-imported" },
    ]);
    expect(await prisma.checkupItem.count({ where: { checkup: { bikeId } } })).toBe(2);
  });

  it("a NEW guest bike carrying a run the account holds under another bike: imported WITHOUT it, and the checkup kept", async () => {
    const user = await signedInUser("import-other-bike@velo-atelier.test");
    const first = guestWork({
      answers: BIKE_PRESETS["gravel-1x11"],
      bikeId: LOCAL_ID,
      checkup: (build) =>
        guestRun({
          id: CHECKUP_ID,
          build,
          scope: partsScope("chain", "cassette"),
          verdicts: { [CHAIN]: "ok" },
          startedAt: STARTED_AT,
        }),
    });
    expect((await importGuestState(prisma, user.id, payloadOf(first), deps)).ok).toBe(true);

    // The same browser, another guest bike, and the SAME run under the key —
    // now finished, against that bike, with a KO.
    const second = guestWork({
      answers: BIKE_PRESETS["road-disc-2x12"],
      bikeId: "22222222-3333-4444-8555-666666666666",
      checkup: (build) =>
        guestRun({
          id: CHECKUP_ID,
          build,
          scope: partsScope("chain", "cassette"),
          verdicts: { [CHAIN]: { ko: ["chain-elongation"] }, [CASSETTE]: "ok" },
          startedAt: STARTED_AT,
          completedAt: COMPLETED_AT,
        }),
    });
    const raw = second.storage.getItem(checkupKey("local"));
    const collection = second.collect();
    const result = await importGuestState(prisma, user.id, payloadOf(second), deps);
    expect(result.ok).toBe(true);
    if (!result.ok || result.data.bikeId === null) return;

    // The bike is imported; the key is unique, so no second Checkup row…
    expect(result.data).toMatchObject({ imported: 1, skipped: 0 });
    expect(await prisma.checkup.count({ where: { bikeId: result.data.bikeId } })).toBe(0);
    expect(await prisma.checkup.count({ where: { bike: { userId: user.id } } })).toBe(1);
    // …and the answer does not pretend otherwise: skipped, with its reason.
    expect(result.data.bikes[0].checkups).toEqual([
      { guestKey: CHECKUP_ID, status: "skipped", reason: "other-bike" },
    ]);
    // So the list is unlinked, no part has a status — and the browser keeps
    // the checkup those would have come from.
    const lists = await prisma.buildList.findMany({
      where: { bikeId: result.data.bikeId },
      include: { items: true },
    });
    expect(lists.map((list) => list.checkupId)).toEqual([null]);
    expect(lists[0].items.every((line) => line.checkupItemId === null)).toBe(true);
    expect(
      await prisma.bikePartState.count({
        where: { bikeId: result.data.bikeId, status: { not: "UNKNOWN" } },
      }),
    ).toBe(0);
    const settlement = settleGuestImport(collection, result.data);
    expect(settlement).toEqual({
      checkup: { status: "skipped", reason: "other-bike" },
      clear: [LOCAL_BIKE_KEY, buildListKey("local")],
    });
    expect(second.storage.getItem(checkupKey("local"))).toBe(raw);
  });
});

describe("what PostgreSQL would refuse is a VALIDATION, not a 500", () => {
  const NUL = String.fromCharCode(0);

  /** A finished checkup, its list — and one line carrying what the visitor typed. */
  function withTypedLine(): GuestBike {
    const bike = guestBike();
    bike.lists[0].items[0] = {
      ...bike.lists[0].items[0],
      refinement: { speeds: "11" },
      chosenProduct: {
        brand: "Shimano",
        model: "CN-HG601",
        size: "11v",
        vendor: "other",
        url: "https://example.com/chaine",
      },
    };
    return bike;
  }

  /** One field of the payload, with a U+0000 in it. */
  const POISONED: Record<string, (bike: GuestBike) => void> = {
    "the bike's name (text)": (bike) => {
      bike.name = `Mon${NUL}vélo`;
    },
    "a checkup note (text)": (bike) => {
      bike.checkups[0].notes = { [CHAIN]: `usure${NUL}0,8 %` };
    },
    "the list's name (text)": (bike) => {
      bike.lists[0].name = `Ma${NUL}liste`;
    },
    "a refinement value (jsonb)": (bike) => {
      bike.lists[0].items[0].refinement = { speeds: `11${NUL}` };
    },
    "a chosen product's model (jsonb)": (bike) => {
      const product = bike.lists[0].items[0].chosenProduct;
      if (product !== undefined) product.model = `CN${NUL}HG601`;
    },
    "a part's free-text attribute (jsonb)": (bike) => {
      const pads = (bike.parts as { partId: string; attributes: Record<string, unknown> }[]).find(
        (part) => part.partId === "brake-pads-front",
      );
      if (pads === undefined) throw new Error("the gravel preset has front brake pads");
      pads.attributes["pad-model"] = `B05S${NUL}`;
    },
  };

  it.each(Object.keys(POISONED))(
    "a U+0000 in %s: Postgres refuses the transaction — and the action answers VALIDATION before it",
    async (field) => {
      const user = await signedInUser(
        `import-nul-${Object.keys(POISONED).indexOf(field)}@velo-atelier.test`,
      );
      const bike = withTypedLine();
      // eslint-disable-next-line security/detect-object-injection -- a key of the literal table above
      POISONED[field](bike);

      // Why the wall exists: past the contract, the database throws, and the
      // whole bike is rolled back.
      await expect(importGuestState(prisma, user.id, state(bike), deps)).rejects.toThrow();
      expect(await countsFor(user.id)).toEqual(NOTHING);

      // The wall: an answer the page can show, nothing written, no attempt spent.
      expect(await importGuestStateAction(state(bike))).toEqual({ ok: false, code: "VALIDATION" });
      expect(await countsFor(user.id)).toEqual(NOTHING);
      expect(
        await prisma.authAttempt.findUnique({
          where: { key: rateLimitKey("guest-import", user.id) },
        }),
      ).toBeNull();
    },
  );

  it("the same payload without the U+0000 is imported whole — the wall refuses the character, not the field", async () => {
    const user = await signedInUser("import-nul-control@velo-atelier.test");
    const bike = withTypedLine();
    const pads = (bike.parts as { partId: string; attributes: Record<string, unknown> }[]).find(
      (part) => part.partId === "brake-pads-front",
    );
    if (pads !== undefined) pads.attributes["pad-model"] = "B05S";
    bike.checkups[0].notes = { [CHAIN]: "usure 0,8 %" };
    const result = await importGuestStateAction(state(bike));
    expect(result.ok && result.data.bikes[0].checkups).toEqual([
      { guestKey: CHECKUP_ID, status: "imported" },
    ]);
    const row = await prisma.bike.findFirstOrThrow({ where: { userId: user.id } });
    const stored = (row.parts as { partId: string; attributes: Record<string, unknown> }[]).find(
      (part) => part.partId === "brake-pads-front",
    );
    expect(stored?.attributes["pad-model"]).toBe("B05S");
  });

  it("a date in year 0000: Postgres has no such year — VALIDATION; year 0001 is stored", async () => {
    const user = await signedInUser("import-year-zero@velo-atelier.test");
    const YEAR_ZERO = "0000-06-15T00:00:00.000Z";
    // The two dates that reach a column as they came (never later than now).
    const fields: Record<string, (bike: GuestBike) => void> = {
      "a checkup's startedAt": (bike) => {
        bike.checkups[0].startedAt = YEAR_ZERO;
      },
      "the bike's updatedAt": (bike) => {
        bike.updatedAt = YEAR_ZERO;
      },
    };
    for (const [field, set] of Object.entries(fields)) {
      const bike = guestBike();
      set(bike);
      // Past the contract, the transaction throws (22008)…
      await expect(importGuestState(prisma, user.id, state(bike), deps), field).rejects.toThrow();
      // …so the contract refuses it first.
      expect(await importGuestStateAction(state(bike)), field).toEqual({
        ok: false,
        code: "VALIDATION",
      });
      expect(await countsFor(user.id), field).toEqual(NOTHING);
    }
    // `completedAt` is held to the same rule by the contract, though the
    // import would have raised it to `startedAt` before Postgres saw it.
    const finishedInYearZero = guestBike();
    finishedInYearZero.checkups[0].completedAt = YEAR_ZERO;
    expect(await importGuestStateAction(state(finishedInYearZero))).toEqual({
      ok: false,
      code: "VALIDATION",
    });
    // An offset cannot walk a year-1 date back into year 0 either.
    const walked = guestBike();
    walked.checkups[0].startedAt = "0001-01-01T00:00:00.000+14:00";
    expect(await importGuestStateAction(state(walked))).toEqual({ ok: false, code: "VALIDATION" });
    expect(await countsFor(user.id)).toEqual(NOTHING);

    // The bound is the database's, not a guess: the first instant of year 1 is stored.
    const earliest = guestBike();
    earliest.checkups[0].startedAt = "0001-01-01T00:00:00.000Z";
    earliest.updatedAt = "0001-01-01T00:00:00.000Z";
    const result = await importGuestStateAction(state(earliest));
    expect(result.ok && result.data.bikes[0].checkups).toEqual([
      { guestKey: CHECKUP_ID, status: "imported" },
    ]);
    const row = await prisma.checkup.findFirstOrThrow({ where: { bike: { userId: user.id } } });
    expect(row.startedAt.toISOString()).toBe("0001-01-01T00:00:00.000Z");
    const bikeRow = await prisma.bike.findFirstOrThrow({ where: { userId: user.id } });
    expect(bikeRow.updatedAt.toISOString()).toBe("0001-01-01T00:00:00.000Z");
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
