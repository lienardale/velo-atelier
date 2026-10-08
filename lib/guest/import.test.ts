/**
 * `importGuestState` against the recording fake.
 *
 * The fake is driven by `prisma/schema.prisma` itself, so the constraints that
 * carry this feature — `@@unique([userId, guestLocalId])`, the unique
 * `Checkup.guestKey`, `@@unique([buildListId, partId, action])` — behave here
 * the way they behave in Postgres, and so does a transaction that fails half
 * way. `tests/integration/guest-import.test.ts` is where the real database
 * confirms it.
 *
 * What is proven here: the row shapes, that the SERVER decides what a checkup's
 * answers are about (the plan, never the payload), the links a finished checkup
 * owns on the list, the part states, the idempotency, the clamps, and what the
 * summary tells the browser about each checkup.
 *
 * Every checkup below is a real one: `tests/_helpers/guest-work.ts` plans the
 * bike, runs the reducer, stores `toStored(state)` under the real key and
 * collects it back. Until 2026-10-07 these fixtures were hand-written items
 * with a part and a guide chosen by the test — a shape the collector could
 * never produce from what the wizard stores (`.debug/017` §5.6). A case that
 * needs a payload no browser sends starts from a collected one and breaks
 * exactly one thing.
 */
/* eslint-disable security/detect-object-injection -- step keys the test spells out, into its own fixtures */
import { beforeEach, describe, expect, it } from "vitest";

import { fakeDb } from "@/tests/_fakes/prisma";
import { deriveBike, QUOTAS } from "@/lib/bike/rules";
import type { CheckupState } from "@/lib/checkup/types";
import { BIKE_PRESETS } from "@/lib/domain/data/presets";
import { validateBuild } from "@/lib/domain/engine/validate-build";
import type { BikeBuild } from "@/lib/domain/schema/part";
import {
  guestRun,
  guestWork,
  partsScope,
  planFromDisk,
  type GuestVerdict,
} from "@/tests/_helpers/guest-work";

import { guestCheckupKey, importGuestState, type GuestImportStore } from "./import";
import {
  GUEST_CAPS,
  GUEST_STATE_VERSION,
  type GuestBike,
  type GuestBuildList,
  type GuestCheckup,
  type GuestState,
} from "./schema";

const NOW = Date.parse("2026-09-15T12:00:00.000Z");
const now = () => NOW;
const deps = { plan: planFromDisk, now };

const DERIVED = deriveBike(BIKE_PRESETS["gravel-1x11"]);
const LOCAL_ID = "11111111-2222-4333-8444-555555555555";
const CHECKUP_ID = "3f1d7a52-9c1e-4f2b-8d7a-0b4f2c6e1a90";
/** A second checkup, patterned rather than random: gitleaks reads a high-entropy uuid literal as a key. */
const OLDER_CHECKUP_ID = "00000000-0000-4000-8000-0000000000c1";

const CHAIN = "check-drivetrain#chain-wear";
const CASSETTE = "check-drivetrain#cassette-teeth";
const PAD_WEAR = "check-brakes-disc#pad-wear";
const ALIGNMENT = "check-brakes-disc#caliper-alignment";
const HOSE = "check-brakes-disc#hose-leak";

const STARTED_AT = "2026-09-14T08:00:00.000Z";
const COMPLETED_AT = "2026-09-14T08:20:00.000Z";

interface RunOptions {
  id?: string;
  parts?: string[];
  verdicts: Record<string, GuestVerdict>;
  startedAt?: string;
  /** `null` leaves the checkup in progress. */
  completedAt?: string | null;
}

/** A wizard run over this bike's real plan. */
function run(build: BikeBuild, options: RunOptions): CheckupState {
  return guestRun({
    id: options.id ?? CHECKUP_ID,
    build,
    scope: options.parts === undefined ? { kind: "full" } : partsScope(...options.parts),
    verdicts: options.verdicts,
    startedAt: options.startedAt ?? STARTED_AT,
    ...(options.completedAt === null ? {} : { completedAt: options.completedAt ?? COMPLETED_AT }),
  });
}

/** The guest bike as `/import` would send it, with the checkup and list the wizard left. */
function collected(checkup?: RunOptions, patch: Partial<GuestBike> = {}): GuestBike {
  const work = guestWork({
    answers: BIKE_PRESETS["gravel-1x11"],
    bikeId: LOCAL_ID,
    fit: { saddleHeightMm: 742 },
    updatedAt: "2026-09-14T09:00:00.000Z",
    ...(checkup === undefined ? {} : { checkup: (build) => run(build, checkup) }),
  });
  const [bike] = (JSON.parse(JSON.stringify(work.collect().state)) as GuestState).bikes;
  return { ...bike, ...patch };
}

/** One checkup of a payload — what `collected(run).checkups[0]` is. */
function checkupOf(options: RunOptions): GuestCheckup {
  const [checkup] = collected(options).checkups;
  if (checkup === undefined) throw new Error("the collector read no checkup");
  return checkup;
}

function state(...bikes: GuestBike[]): GuestState {
  return { version: GUEST_STATE_VERSION, bikes };
}

/** The chain is worn, the cassette is fine: one KO with its symptom and a note, one OK. */
const CHAIN_AND_CASSETTE: RunOptions = {
  parts: ["chain", "cassette"],
  verdicts: {
    [CHAIN]: { ko: ["chain-elongation"], notes: "élongation 0,8 %" },
    [CASSETTE]: "ok",
  },
};

type Row = Record<string, unknown>;
const rows = (model: string) => fakeDb.rows(model) as Row[];
const partStates = () =>
  new Map(
    (
      rows("BikePartState") as { partId: string; status: string; lastServicedAt: Date | null }[]
    ).map((row) => [row.partId, row]),
  );

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
    const result = await importGuestState(fakeDb.client, userId, state(collected()), deps);
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.data).toMatchObject({ imported: 1, skipped: 0 });
    const [row] = rows("Bike");
    expect(row.userId).toBe(userId);
    expect(row.guestLocalId).toBe(LOCAL_ID);
    expect(row.name).toBe("Mon vélo");
    expect(row.answers).toEqual(DERIVED.answers);
    expect(row.spec).toEqual(DERIVED.spec);
    expect(validateBuild({ spec: row.spec, parts: row.parts }).ok).toBe(true);
    expect(rows("BikePartState")).toHaveLength(DERIVED.parts.length);
    expect(row.fit).toEqual({ saddleHeightMm: 742 });
    // The id the summary names is the row's — generated here, not by the database.
    expect(result.data.bikeId).toBe(row.id);
    expect(result.data.bikes).toEqual([{ localId: LOCAL_ID, bikeId: row.id, checkups: [] }]);
  });

  it("keeps the owner's attribute edits", async () => {
    const edited = DERIVED.parts.map((part) =>
      part.partId === "chainring" ? { ...part, attributes: { teeth: 42 } } : part,
    );
    await importGuestState(
      fakeDb.client,
      userId,
      state(collected(undefined, { parts: edited })),
      deps,
    );

    const [row] = rows("Bike") as {
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
    await importGuestState(
      fakeDb.client,
      userId,
      state(collected(undefined, { parts: edited })),
      deps,
    );

    const [row] = rows("Bike") as { parts: unknown[] }[];
    expect(row.parts).toEqual(DERIVED.parts);
  });

  it("falls back to the default parts when the payload's build is not valid", async () => {
    const result = await importGuestState(
      fakeDb.client,
      userId,
      state(collected(undefined, { parts: [{ partId: "__proto__", attributes: {} }] })),
      deps,
    );
    expect(result.ok).toBe(true);
    const [row] = rows("Bike") as { parts: unknown[] }[];
    expect(row.parts).toEqual(DERIVED.parts);
  });

  it("drops a fit measurement it does not recognise instead of refusing the bike", async () => {
    await importGuestState(
      fakeDb.client,
      userId,
      state(collected(undefined, { fit: { saddleHeightMm: 742, nope: 1, reachMm: 99_999 } })),
      deps,
    );
    expect(rows("Bike")[0].fit).toEqual({ saddleHeightMm: 742 });
  });

  it("stores no fit at all when nothing survives", async () => {
    await importGuestState(
      fakeDb.client,
      userId,
      state(collected(undefined, { fit: { nope: 1 } })),
      deps,
    );
    expect(rows("Bike")[0].fit).toBeNull();
  });

  it("never stores a date the visitor's clock put in the future (§4.7)", async () => {
    const ahead = collected(undefined, { updatedAt: "2087-01-01T00:00:00.000Z" });
    await importGuestState(fakeDb.client, userId, state(ahead), deps);
    const [row] = rows("Bike") as { updatedAt: Date }[];
    expect(row.updatedAt.getTime()).toBe(NOW);
  });
});

describe("a checkup: the server re-plans (§5.4)", () => {
  it("becomes a Checkup and one CheckupItem per answered planned step", async () => {
    const result = await importGuestState(
      fakeDb.client,
      userId,
      state(collected(CHAIN_AND_CASSETTE)),
      deps,
    );
    expect(result.ok && result.data.bikes[0].checkups).toEqual([
      { guestKey: CHECKUP_ID, status: "imported" },
    ]);

    const [bike] = rows("Bike");
    const [checkup] = rows("Checkup");
    expect(checkup.bikeId).toBe(bike.id);
    expect(checkup.guestKey).toBe(guestCheckupKey(userId, CHECKUP_ID));
    expect(checkup.scope).toBe("PARTIAL");
    expect(checkup.status).toBe("COMPLETED");
    expect((checkup.startedAt as Date).toISOString()).toBe(STARTED_AT);
    expect((checkup.completedAt as Date).toISOString()).toBe(COMPLETED_AT);

    // The columns `writeItems` writes — and the part and the guide come from
    // the PLAN: the payload named neither.
    const items = rows("CheckupItem").map((item) => ({
      checkupId: item.checkupId,
      stepKey: item.stepKey,
      partId: item.partId,
      guideSlug: item.guideSlug,
      result: item.result,
      notes: item.notes,
      reasonKeys: item.reasonKeys,
    }));
    expect(items).toEqual([
      {
        checkupId: checkup.id,
        stepKey: CHAIN,
        partId: "chain",
        guideSlug: "check-drivetrain",
        result: "KO",
        notes: "élongation 0,8 %",
        reasonKeys: ["chain-elongation"],
      },
      {
        checkupId: checkup.id,
        stepKey: CASSETTE,
        partId: "cassette",
        guideSlug: "check-drivetrain",
        result: "OK",
        notes: null,
        reasonKeys: [],
      },
    ]);
  });

  it("asks the planner for THIS bike's plan and the checkup's own scope", async () => {
    const seen: { parts: number; scope: unknown }[] = [];
    await importGuestState(fakeDb.client, userId, state(collected(CHAIN_AND_CASSETTE)), {
      now,
      plan: (build, scope) => {
        seen.push({ parts: build.parts.length, scope });
        expect(build.spec).toEqual(DERIVED.spec);
        return planFromDisk(build, scope);
      },
    });
    expect(seen).toEqual([
      { parts: DERIVED.parts.length, scope: { kind: "parts", partIds: ["chain", "cassette"] } },
    ]);
  });

  it("drops an answer whose key is not in the plan, and keeps the rest", async () => {
    const checkup = checkupOf(CHAIN_AND_CASSETTE);
    // A real question of a real guide — for a bike with RIM brakes. And one no
    // guide has ever asked.
    checkup.answers["check-brakes-rim#pad-wear"] = "ko";
    checkup.notes["check-brakes-rim#pad-wear"] = "inventé";
    checkup.answers["check-drivetrain#not-a-step"] = "ko";

    await importGuestState(
      fakeDb.client,
      userId,
      state(collected(undefined, { checkups: [checkup] })),
      deps,
    );
    expect(rows("CheckupItem").map((item) => item.stepKey)).toEqual([CHAIN, CASSETTE]);
  });

  it("drops a symptom the step does not offer", async () => {
    const checkup = checkupOf(CHAIN_AND_CASSETTE);
    // `pad-worn` is a real reason — of the brake-pad question.
    checkup.symptoms[CHAIN] = ["pad-worn", "chain-elongation", "not-a-reason"];
    // A symptom on a step answered OK is not a symptom at all.
    checkup.symptoms[CASSETTE] = ["cassette-worn"];

    await importGuestState(
      fakeDb.client,
      userId,
      state(collected(undefined, { checkups: [checkup] })),
      deps,
    );
    const byKey = new Map(rows("CheckupItem").map((item) => [item.stepKey, item.reasonKeys]));
    expect(byKey.get(CHAIN)).toEqual(["chain-elongation"]);
    expect(byKey.get(CASSETTE)).toEqual([]);
  });

  it("writes NO row for a checkup none of whose answers the plan asks, and says so", async () => {
    const checkup = checkupOf(CHAIN_AND_CASSETTE);
    checkup.answers = { "check-brakes-rim#pad-wear": "ko" };
    checkup.symptoms = {};
    checkup.notes = {};

    const result = await importGuestState(
      fakeDb.client,
      userId,
      state(collected(undefined, { checkups: [checkup] })),
      deps,
    );
    expect(result.ok && result.data.bikes[0]).toMatchObject({
      localId: LOCAL_ID,
      checkups: [{ guestKey: CHECKUP_ID, status: "skipped", reason: "nothing-kept" }],
    });
    // The bike is imported all the same; the checkup stays the browser's.
    expect(rows("Bike")).toHaveLength(1);
    expect(rows("Checkup")).toEqual([]);
    expect(rows("CheckupItem")).toEqual([]);
  });

  it("writes no row for a scope that names no part of this bike", async () => {
    const checkup = checkupOf(CHAIN_AND_CASSETTE);
    checkup.scope = { kind: "parts", partIds: ["part-from-2019"] };
    const result = await importGuestState(
      fakeDb.client,
      userId,
      state(collected(undefined, { checkups: [checkup] })),
      deps,
    );
    expect(result.ok && result.data.bikes[0].checkups[0]).toMatchObject({
      status: "skipped",
      reason: "nothing-kept",
    });
    expect(rows("Checkup")).toEqual([]);
  });

  it("is IN_PROGRESS while it has no end, and FULL when it is about the whole bike", async () => {
    await importGuestState(
      fakeDb.client,
      userId,
      state(collected({ verdicts: { [CHAIN]: "ok" }, completedAt: null })),
      deps,
    );
    const [checkup] = rows("Checkup");
    expect(checkup.status).toBe("IN_PROGRESS");
    expect(checkup.scope).toBe("FULL");
    expect(checkup.completedAt).toBeNull();
    expect(rows("CheckupItem")).toHaveLength(1);
  });

  it("stays COMPLETED when the corpus has grown a question since it was finished", async () => {
    // The visitor finished this checkup; the plan the server computes TODAY
    // asks one question more. `reconcile` would call that "in progress again"
    // — the import does not: a finished checkup is history, for the wizard
    // (`isFinished`) and for an account's own rows alike.
    const grown: typeof planFromDisk = (build, scope) => {
      const plan = planFromDisk(build, scope);
      return [...plan, { ...plan[0], key: "check-drivetrain#added-since", stepId: "added-since" }];
    };
    const bike = collected(CHAIN_AND_CASSETTE);
    await importGuestState(fakeDb.client, userId, state(bike), { plan: grown, now });

    const [row] = rows("Checkup") as { id: string; status: string; completedAt: Date }[];
    expect(row.status).toBe("COMPLETED");
    expect(row.completedAt.toISOString()).toBe(COMPLETED_AT);
    // Rows for what was answered, and none for the question nobody was asked.
    expect(rows("CheckupItem").map((item) => item.stepKey)).toEqual([CHAIN, CASSETTE]);
    // Finished, so it does what a finished checkup does (§4.2 b).
    expect(partStates().get("chain")?.status).toBe("BROKEN");
    expect(partStates().get("cassette")?.status).toBe("OK");
    expect(rows("BuildList")[0].checkupId).toBe(row.id);
  });

  it("is IN_PROGRESS without a completedAt, even with every question answered", async () => {
    // On the summary, "Créer ma liste" not pressed yet: answering the last
    // question is not finishing.
    await importGuestState(
      fakeDb.client,
      userId,
      state(
        collected({
          parts: ["chain", "cassette"],
          verdicts: { [CHAIN]: { ko: ["chain-elongation"] }, [CASSETTE]: "ok" },
          completedAt: null,
        }),
      ),
      deps,
    );
    const [row] = rows("Checkup");
    expect(row.status).toBe("IN_PROGRESS");
    expect(row.completedAt).toBeNull();
    expect(rows("CheckupItem")).toHaveLength(2);
    // …and so no part is declared broken or fine on the strength of it.
    expect(new Set([...partStates().values()].map((part) => part.status))).toEqual(
      new Set(["UNKNOWN"]),
    );
  });

  it("keeps a past startedAt to the millisecond — it is how the account recognises the run", async () => {
    const startedAt = "2026-09-14T08:00:00.123Z";
    await importGuestState(
      fakeDb.client,
      userId,
      state(collected({ ...CHAIN_AND_CASSETTE, startedAt })),
      deps,
    );
    const [checkup] = rows("Checkup") as { startedAt: Date }[];
    expect(checkup.startedAt.toISOString()).toBe(startedAt);
  });

  it("clamps both ends, and never finishes before it started", async () => {
    await importGuestState(
      fakeDb.client,
      userId,
      state(
        collected({
          ...CHAIN_AND_CASSETTE,
          startedAt: "2087-01-01T00:00:00.000Z",
          completedAt: "2000-01-01T00:00:00.000Z",
        }),
      ),
      deps,
    );
    const [checkup] = rows("Checkup") as { startedAt: Date; completedAt: Date }[];
    expect(checkup.startedAt.getTime()).toBe(NOW);
    expect(checkup.completedAt.getTime()).toBe(NOW);
  });

  it("falls back to now for a date it cannot parse at all", async () => {
    const checkup = checkupOf({ ...CHAIN_AND_CASSETTE, completedAt: null });
    checkup.startedAt = "bientôt";
    await importGuestState(
      fakeDb.client,
      userId,
      state(collected(undefined, { checkups: [checkup] })),
      deps,
    );
    const [row] = rows("Checkup") as { startedAt: Date }[];
    expect(row.startedAt.getTime()).toBe(NOW);
  });

  it("writes one checkup for a guestKey the payload repeats, and reports it once", async () => {
    const checkup = checkupOf(CHAIN_AND_CASSETTE);
    const again = { ...checkup, answers: { [CHAIN]: "ok" as const, [CASSETTE]: "ok" as const } };
    const result = await importGuestState(
      fakeDb.client,
      userId,
      state(collected(undefined, { checkups: [checkup, again] })),
      deps,
    );
    expect(result.ok && result.data.bikes[0].checkups).toEqual([
      { guestKey: CHECKUP_ID, status: "imported" },
    ]);
    expect(rows("Checkup")).toHaveLength(1);
    // The first one won: the chain is the KO it said.
    expect(rows("CheckupItem").find((item) => item.stepKey === CHAIN)?.result).toBe("KO");
  });

  it("cannot bring more checkups than a bike may hold", () => {
    expect(GUEST_CAPS.checkupsPerBike).toBeLessThanOrEqual(QUOTAS.checkupsPerBike);
  });
});

describe("part states (§4.2 b)", () => {
  it("a finished checkup leaves its parts BROKEN or serviced, and a skipped one alone", async () => {
    await importGuestState(
      fakeDb.client,
      userId,
      state(
        collected({
          parts: ["chain", "cassette", "brake-caliper-rear"],
          verdicts: {
            [CHAIN]: "skipped",
            [CASSETTE]: "ok",
            [PAD_WEAR]: { ko: ["pad-worn"] },
            [ALIGNMENT]: "ok",
            [HOSE]: "ok",
          },
        }),
      ),
      deps,
    );
    const states = partStates();
    expect(rows("Checkup")[0].status).toBe("COMPLETED");

    expect(states.get("cassette")?.status).toBe("OK");
    expect(states.get("cassette")?.lastServicedAt?.toISOString()).toBe(COMPLETED_AT);
    // SKIPPED says nothing about the part.
    expect(states.get("chain")?.status).toBe("UNKNOWN");
    expect(states.get("chain")?.lastServicedAt).toBeNull();
    // KO → BROKEN, with no service date.
    expect(states.get("brake-caliper-front")?.status).toBe("BROKEN");
    expect(states.get("brake-caliper-front")?.lastServicedAt).toBeNull();
  });

  it("gives a status to the part each ITEM names — the step's first — and to no other", async () => {
    await importGuestState(
      fakeDb.client,
      userId,
      state(
        collected({
          parts: ["brake-caliper-rear"],
          verdicts: { [PAD_WEAR]: "ok", [ALIGNMENT]: "ok", [HOSE]: "ok" },
        }),
      ),
      deps,
    );
    // Every one of these three questions reports on several parts…
    const plan = planFromDisk(DERIVED, partsScope("brake-caliper-rear"));
    expect(plan.map((step) => step.partIds)).toEqual([
      ["brake-caliper-front", "brake-caliper-rear"],
      ["brake-caliper-front", "brake-caliper-rear"],
      ["brake-lever-front", "brake-lever-rear", "brake-caliper-front", "brake-caliper-rear"],
    ]);
    // …and each row names the first of them, which is the part that is written.
    expect(rows("CheckupItem").map((item) => item.partId)).toEqual([
      "brake-caliper-front",
      "brake-caliper-front",
      "brake-lever-front",
    ]);
    const states = partStates();
    expect(states.get("brake-caliper-front")?.status).toBe("OK");
    expect(states.get("brake-lever-front")?.status).toBe("OK");
    // Reported on, but named by no row: nothing in the database says how it is.
    expect(states.get("brake-caliper-rear")?.status).toBe("UNKNOWN");
    expect(states.get("brake-lever-rear")?.status).toBe("UNKNOWN");
    // And a part the payload could not have named at all, since it names none.
    const written = [...states.values()].filter((row) => row.status !== "UNKNOWN");
    expect(written.map((row) => row.partId).sort()).toEqual([
      "brake-caliper-front",
      "brake-lever-front",
    ]);
  });

  it("never lets an OK undo a KO on the same part within one checkup", async () => {
    // Worn pads, a well-aligned caliper: both rows name the front caliper, the
    // OK comes later in the plan, and the caliper is still not fine.
    await importGuestState(
      fakeDb.client,
      userId,
      state(
        collected({
          parts: ["brake-caliper-rear"],
          verdicts: { [PAD_WEAR]: { ko: ["pad-worn"] }, [ALIGNMENT]: "ok", [HOSE]: "ok" },
        }),
      ),
      deps,
    );
    expect(partStates().get("brake-caliper-front")).toMatchObject({
      status: "BROKEN",
      lastServicedAt: null,
    });
  });

  it("lets the most recently finished checkup stand on a part", async () => {
    const older = checkupOf({
      id: OLDER_CHECKUP_ID,
      parts: ["chain"],
      verdicts: { [CHAIN]: { ko: ["chain-elongation"] } },
      completedAt: "2026-09-01T08:00:00.000Z",
    });
    const newer = checkupOf({ parts: ["chain"], verdicts: { [CHAIN]: "ok" } });
    // Given newest-first, as a history page would hold them.
    await importGuestState(
      fakeDb.client,
      userId,
      state(collected(undefined, { checkups: [newer, older] })),
      deps,
    );
    expect(rows("Checkup")).toHaveLength(2);
    expect(partStates().get("chain")?.status).toBe("OK");
  });

  it("leaves the parts alone while the checkup is unfinished", async () => {
    await importGuestState(
      fakeDb.client,
      userId,
      state(
        collected({
          parts: ["chain", "cassette"],
          verdicts: { [CHAIN]: { ko: ["chain-elongation"] } },
          completedAt: null,
        }),
      ),
      deps,
    );
    expect(new Set([...partStates().values()].map((row) => row.status))).toEqual(
      new Set(["UNKNOWN"]),
    );
  });
});

describe("the list's links (§4.2 b)", () => {
  /** A line the visitor has on their list that no checkup derived. */
  const HAND_LINE = {
    partId: "saddle",
    action: "adjust" as const,
    reasonKey: "saddle-height",
    done: true,
    sortOrder: 7,
  };

  it("links a finished checkup to the list, and each line it derives to its item", async () => {
    const bike = collected(CHAIN_AND_CASSETTE);
    // What the wizard wrote: the one line the KO derives.
    expect(bike.lists).toHaveLength(1);
    expect(bike.lists[0].items.map((item) => `${item.action}|${item.partId}`)).toEqual([
      "replace|chain",
    ]);
    bike.lists[0].items.push(HAND_LINE);

    await importGuestState(fakeDb.client, userId, state(bike), deps);

    const [checkup] = rows("Checkup");
    const [list] = rows("BuildList");
    expect(list.checkupId).toBe(checkup.id);

    const chainItem = rows("CheckupItem").find((item) => item.stepKey === CHAIN);
    const lines = new Map(rows("BuildListItem").map((line) => [line.partId, line]));
    expect(lines.get("chain")?.checkupItemId).toBe(chainItem?.id);
    // Not derived by the checkup: the visitor's own line, unlinked and untouched.
    expect(lines.get("saddle")).toMatchObject({ checkupItemId: null, done: true, sortOrder: 7 });
  });

  it("links by (action, partId): another action on the same part is not this checkup's", async () => {
    const bike = collected(CHAIN_AND_CASSETTE);
    // `clean chain` IS a consequence of the chain question — of the symptom the
    // visitor did not tick. The checkup derives `replace chain` only.
    bike.lists[0].items.push({
      partId: "chain",
      action: "clean",
      reasonKey: "chain-dirty",
      done: false,
      sortOrder: 1,
    });
    await importGuestState(fakeDb.client, userId, state(bike), deps);

    const byAction = new Map(rows("BuildListItem").map((line) => [line.action, line]));
    expect(byAction.get("REPLACE")?.checkupItemId).not.toBeNull();
    expect(byAction.get("CLEAN")?.checkupItemId).toBeNull();
  });

  it("links every consequence of a KO given without a symptom to that step's item", async () => {
    // A verdict given and then left: the step's whole `ko[]` lands (§5.4), and
    // both lines are this step's.
    const bike = collected({ parts: ["chain"], verdicts: { [CHAIN]: "ko" } });
    expect(bike.lists[0].items.map((item) => item.action).sort()).toEqual(["clean", "replace"]);

    await importGuestState(fakeDb.client, userId, state(bike), deps);
    const [item] = rows("CheckupItem");
    expect(rows("BuildListItem").map((line) => line.checkupItemId)).toEqual([item.id, item.id]);
  });

  it("links NOTHING for a checkup in progress: it has not written to the list yet", async () => {
    // The list an earlier, finished run left; then a new run, one question in,
    // that finds the same chain worn. Finishing is what links (§4.2 b) — on the
    // account, `finishCheckupAction` will.
    const finished = collected({ parts: ["chain"], verdicts: { [CHAIN]: "ko" } });
    const running = checkupOf({
      id: OLDER_CHECKUP_ID,
      parts: ["chain", "cassette"],
      verdicts: { [CHAIN]: { ko: ["chain-elongation"] } },
      completedAt: null,
    });

    await importGuestState(
      fakeDb.client,
      userId,
      state({ ...finished, checkups: [running] }),
      deps,
    );
    expect(rows("Checkup")[0].status).toBe("IN_PROGRESS");
    expect(rows("CheckupItem")).toHaveLength(1);
    expect(rows("BuildList")[0].checkupId).toBeNull();
    expect(rows("BuildListItem").length).toBeGreaterThan(0);
    expect(rows("BuildListItem").every((line) => line.checkupItemId === null)).toBe(true);
  });

  it("names the checkup that finished LAST when the payload carries several", async () => {
    const older = checkupOf({
      id: OLDER_CHECKUP_ID,
      parts: ["chain"],
      verdicts: { [CHAIN]: { ko: ["chain-elongation"] } },
      completedAt: "2026-09-01T08:00:00.000Z",
    });
    const bike = collected({ parts: ["chain"], verdicts: { [CHAIN]: { ko: ["chain-dirty"] } } });
    bike.checkups.push(older);
    // Both lines are on the list; only the newer checkup's finding is its own.
    bike.lists[0].items.push({
      partId: "chain",
      action: "replace",
      reasonKey: "chain-elongation",
      done: false,
      sortOrder: 1,
    });

    await importGuestState(fakeDb.client, userId, state(bike), deps);
    const newer = rows("Checkup").find(
      (row) => row.guestKey === guestCheckupKey(userId, CHECKUP_ID),
    );
    expect(rows("BuildList")[0].checkupId).toBe(newer?.id);
    const newerItem = rows("CheckupItem").find((item) => item.checkupId === newer?.id);
    const byAction = new Map(rows("BuildListItem").map((line) => [line.action, line]));
    expect(byAction.get("CLEAN")?.checkupItemId).toBe(newerItem?.id);
    expect(byAction.get("REPLACE")?.checkupItemId).toBeNull();
  });

  it("leaves a list with no checkup behind it unlinked", async () => {
    const [list] = collected(CHAIN_AND_CASSETTE).lists;
    await importGuestState(
      fakeDb.client,
      userId,
      state(collected(undefined, { lists: [list] })),
      deps,
    );
    expect(rows("BuildList")[0].checkupId).toBeNull();
    expect(rows("BuildListItem")[0].checkupItemId).toBeNull();
  });
});

describe("importing twice", () => {
  it("skips a bike this account already imported, and writes nothing", async () => {
    const first = await importGuestState(fakeDb.client, userId, state(collected()), deps);
    expect(first.ok && first.data.imported).toBe(1);
    const before = rows("Bike")[0];
    fakeDb.resetCalls();

    // The laptop's copy: same guest bike, older, with a checkup the phone never had.
    const stale = collected(CHAIN_AND_CASSETTE, {
      name: "Autre nom",
      updatedAt: "2026-01-01T00:00:00.000Z",
    });
    const second = await importGuestState(fakeDb.client, userId, state(stale), deps);

    expect(second.ok).toBe(true);
    if (!second.ok) return;
    expect(second.data).toMatchObject({ imported: 0, skipped: 1, bikeId: before.id });
    expect(second.data.bikes[0].skipped).toBe("already-imported");
    // The checkup was NOT imported, and the summary says so: the browser keeps it.
    expect(second.data.bikes[0].checkups).toEqual([
      { guestKey: CHECKUP_ID, status: "skipped", reason: "bike-already-imported" },
    ]);
    expect(rows("Bike")).toEqual([before]);
    expect(rows("Checkup")).toEqual([]);
    expect(rows("BuildList")).toEqual([]);
    // Reads only.
    expect(fakeDb.calls.map((call) => call.op).sort()).toEqual(["count", "findFirst", "findMany"]);
  });

  it("never produces a second Checkup, and tells the browser the account has it", async () => {
    const bike = collected(CHAIN_AND_CASSETTE);
    await importGuestState(fakeDb.client, userId, state(bike), deps);
    const before = { checkups: rows("Checkup"), items: rows("CheckupItem") };

    const again = await importGuestState(fakeDb.client, userId, state(bike), deps);
    expect(again.ok && again.data.bikes[0]).toMatchObject({
      skipped: "already-imported",
      checkups: [{ guestKey: CHECKUP_ID, status: "already-imported" }],
    });
    expect(rows("Checkup")).toEqual(before.checkups);
    expect(rows("CheckupItem")).toEqual(before.items);
    expect(rows("BuildList")).toHaveLength(1);
  });

  it("does not write again a checkup the account already holds under ANOTHER bike", async () => {
    // The same browser, a new guest bike, and the wizard's checkup still under
    // the key with its old id. `Checkup.guestKey` is unique: a second insert
    // would abort the whole bike.
    await importGuestState(fakeDb.client, userId, state(collected(CHAIN_AND_CASSETTE)), deps);

    const other = collected(CHAIN_AND_CASSETTE, {
      localId: "22222222-2222-4333-8444-555555555555",
    });
    const result = await importGuestState(fakeDb.client, userId, state(other), deps);
    expect(result.ok && result.data).toMatchObject({ imported: 1, skipped: 0 });
    expect(result.ok && result.data.bikes[0].checkups).toEqual([
      { guestKey: CHECKUP_ID, status: "already-imported" },
    ]);
    expect(rows("Bike")).toHaveLength(2);
    expect(rows("Checkup")).toHaveLength(1);
    // Its list came with it, linked to nothing: the checkup is the other bike's.
    const lists = rows("BuildList");
    expect(lists).toHaveLength(2);
    expect(lists[1].checkupId).toBeNull();
  });

  it("lets another account import the same browser's bike, checkup included", async () => {
    const other = (await fakeDb.seed("User", { email: "autre@velo-atelier.test" })) as {
      id: string;
    };
    const bike = collected(CHAIN_AND_CASSETTE);
    await importGuestState(fakeDb.client, userId, state(bike), deps);
    const second = await importGuestState(fakeDb.client, other.id, state(bike), deps);

    expect(second.ok && second.data.imported).toBe(1);
    expect(second.ok && second.data.bikes[0].checkups[0].status).toBe("imported");
    expect(rows("Bike")).toHaveLength(2);
    // The globally unique `Checkup.guestKey` is scoped by user, or this second
    // import would have collided on a row it cannot see.
    expect(rows("Checkup").map((row) => row.guestKey)).toEqual([
      guestCheckupKey(userId, CHECKUP_ID),
      guestCheckupKey(other.id, CHECKUP_ID),
    ]);
  });

  /**
   * A store whose FIRST ownership read misses: the other device has not
   * committed yet. Everything else is the fake's own.
   */
  function racing(): GuestImportStore {
    let first = true;
    return {
      ...fakeDb.client,
      bike: {
        ...fakeDb.client.bike,
        findFirst: ((args: never) => {
          if (!first) return fakeDb.client.bike.findFirst(args);
          first = false;
          return Promise.resolve(null);
        }) as typeof fakeDb.client.bike.findFirst,
      },
    } as GuestImportStore;
  }

  it("reports what the winner wrote when two devices race, and writes nothing itself", async () => {
    // The other device's import, complete: bike, checkup, list.
    const bike = collected(CHAIN_AND_CASSETTE);
    await importGuestState(fakeDb.client, userId, state(bike), deps);
    const before = {
      bikes: rows("Bike"),
      states: rows("BikePartState"),
      checkups: rows("Checkup"),
      items: rows("CheckupItem"),
      lists: rows("BuildList"),
      lines: rows("BuildListItem"),
    };

    // This one read "not there yet", tried, and lost on the unique constraint.
    const result = await importGuestState(racing(), userId, state(bike), deps);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.bikes[0]).toEqual({
      localId: LOCAL_ID,
      bikeId: before.bikes[0].id,
      skipped: "already-imported",
      checkups: [{ guestKey: CHECKUP_ID, status: "already-imported" }],
    });
    expect({
      bikes: rows("Bike"),
      states: rows("BikePartState"),
      checkups: rows("Checkup"),
      items: rows("CheckupItem"),
      lists: rows("BuildList"),
      lines: rows("BuildListItem"),
    }).toEqual(before);
  });

  it("rethrows a unique violation that is not this bike's", async () => {
    // A P2002 with no bike of this user behind it is not "already imported":
    // answering that would name a bike that does not exist.
    const store = {
      ...fakeDb.client,
      $transaction: () => Promise.reject(Object.assign(new Error("dup"), { code: "P2002" })),
    } as unknown as GuestImportStore;
    await expect(importGuestState(store, userId, state(collected()), deps)).rejects.toMatchObject({
      code: "P2002",
    });
  });
});

describe("all or nothing, per bike", () => {
  /** The fake's client with one write that fails when the transaction reaches it. */
  function failing(model: "checkup" | "buildList"): GuestImportStore {
    return {
      ...fakeDb.client,
      [model]: { ...fakeDb.client[model], create: () => Promise.reject(new Error("boom")) },
    } as unknown as GuestImportStore;
  }

  it.each(["checkup", "buildList"] as const)(
    "leaves no bike behind when the %s write fails",
    async (model) => {
      const bike = collected(CHAIN_AND_CASSETTE);
      await expect(importGuestState(failing(model), userId, state(bike), deps)).rejects.toThrow(
        "boom",
      );
      // Not the bike — which would make every later import answer "already
      // imported" and write nothing — nor anything that hangs off it.
      for (const table of [
        "Bike",
        "BikePartState",
        "Checkup",
        "CheckupItem",
        "BuildList",
        "BuildListItem",
      ]) {
        expect(rows(table), table).toEqual([]);
      }

      // And the retry, once the fault is gone, imports everything.
      const retry = await importGuestState(fakeDb.client, userId, state(bike), deps);
      expect(retry.ok && retry.data.bikes[0].checkups[0].status).toBe("imported");
      expect(rows("Bike")).toHaveLength(1);
      expect(rows("Checkup")).toHaveLength(1);
      expect(rows("BuildList")).toHaveLength(1);
    },
  );

  it("writes the bike and everything under it in one transaction", async () => {
    await importGuestState(fakeDb.client, userId, state(collected(CHAIN_AND_CASSETTE)), deps);
    const writes = fakeDb.calls.filter(
      (call) => call.op === "$transaction" || call.op === "create",
    );
    expect(writes.map((call) => `${call.model}.${call.op}`)).toEqual([
      "$client.$transaction",
      "bike.create",
      "checkup.create",
      "buildList.create",
    ]);
  });
});

describe("build lists", () => {
  const list: GuestBuildList = {
    name: "Révision printemps",
    items: [
      {
        partId: "chain",
        action: "replace",
        reasonKey: "chain-elongation",
        guideSlug: "replace-chain",
        done: false,
        sortOrder: 0,
      },
      {
        partId: "chain",
        action: "clean",
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
  const withList = (lists: GuestBuildList[]) => state(collected(undefined, { lists }));

  it("become a list and its items, with the domain's actions in the database's vocabulary", async () => {
    await importGuestState(fakeDb.client, userId, withList([list]), deps);

    const [row] = rows("BuildList");
    expect(row.name).toBe("Révision printemps");
    expect(row.status).toBe("OPEN");
    expect(row.checkupId).toBeNull();
    expect(row.bikeId).toBe(rows("Bike")[0].id);

    const items = rows("BuildListItem");
    expect(items.map((item) => item.action)).toEqual(["REPLACE", "CLEAN"]);
    expect(items[1].done).toBe(true);
    expect(items[1].refinement).toEqual({ speeds: "11" });
    expect(items[1].chosenProduct).toMatchObject({ vendor: "alltricks" });
  });

  it("keeps what the visitor typed on a line the checkup derives", async () => {
    // The lines come from the PAYLOAD, never from a re-derivation: the product
    // the visitor chose and the box they ticked are on them.
    const bike = collected(CHAIN_AND_CASSETTE);
    Object.assign(bike.lists[0].items[0], {
      done: true,
      refinement: list.items[1].refinement,
      chosenProduct: list.items[1].chosenProduct,
    });
    await importGuestState(fakeDb.client, userId, state(bike), deps);
    expect(rows("BuildListItem")[0]).toMatchObject({
      done: true,
      refinement: { speeds: "11" },
      chosenProduct: { model: "CN-HG601" },
    });
    expect(rows("BuildListItem")[0].checkupItemId).not.toBeNull();
  });

  it("writes one row per (part, action) — the pair is unique per list", async () => {
    const duplicated = { ...list, items: [list.items[0], { ...list.items[0], done: true }] };
    await importGuestState(fakeDb.client, userId, withList([duplicated]), deps);
    expect(rows("BuildListItem")).toHaveLength(1);
  });

  it("numbers a line the payload did not number, in the order it arrived", async () => {
    const unordered = {
      name: "Sans ordre",
      items: [
        { ...list.items[0], sortOrder: 1.5 },
        { ...list.items[1], sortOrder: 2.5 },
      ],
    };
    await importGuestState(fakeDb.client, userId, withList([unordered]), deps);
    expect(rows("BuildListItem").map((item) => item.sortOrder)).toEqual([0, 1]);
  });

  it("drops a line about a part the catalogue no longer has", async () => {
    const stale = { ...list, items: [{ ...list.items[0], partId: "part-from-2019" }] };
    await importGuestState(fakeDb.client, userId, withList([stale]), deps);
    expect(rows("BuildListItem")).toHaveLength(0);
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

    const result = await importGuestState(
      fakeDb.client,
      userId,
      state(collected(CHAIN_AND_CASSETTE)),
      deps,
    );
    expect(result).toEqual({ ok: false, code: "TOO_MANY" });
    expect(rows("Bike")).toHaveLength(QUOTAS.bikesPerUser);
    expect(rows("Checkup")).toEqual([]);
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
    const result = await importGuestState(fakeDb.client, userId, state(collected()), deps);
    expect(result.ok).toBe(true);
  });
});

describe("an empty payload", () => {
  it("is a success that imported nothing", async () => {
    const result = await importGuestState(fakeDb.client, userId, state(), deps);
    expect(result).toEqual({
      ok: true,
      data: { bikeId: null, bikes: [], imported: 0, skipped: 0 },
    });
  });
});
