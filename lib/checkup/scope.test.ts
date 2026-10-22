/**
 * What a checkup is about, and which scope a run is (`./scope.ts`; `.debug/017`
 * §5.10, §5.11, §5.12).
 */
import { describe, expect, it, vi } from "vitest";

import type { PartId } from "@/lib/domain/data/parts";

import type { KoConsequence } from "@/lib/domain/schema/procedure";

import {
  effectiveScope,
  FULL_SCOPE,
  holds,
  namesParts,
  partsInScope,
  resumeTarget,
  sameParts,
  scopeFacts,
  type ResumedRun,
  type RunAnswers,
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

const REAR_FACTS = scopeFacts(REAR, FULL_PLAN, REAR_PLAN);
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

  it("holds a row recorded against a part inside it, and not one recorded against the other side", () => {
    const rear = run({ [PADS]: "ko" }, { recordedFor: { [PADS]: "brake-caliper-rear" } });
    expect(holds(REAR, rear, REAR_PLAN, REAR_FACTS)).toBe(true);
    expect(holds(FRONT, rear, FRONT_PLAN, FRONT_FACTS)).toBe(false);
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

describe("resumeTarget — where an unfinished run carries on", () => {
  const guest = (scope: CheckupScope, answers: Record<string, CheckupAnswer>): ResumedRun => ({
    scope,
    answers,
    symptoms: {},
    knowsItsParts: true,
  });
  /** A saved bike's run: its PARTIAL row reads as a scope naming no part. */
  const saved = (
    answers: Record<string, CheckupAnswer>,
    recordedFor: Record<string, string>,
  ): ResumedRun => ({
    scope: parts(),
    answers,
    symptoms: {},
    recordedFor,
    knowsItsParts: false,
  });

  it("is the page when the run has no answer the bike is still asked", () => {
    expect(resumeTarget(guest(FULL_SCOPE, {}), REAR, REAR_PLAN, REAR_FACTS)).toEqual({
      kind: "page",
    });
    expect(
      resumeTarget(guest(REAR, { "check-retired#gone": "ok" }), FRONT, FRONT_PLAN, FRONT_FACTS),
    ).toEqual({ kind: "page" });
  });

  it("never narrows a full run: the full page, or the full checkup", () => {
    const full = guest(FULL_SCOPE, { [CHAIN]: "ok" });
    expect(resumeTarget(full, FULL_SCOPE, FULL_PLAN, FULL_FACTS)).toEqual({ kind: "page" });
    expect(resumeTarget(full, CHAIN_ONLY, CHAIN_PLAN, CHAIN_FACTS)).toEqual({ kind: "full" });
  });

  it("brings a guest's run opened on other parts, or on the full page, back to its own parts", () => {
    const rear = guest(REAR, { [PADS]: "ko" });
    expect(resumeTarget(rear, FRONT, FRONT_PLAN, FRONT_FACTS)).toEqual({
      kind: "own",
      scope: REAR,
    });
    expect(resumeTarget(rear, FULL_SCOPE, FULL_PLAN, FULL_FACTS)).toEqual({
      kind: "own",
      scope: REAR,
    });
  });

  it("resumes on the page a guest's run whose parts are the page's — a reload — unless it does not hold it", () => {
    expect(
      resumeTarget(guest(parts("brake-pads-rear"), { [PADS]: "ko" }), REAR, REAR_PLAN, REAR_FACTS),
    ).toEqual({ kind: "page" });
    // A run of the wizard of before 2026-10-22, answered beyond its parts.
    expect(
      resumeTarget(guest(REAR, { [PADS]: "ko", [CHAIN]: "ok" }), REAR, REAR_PLAN, REAR_FACTS),
    ).toEqual({ kind: "full" });
  });

  it("back on its own parts: stays there when an answer counts for some of its question's parts only", () => {
    expect(resumeTarget(guest(REAR, { [PADS]: "ko" }), REAR, REAR_PLAN, REAR_FACTS, "own")).toEqual(
      { kind: "page" },
    );
  });

  it("back on its own parts: the full checkup when every answer was given whole, or when they do not hold it", () => {
    expect(
      resumeTarget(
        guest(CHAIN_ONLY, { [CHAIN]: "ko" }),
        CHAIN_ONLY,
        CHAIN_PLAN,
        CHAIN_FACTS,
        "own",
      ),
    ).toEqual({ kind: "full" });
    expect(
      resumeTarget(
        guest(REAR, { [PADS]: "ko", [CHAIN]: "ok" }),
        REAR,
        REAR_PLAN,
        REAR_FACTS,
        "own",
      ),
    ).toEqual({ kind: "full" });
  });

  it("never sends a run back twice: on the full page it came back to, and on parts that still differ", () => {
    const rear = guest(REAR, { [PADS]: "ko" });
    expect(resumeTarget(rear, FULL_SCOPE, FULL_PLAN, FULL_FACTS, "full")).toEqual({ kind: "page" });
    expect(resumeTarget(rear, FRONT, FRONT_PLAN, FRONT_FACTS, "own")).toEqual({ kind: "page" });
    expect(
      resumeTarget(guest(REAR, { [CHAIN]: "ok" }), FRONT, FRONT_PLAN, FRONT_FACTS, "own"),
    ).toEqual({ kind: "full" });
  });

  it("judges a run that does not know its parts by its rows: the page when each is recorded inside it, the full checkup otherwise", () => {
    const rear = saved({ [PADS]: "ko" }, { [PADS]: "brake-caliper-rear" });
    expect(resumeTarget(rear, REAR, REAR_PLAN, REAR_FACTS)).toEqual({ kind: "page" });
    expect(resumeTarget(rear, FRONT, FRONT_PLAN, FRONT_FACTS)).toEqual({ kind: "full" });
    // The saved bike's resume banner: a full page, which loses no answer.
    expect(resumeTarget(rear, FULL_SCOPE, FULL_PLAN, FULL_FACTS)).toEqual({ kind: "page" });
    // A guest's run whose scope names nothing is read the same way.
    expect(resumeTarget(guest(parts(), { [PADS]: "ok" }), REAR, REAR_PLAN, REAR_FACTS)).toEqual({
      kind: "page",
    });
  });
});
