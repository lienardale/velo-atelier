/**
 * What a checkup is about, and which scope a run is (`./scope.ts`; `.debug/017`
 * §5.10, §5.11, §5.12, §5.13).
 */
import { describe, expect, it, vi } from "vitest";

import type { PartId } from "@/lib/domain/data/parts";

import type { KoConsequence } from "@/lib/domain/schema/procedure";

import {
  carriedOnWhole,
  effectiveScope,
  FULL_SCOPE,
  guestResumeTarget,
  holds,
  knownParts,
  namesParts,
  narrowedAnswer,
  partsInScope,
  recordedScope,
  sameEffects,
  sameParts,
  savedResumeTarget,
  scopeFacts,
  touchedPart,
  type GuestRun,
  type PartsScope,
  type RunAnswers,
  type SavedRun,
} from "./scope";
import type { CheckStepRef, CheckupAnswer, CheckupScope } from "./types";

const parts = (...partIds: string[]): CheckupScope => ({
  kind: "parts",
  partIds: partIds as PartId[],
});

const sorted = (set: ReadonlySet<string> | null) => (set === null ? null : [...set].sort());

describe("partsInScope — the one definition of 'inside the scope'", () => {
  it("is null for a full checkup: it is about every part", () => {
    expect(partsInScope(FULL_SCOPE)).toBeNull();
  });

  it("holds a picked host and the parts it carries: the rear caliper and its pads", () => {
    expect(sorted(partsInScope(parts("brake-caliper-rear")))).toEqual([
      "brake-caliper-rear",
      "brake-pads-rear",
    ]);
  });

  it("holds a picked hosted part and the host it is reached through: the rear pads and their caliper", () => {
    expect(sorted(partsInScope(parts("brake-pads-rear")))).toEqual([
      "brake-caliper-rear",
      "brake-pads-rear",
    ]);
  });

  it("holds a tyre and the tube it carries, and not the other tyre's", () => {
    expect(sorted(partsInScope(parts("tire-front")))).toEqual(["tire-front", "tube-front"]);
  });

  it("does NOT hold the other parts an unpicked host carries: the chainring says nothing of the bearings", () => {
    // Both are reached through the crankset, which was not picked.
    expect(sorted(partsInScope(parts("chainring")))).toEqual(["chainring", "crankset"]);
    // Picking the crankset itself does hold both.
    expect(sorted(partsInScope(parts("crankset")))).toEqual([
      "bottom-bracket",
      "chainring",
      "crankset",
    ]);
  });

  it("holds a part with neither host nor carried parts as itself", () => {
    expect(sorted(partsInScope(parts("chain")))).toEqual(["chain"]);
  });

  it("ignores an id that is not a part — a hand-written `?parts=` widens nothing", () => {
    expect(sorted(partsInScope(parts("../etc/passwd", "chain")))).toEqual(["chain"]);
    expect(sorted(partsInScope(parts()))).toEqual([]);
  });
});

describe("namesParts", () => {
  it("is true of a parts scope naming at least one part, and of nothing else", () => {
    expect(namesParts(parts("chain"))).toBe(true);
    expect(namesParts(parts())).toBe(false);
    expect(namesParts(FULL_SCOPE)).toBe(false);
  });
});

// ── hand-shaped plans, after the real disc-brake and drivetrain questions ────

type Finding = [KoConsequence["action"], string, string];

function step(
  key: string,
  partIds: readonly string[],
  findings: readonly Finding[],
  coveredParts?: readonly string[],
): CheckStepRef {
  const [guideSlug, stepId] = key.split("#");
  return {
    key,
    guideSlug,
    stepId,
    partIds: partIds as PartId[],
    ko: findings.map(([action, partId, reasonKey]) => ({ action, partId, reasonKey })) as never,
    ...(coveredParts === undefined ? {} : { coveredParts: coveredParts as PartId[] }),
    skippable: false,
    tools: [],
    title: key,
    prompt: key,
    number: 1,
  };
}

const PADS = "check-brakes-disc#pad-wear";
const HOSE = "check-brakes-disc#hose-leak";
const RIM = "check-brakes-rim#rim-track";
const CHAIN = "check-drivetrain#chain-wear";

/** The bike's full plan: both sides of every question. */
const FULL_PLAN = [
  step(
    PADS,
    ["brake-caliper-front", "brake-caliper-rear"],
    [
      ["replace", "brake-pads-front", "pad-worn"],
      ["replace", "brake-pads-rear", "pad-worn"],
    ],
  ),
  step(
    HOSE,
    ["brake-lever-front", "brake-lever-rear", "brake-caliper-front", "brake-caliper-rear"],
    [
      ["inspect-shop", "brake-line-front", "hose-leak"],
      ["inspect-shop", "brake-line-rear", "hose-leak"],
    ],
  ),
  step(
    RIM,
    ["wheel-front", "brake-caliper-front"],
    [
      ["inspect-shop", "wheel-front", "rim-brake-track-worn"],
      ["clean", "brake-pads-front", "rim-contaminated"],
    ],
  ),
  step(CHAIN, ["chain"], [["replace", "chain", "chain-elongation"]]),
];

const REAR = parts("brake-caliper-rear");
/** What the planner asks of the rear caliper: the rear pads only; not `hose-leak`. */
const REAR_PLAN = [
  step(
    PADS,
    ["brake-caliper-rear"],
    [["replace", "brake-pads-rear", "pad-worn"]],
    ["brake-pads-rear"],
  ),
];

const FRONT = parts("brake-caliper-front");
/** …and of the front one: the front pads, and the rim track for its pads alone. */
const FRONT_PLAN = [
  step(
    PADS,
    ["brake-caliper-front"],
    [["replace", "brake-pads-front", "pad-worn"]],
    ["brake-pads-front"],
  ),
  step(
    RIM,
    ["brake-caliper-front"],
    [["clean", "brake-pads-front", "rim-contaminated"]],
    ["brake-pads-front"],
  ),
];

const CHAIN_ONLY = parts("chain");
/** The chain's one question, asked whole: nothing in it is outside the chain. */
const CHAIN_PLAN = [step(CHAIN, ["chain"], [["replace", "chain", "chain-elongation"]])];

const BOTH = parts("brake-caliper-front", "brake-caliper-rear");
/** Both calipers: the pads' question whole, the rim track for the front pads alone. */
const BOTH_PLAN = [FULL_PLAN[0], FRONT_PLAN[1]];

const REAR_FACTS = scopeFacts(REAR, FULL_PLAN, REAR_PLAN);
const BOTH_FACTS = scopeFacts(BOTH, FULL_PLAN, BOTH_PLAN);
const FRONT_FACTS = scopeFacts(FRONT, FULL_PLAN, FRONT_PLAN);
const CHAIN_FACTS = scopeFacts(CHAIN_ONLY, FULL_PLAN, CHAIN_PLAN);
const FULL_FACTS = scopeFacts(FULL_SCOPE, FULL_PLAN, FULL_PLAN);

function run(
  answers: Record<string, CheckupAnswer>,
  extra: Partial<Omit<RunAnswers, "answers">> = {},
): RunAnswers {
  return { answers, symptoms: {}, ...extra };
}

describe("sameParts — two scopes the planner asks alike", () => {
  it("is true of two full checkups, and false of a full and a partial one", () => {
    expect(sameParts(FULL_SCOPE, FULL_SCOPE)).toBe(true);
    expect(sameParts(FULL_SCOPE, REAR)).toBe(false);
    expect(sameParts(REAR, FULL_SCOPE)).toBe(false);
  });

  it("is true of a caliper and its pads — the same parts inside — and false of the other side", () => {
    expect(sameParts(REAR, parts("brake-pads-rear"))).toBe(true);
    expect(sameParts(REAR, FRONT)).toBe(false);
    expect(sameParts(CHAIN_ONLY, parts("chain", "cassette"))).toBe(false);
  });
});

describe("scopeFacts — a scope against the bike's full plan", () => {
  it("says nothing of a full checkup but its questions", () => {
    expect(FULL_FACTS).toEqual({ asked: [PADS, HOSE, RIM, CHAIN], touched: [], withheld: {} });
  });

  it("names the questions a picked part TOUCHES and the scope no longer asks: hose-leak for a caliper", () => {
    // `hose-leak` names both calipers, and sends its only finding to the brake
    // LINES: the planner of before 2026-10-22 asked it here, today's does not.
    expect(REAR_FACTS).toEqual({ asked: [PADS, HOSE, RIM, CHAIN], touched: [HOSE], withheld: {} });
    // The chain's question meets no picked part: not touched.
    expect(CHAIN_FACTS.touched).toEqual([]);
  });

  it("names the symptoms a narrowed question withholds: a worn rim track, for the front pads", () => {
    expect(FRONT_FACTS.withheld).toEqual({ [RIM]: ["rim-brake-track-worn"] });
    expect(FRONT_FACTS.touched).toEqual([HOSE]);
  });

  it("touches nothing for an id that is no part", () => {
    expect(scopeFacts(parts("not-a-part"), FULL_PLAN, []).touched).toEqual([]);
  });
});

describe("holds — every answer asked about what it was given for", () => {
  it("holds any run in a full checkup", () => {
    expect(
      holds(
        FULL_SCOPE,
        run({ [PADS]: "ko", [CHAIN]: "ok" }, { recordedFor: { [PADS]: "x" } }),
        FULL_PLAN,
        FULL_FACTS,
      ),
    ).toBe(true);
  });

  it("holds an answer it asks, and ignores one to a question the bike is no longer asked", () => {
    expect(
      holds(REAR, run({ [PADS]: "ok", "check-retired#gone": "ok" }), REAR_PLAN, REAR_FACTS),
    ).toBe(true);
  });

  it("does not hold an answer to a question it does not ask", () => {
    expect(holds(REAR, run({ [CHAIN]: "ok" }), REAR_PLAN, REAR_FACTS)).toBe(false);
  });

  it("lets an OK or a skip to a TOUCHED question pass — and not a KO, whose finding must be kept", () => {
    expect(holds(REAR, run({ [PADS]: "ok", [HOSE]: "ok" }), REAR_PLAN, REAR_FACTS)).toBe(true);
    expect(holds(REAR, run({ [HOSE]: "skipped" }), REAR_PLAN, REAR_FACTS)).toBe(true);
    expect(holds(REAR, run({ [HOSE]: "ko" }), REAR_PLAN, REAR_FACTS)).toBe(false);
  });

  it("does not hold a KO given with a symptom it withholds; holds one it offers", () => {
    const worn = run({ [RIM]: "ko" }, { symptoms: { [RIM]: ["rim-brake-track-worn"] } });
    expect(holds(FRONT, worn, FRONT_PLAN, FRONT_FACTS)).toBe(false);
    const dirty = run({ [RIM]: "ko" }, { symptoms: { [RIM]: ["rim-contaminated"] } });
    expect(holds(FRONT, dirty, FRONT_PLAN, FRONT_FACTS)).toBe(true);
    // A symptom left on a verdict that is not a KO says nothing.
    const stale = run({ [RIM]: "ok" }, { symptoms: { [RIM]: ["rim-brake-track-worn"] } });
    expect(holds(FRONT, stale, FRONT_PLAN, FRONT_FACTS)).toBe(true);
  });

  it("holds a row recorded against the part it would record it against, and not one recorded against the other side", () => {
    const rear = run({ [PADS]: "ko" }, { recordedFor: { [PADS]: "brake-caliper-rear" } });
    expect(holds(REAR, rear, REAR_PLAN, REAR_FACTS)).toBe(true);
    expect(holds(FRONT, rear, FRONT_PLAN, FRONT_FACTS)).toBe(false);
  });

  it("does not hold a rear caliper's row on BOTH calipers, whose row would name the front one — though the rear one is inside them", () => {
    // Until `.debug/017` §5.13 "recorded against a part inside" was enough,
    // and a rear-only OK, held there, closed the front pads' line.
    const rear = run({ [PADS]: "ok" }, { recordedFor: { [PADS]: "brake-caliper-rear" } });
    expect(holds(BOTH, rear, BOTH_PLAN, BOTH_FACTS)).toBe(false);
    const front = run({ [PADS]: "ok" }, { recordedFor: { [PADS]: "brake-caliper-front" } });
    expect(holds(BOTH, front, BOTH_PLAN, BOTH_FACTS)).toBe(true);
  });
});

describe("touchedPart and knownParts", () => {
  it("records a touched question against the first part it names that the scope picked", () => {
    expect(touchedPart(REAR as PartsScope, FULL_PLAN[1])).toBe("brake-caliper-rear");
    expect(touchedPart(CHAIN_ONLY as PartsScope, FULL_PLAN[1])).toBeUndefined();
  });

  it("keeps the ids the catalogue knows, once each, or nothing at all", () => {
    expect(knownParts(FULL_SCOPE)).toBeNull();
    expect(knownParts(parts("not-a-part"))).toBeNull();
    expect(knownParts(parts("chain", "not-a-part", "chain", "brake-caliper-rear"))).toEqual(
      parts("chain", "brake-caliper-rear"),
    );
  });
});

describe("effectiveScope — the named scope while it holds the run", () => {
  const plan = (scoped: readonly CheckStepRef[], facts = REAR_FACTS) =>
    vi.fn(() => ({ scoped, facts }));

  it("keeps a parts scope that holds every answer, planning it once", () => {
    const planned = plan(REAR_PLAN);
    expect(effectiveScope(REAR, run({ [PADS]: "ok" }), planned)).toBe(REAR);
    expect(effectiveScope(REAR, run({}), plan(REAR_PLAN))).toBe(REAR);
    expect(planned).toHaveBeenCalledTimes(1);
  });

  it("is the full checkup as soon as it does not hold ONE answer", () => {
    expect(effectiveScope(REAR, run({ [PADS]: "ok", [CHAIN]: "ok" }), plan(REAR_PLAN))).toEqual(
      FULL_SCOPE,
    );
  });

  it("is the full checkup, never planned, for a parts scope that names no part, and for a full one", () => {
    const planned = plan([]);
    expect(effectiveScope(parts(), run({ [CHAIN]: "ok" }), planned)).toEqual(FULL_SCOPE);
    expect(effectiveScope(FULL_SCOPE, run({ [CHAIN]: "ok" }), planned)).toEqual(FULL_SCOPE);
    expect(planned).not.toHaveBeenCalled();
  });
});

describe("narrowedAnswer and carriedOnWhole", () => {
  it("sees an answer to a question asked of some of its parts", () => {
    expect(narrowedAnswer(run({ [PADS]: "ok" }), REAR_PLAN)).toBe(true);
    expect(narrowedAnswer(run({ [CHAIN]: "ok" }), CHAIN_PLAN)).toBe(false);
  });

  it("hands a run to the full checkup when its parts do not hold it, or asked each answer whole", () => {
    // A run of before 2026-10-22, answered beyond its parts.
    expect(
      carriedOnWhole(run({ [CHAIN]: "ok", [PADS]: "ok" }), CHAIN_ONLY, CHAIN_PLAN, CHAIN_FACTS),
    ).toBe(true);
    expect(carriedOnWhole(run({ [CHAIN]: "ok" }), CHAIN_ONLY, CHAIN_PLAN, CHAIN_FACTS)).toBe(true);
    expect(carriedOnWhole(run({ [PADS]: "ok" }), REAR, REAR_PLAN, REAR_FACTS)).toBe(false);
  });
});

describe("guestResumeTarget — a guest's run, which knows its parts", () => {
  const guest = (scope: CheckupScope, answers: Record<string, CheckupAnswer>): GuestRun => ({
    scope,
    answers,
    symptoms: {},
  });
  const rearPlan = { scope: REAR as PartsScope, steps: REAR_PLAN, facts: REAR_FACTS };
  const chainPlan = { scope: CHAIN_ONLY as PartsScope, steps: CHAIN_PLAN, facts: CHAIN_FACTS };

  it("is the page when the run has no answer the bike is still asked", () => {
    expect(guestResumeTarget(guest(FULL_SCOPE, {}), REAR, REAR_PLAN, REAR_FACTS)).toEqual({
      kind: "page",
    });
    expect(
      guestResumeTarget(
        guest(REAR, { "check-retired#gone": "ok" }),
        FRONT,
        FRONT_PLAN,
        FRONT_FACTS,
      ),
    ).toEqual({ kind: "page" });
  });

  it("never narrows a full run: the full page, or the full checkup", () => {
    const full = guest(FULL_SCOPE, { [CHAIN]: "ok" });
    expect(guestResumeTarget(full, FULL_SCOPE, FULL_PLAN, FULL_FACTS)).toEqual({ kind: "page" });
    expect(guestResumeTarget(full, CHAIN_ONLY, CHAIN_PLAN, CHAIN_FACTS)).toEqual({ kind: "full" });
  });

  it("brings a run opened on other parts, or on the full page, back to its own parts", () => {
    const rear = guest(REAR, { [PADS]: "ko" });
    expect(guestResumeTarget(rear, FRONT, FRONT_PLAN, FRONT_FACTS)).toEqual({
      kind: "own",
      scope: REAR,
    });
    expect(guestResumeTarget(rear, FULL_SCOPE, FULL_PLAN, FULL_FACTS)).toEqual({
      kind: "own",
      scope: REAR,
    });
  });

  it("brings it back whatever the address says it came for — a `?resume=own` on OTHER parts included (V1-1)", () => {
    // Until §5.13 that arrival was trusted, and the run was held on the rear
    // caliper, its front pads' answer then counted for the rear ones.
    const front = guest(FRONT, { [PADS]: "ko" });
    expect(guestResumeTarget(front, REAR, REAR_PLAN, REAR_FACTS, { arrivedOwn: true })).toEqual({
      kind: "own",
      scope: FRONT,
    });
  });

  it("goes back by the parts the catalogue knows, so that the page it is sent to is its own", () => {
    const odd = guest(parts("not-a-part", "brake-caliper-rear"), { [PADS]: "ko" });
    expect(guestResumeTarget(odd, FRONT, FRONT_PLAN, FRONT_FACTS)).toEqual({
      kind: "own",
      scope: REAR,
    });
    // …and its own page holds it.
    expect(guestResumeTarget(odd, REAR, REAR_PLAN, REAR_FACTS)).toEqual({ kind: "page" });
  });

  it("stays on the full checkup reached FOR it only when that checkup takes it over (V1-2)", () => {
    const chain = guest(CHAIN_ONLY, { [CHAIN]: "ko" });
    expect(
      guestResumeTarget(chain, FULL_SCOPE, FULL_PLAN, FULL_FACTS, { widenedFrom: chainPlan }),
    ).toEqual({ kind: "page" });
    // An answer its parts ask of the rear pads alone: the full checkup would
    // count it for both. Back to the rear caliper.
    const rear = guest(REAR, { [PADS]: "ok" });
    expect(
      guestResumeTarget(rear, FULL_SCOPE, FULL_PLAN, FULL_FACTS, { widenedFrom: rearPlan }),
    ).toEqual({ kind: "own", scope: REAR });
    // A plan of OTHER parts, or none at all — a stale `?resume=full`.
    expect(
      guestResumeTarget(rear, FULL_SCOPE, FULL_PLAN, FULL_FACTS, { widenedFrom: chainPlan }),
    ).toEqual({ kind: "own", scope: REAR });
    expect(guestResumeTarget(rear, FULL_SCOPE, FULL_PLAN, FULL_FACTS)).toEqual({
      kind: "own",
      scope: REAR,
    });
    // A plan handed to a page that is not the full checkup decides nothing.
    expect(
      guestResumeTarget(chain, REAR, REAR_PLAN, REAR_FACTS, { widenedFrom: chainPlan }),
    ).toEqual({ kind: "own", scope: CHAIN_ONLY });
  });

  it("resumes on the page a run whose parts are the page's — a reload — unless it does not hold it", () => {
    expect(
      guestResumeTarget(
        guest(parts("brake-pads-rear"), { [PADS]: "ko" }),
        REAR,
        REAR_PLAN,
        REAR_FACTS,
      ),
    ).toEqual({ kind: "page" });
    // A run of the wizard of before 2026-10-22, answered beyond its parts.
    expect(
      guestResumeTarget(guest(REAR, { [PADS]: "ko", [CHAIN]: "ok" }), REAR, REAR_PLAN, REAR_FACTS),
    ).toEqual({ kind: "full", from: REAR });
  });

  it("back on its own parts: stays there when an answer counts for some of its question's parts only", () => {
    expect(
      guestResumeTarget(guest(REAR, { [PADS]: "ko" }), REAR, REAR_PLAN, REAR_FACTS, {
        arrivedOwn: true,
      }),
    ).toEqual({ kind: "page" });
  });

  it("back on its own parts: the full checkup when every answer was given whole, or when they do not hold it", () => {
    expect(
      guestResumeTarget(guest(CHAIN_ONLY, { [CHAIN]: "ko" }), CHAIN_ONLY, CHAIN_PLAN, CHAIN_FACTS, {
        arrivedOwn: true,
      }),
    ).toEqual({ kind: "full", from: CHAIN_ONLY });
    expect(
      guestResumeTarget(guest(REAR, { [PADS]: "ko", [CHAIN]: "ok" }), REAR, REAR_PLAN, REAR_FACTS, {
        arrivedOwn: true,
      }),
    ).toEqual({ kind: "full", from: REAR });
  });

  it("stays on the full checkup reached for a run whose own parts ask NOTHING — they have no page to go back to (§5.14, V2-1)", () => {
    // The page plans `?parts=<own>&resume=own` on such parts as the full
    // checkup for them, with their empty plan: until §5.14 it was the empty
    // page, whose one link sent the run back there.
    const shifter = parts("shifter-left") as PartsScope;
    const nothing = { scope: shifter, steps: [], facts: scopeFacts(shifter, FULL_PLAN, []) };
    const left = guest(shifter, { [PADS]: "ok" });
    expect(carriedOnWhole(left, shifter, [], nothing.facts)).toBe(true);
    expect(
      guestResumeTarget(left, FULL_SCOPE, FULL_PLAN, FULL_FACTS, { widenedFrom: nothing }),
    ).toEqual({ kind: "page" });
    // A KO too: no answer can be narrowed where nothing is asked.
    expect(
      guestResumeTarget(guest(shifter, { [PADS]: "ko" }), FULL_SCOPE, FULL_PLAN, FULL_FACTS, {
        widenedFrom: nothing,
      }),
    ).toEqual({ kind: "page" });
    // Another run, reaching that address: back to ITS own parts.
    expect(
      guestResumeTarget(guest(REAR, { [PADS]: "ok" }), FULL_SCOPE, FULL_PLAN, FULL_FACTS, {
        widenedFrom: nothing,
      }),
    ).toEqual({ kind: "own", scope: REAR });
  });

  it("reads a run whose scope names no part it knows as confined to none", () => {
    const loose = guest(parts(), { [PADS]: "ok" });
    expect(guestResumeTarget(loose, FULL_SCOPE, FULL_PLAN, FULL_FACTS)).toEqual({ kind: "page" });
    expect(guestResumeTarget(loose, REAR, REAR_PLAN, REAR_FACTS)).toEqual({ kind: "page" });
    expect(
      guestResumeTarget(guest(parts("not-a-part"), { [CHAIN]: "ok" }), REAR, REAR_PLAN, REAR_FACTS),
    ).toEqual({ kind: "full" });
  });
});

/** The hand-shaped planner: each scope these tests plan, by its sorted ids. */
function planOf(scope: PartsScope): CheckStepRef[] {
  const key = [...scope.partIds].sort().join(",");
  const plans: Record<string, CheckStepRef[]> = {
    "brake-caliper-rear": REAR_PLAN,
    "brake-caliper-front": FRONT_PLAN,
    "brake-caliper-front,brake-caliper-rear": BOTH_PLAN,
    chain: CHAIN_PLAN,
    "brake-caliper-rear,chain": [...REAR_PLAN, ...CHAIN_PLAN],
  };
  if (!Object.hasOwn(plans, key)) throw new Error(`no hand-shaped plan for ${key}`);
  // eslint-disable-next-line security/detect-object-injection -- guarded by Object.hasOwn
  return plans[key];
}

describe("recordedScope — what a saved bike's rows say of its parts", () => {
  const rows = (answers: Record<string, CheckupAnswer>, recordedFor: Record<string, string>) =>
    run(answers, { recordedFor });

  it("tells the rear caliper from a row on it: the last part its question names, nothing after it in doubt", () => {
    expect(
      recordedScope(rows({ [PADS]: "ok" }, { [PADS]: "brake-caliper-rear" }), FULL_PLAN, planOf),
    ).toEqual(REAR);
  });

  it("cannot tell from a row on the front caliper: the front pads', or both pads' — or anything, before 2026-10-22", () => {
    expect(
      recordedScope(rows({ [PADS]: "ok" }, { [PADS]: "brake-caliper-front" }), FULL_PLAN, planOf),
    ).toBeNull();
  });

  it("lets one row settle another's doubt: a later part another row names, or excludes", () => {
    // `hose-leak` names the levers, then the calipers. A row on the rear lever
    // leaves both calipers in doubt; the pads' row on the rear caliper names
    // one and excludes the other.
    const leverAndCaliper = rows(
      { [HOSE]: "ok", [PADS]: "ok" },
      { [HOSE]: "brake-lever-rear", [PADS]: "brake-caliper-rear" },
    );
    const settled = recordedScope(leverAndCaliper, FULL_PLAN, (scope) => {
      expect(scope).toEqual(parts("brake-lever-rear", "brake-caliper-rear"));
      return [
        { ...FULL_PLAN[0], partIds: ["brake-caliper-rear"] as PartId[] },
        { ...FULL_PLAN[1], partIds: ["brake-lever-rear", "brake-caliper-rear"] as PartId[] },
      ];
    });
    expect(settled).toEqual(parts("brake-lever-rear", "brake-caliper-rear"));
    expect(
      recordedScope(rows({ [HOSE]: "ok" }, { [HOSE]: "brake-lever-rear" }), FULL_PLAN, planOf),
    ).toBeNull();
  });

  it("reads a touched question's row by the first part it names that was picked", () => {
    // What the import writes for `hose-leak` in a rear-caliper checkup.
    expect(
      recordedScope(
        rows(
          { [PADS]: "ko", [HOSE]: "ok" },
          { [PADS]: "brake-caliper-rear", [HOSE]: "brake-caliper-rear" },
        ),
        FULL_PLAN,
        planOf,
      ),
    ).toEqual(REAR);
  });

  it("ignores an answer to a question the bike is no longer asked, and tells nothing of a run with no row", () => {
    expect(
      recordedScope(
        rows({ [CHAIN]: "ok", "check-retired#gone": "ok" }, { [CHAIN]: "chain" }),
        FULL_PLAN,
        planOf,
      ),
    ).toEqual(CHAIN_ONLY);
    expect(recordedScope(rows({ "check-retired#gone": "ok" }, {}), FULL_PLAN, planOf)).toBeNull();
  });

  it("tells nothing of rows that contradict each other, or that no part of their question explains", () => {
    // One names the front caliper, another excludes it.
    expect(
      recordedScope(
        rows(
          { [PADS]: "ok", [RIM]: "ok" },
          { [PADS]: "brake-caliper-rear", [RIM]: "brake-caliper-front" },
        ),
        FULL_PLAN,
        planOf,
      ),
    ).toBeNull();
    expect(
      recordedScope(rows({ [PADS]: "ok" }, { [PADS]: "chain" }), FULL_PLAN, planOf),
    ).toBeNull();
    // An answer with no row at all.
    expect(recordedScope(rows({ [PADS]: "ok" }, {}), FULL_PLAN, planOf)).toBeNull();
  });

  it("tells nothing when the parts it reads, planned, would not give each row back its own part", () => {
    expect(
      recordedScope(rows({ [PADS]: "ok" }, { [PADS]: "brake-caliper-rear" }), FULL_PLAN, () => [
        { ...FULL_PLAN[0], partIds: ["brake-caliper-front"] as PartId[] },
      ]),
    ).toBeNull();
  });
});

describe("sameEffects", () => {
  it("compares the parts and the findings of every answered question", () => {
    const answered = run({ [PADS]: "ok", "check-retired#gone": "ok" });
    expect(sameEffects(answered, REAR_PLAN, REAR_PLAN)).toBe(true);
    expect(sameEffects(answered, REAR_PLAN, FRONT_PLAN)).toBe(false);
    expect(sameEffects(answered, REAR_PLAN, CHAIN_PLAN)).toBe(false);
    const fewer = [{ ...REAR_PLAN[0], ko: [] }];
    expect(sameEffects(answered, REAR_PLAN, fewer)).toBe(false);
  });
});

describe("savedResumeTarget — a saved bike's run, judged by its address and its rows", () => {
  /** A saved bike's run: its PARTIAL row reads as a scope naming no part. */
  const saved = (
    answers: Record<string, CheckupAnswer>,
    recordedFor: Record<string, string>,
  ): SavedRun => ({ scope: parts(), answers, symptoms: {}, recordedFor });
  const rearRecorded = { scope: REAR as PartsScope, steps: REAR_PLAN, facts: REAR_FACTS };
  const none = { ownAddress: false, recorded: null };

  it("is the page with no answer to keep, and never narrows a full run", () => {
    expect(savedResumeTarget(saved({}, {}), REAR, REAR_PLAN, REAR_FACTS, none)).toEqual({
      kind: "page",
    });
    const full: SavedRun = { ...saved({ [CHAIN]: "ok" }, { [CHAIN]: "chain" }), scope: FULL_SCOPE };
    expect(savedResumeTarget(full, FULL_SCOPE, FULL_PLAN, FULL_FACTS, none)).toEqual({
      kind: "page",
    });
    expect(savedResumeTarget(full, CHAIN_ONLY, CHAIN_PLAN, CHAIN_FACTS, none)).toEqual({
      kind: "full",
    });
  });

  it("keeps a run on its own address — a reload — when the page gives every row back its part", () => {
    const front = saved({ [PADS]: "ko" }, { [PADS]: "brake-caliper-front" });
    expect(
      savedResumeTarget(front, FRONT, FRONT_PLAN, FRONT_FACTS, {
        ownAddress: true,
        recorded: null,
      }),
    ).toEqual({ kind: "page" });
    // The same rows, and no address: the front pads', or both pads'?
    expect(savedResumeTarget(front, FRONT, FRONT_PLAN, FRONT_FACTS, none)).toEqual({
      kind: "full",
    });
    expect(savedResumeTarget(front, FULL_SCOPE, FULL_PLAN, FULL_FACTS, none)).toEqual({
      kind: "page",
    });
  });

  it("takes an address at its word only where the page holds the rows", () => {
    const rear = saved({ [PADS]: "ko" }, { [PADS]: "brake-caliper-rear" });
    expect(
      savedResumeTarget(rear, FRONT, FRONT_PLAN, FRONT_FACTS, {
        ownAddress: true,
        recorded: rearRecorded,
      }),
    ).toEqual({ kind: "own", scope: REAR });
  });

  it("resumes on the page what its rows tell, the same way (B1)", () => {
    const rear = saved({ [PADS]: "ko" }, { [PADS]: "brake-caliper-rear" });
    expect(
      savedResumeTarget(rear, REAR, REAR_PLAN, REAR_FACTS, {
        ownAddress: false,
        recorded: rearRecorded,
      }),
    ).toEqual({ kind: "page" });
    // A page that asks more, the rear pads' question the same way.
    const wider = [...REAR_PLAN, ...CHAIN_PLAN];
    const widerScope = parts("brake-caliper-rear", "chain");
    expect(
      savedResumeTarget(rear, widerScope, wider, scopeFacts(widerScope, FULL_PLAN, wider), {
        ownAddress: false,
        recorded: rearRecorded,
      }),
    ).toEqual({ kind: "page" });
  });

  it("sends it back to the parts its rows tell from the front caliper, from both calipers and from the full page (B1, B2, RA-3)", () => {
    const rear = saved({ [PADS]: "ok" }, { [PADS]: "brake-caliper-rear" });
    const evidence = { ownAddress: false, recorded: rearRecorded };
    expect(savedResumeTarget(rear, FRONT, FRONT_PLAN, FRONT_FACTS, evidence)).toEqual({
      kind: "own",
      scope: REAR,
    });
    expect(savedResumeTarget(rear, BOTH, BOTH_PLAN, BOTH_FACTS, evidence)).toEqual({
      kind: "own",
      scope: REAR,
    });
    expect(savedResumeTarget(rear, FULL_SCOPE, FULL_PLAN, FULL_FACTS, evidence)).toEqual({
      kind: "own",
      scope: REAR,
    });
  });

  it("never sends a run to parts its rows tell that ask nothing: the full checkup takes it over (§5.14)", () => {
    // An imported left-shifter run of before 2026-10-22: its one row is on the
    // left shifter, which today's planner asks nothing. `own` needs an answer
    // narrowed on the parts the rows tell, and nothing is asked there.
    const shifter = parts("shifter-left") as PartsScope;
    const facts = scopeFacts(shifter, FULL_PLAN, []);
    const imported = saved({ [PADS]: "ok" }, { [PADS]: "shifter-left" });
    const evidence = { ownAddress: false, recorded: { scope: shifter, steps: [], facts } };
    expect(savedResumeTarget(imported, FULL_SCOPE, FULL_PLAN, FULL_FACTS, evidence)).toEqual({
      kind: "page",
    });
    expect(savedResumeTarget(imported, CHAIN_ONLY, CHAIN_PLAN, CHAIN_FACTS, evidence)).toEqual({
      kind: "full",
    });
  });

  it("hands it to the full checkup when that checkup takes it over: answers asked whole, or a KO its parts only touch", () => {
    const chain = saved({ [CHAIN]: "ko" }, { [CHAIN]: "chain" });
    const chainRecorded = {
      scope: CHAIN_ONLY as PartsScope,
      steps: CHAIN_PLAN,
      facts: CHAIN_FACTS,
    };
    expect(
      savedResumeTarget(chain, FRONT, FRONT_PLAN, FRONT_FACTS, {
        ownAddress: false,
        recorded: chainRecorded,
      }),
    ).toEqual({ kind: "full" });
    expect(
      savedResumeTarget(chain, FULL_SCOPE, FULL_PLAN, FULL_FACTS, {
        ownAddress: false,
        recorded: chainRecorded,
      }),
    ).toEqual({ kind: "page" });
    const leak = saved(
      { [PADS]: "ok", [HOSE]: "ko" },
      { [PADS]: "brake-caliper-rear", [HOSE]: "brake-caliper-rear" },
    );
    expect(
      savedResumeTarget(leak, REAR, REAR_PLAN, REAR_FACTS, {
        ownAddress: false,
        recorded: rearRecorded,
      }),
    ).toEqual({ kind: "full" });
  });
});
