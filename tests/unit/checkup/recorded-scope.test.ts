/**
 * What a saved bike's rows say of the parts its run was opened on, against
 * the real corpus (`recordedScope`, `lib/checkup/scope.ts`; `.debug/017`
 * §5.13).
 *
 * A `PARTIAL` row records no parts, so the account reads them from the rows:
 * each names the FIRST part its question reported on in the run's scope.
 * `lib/checkup/scope.test.ts` holds the rule on hand-shaped plans; this file
 * replays it over the seven presets and every scope a visitor can pick — one
 * part, or two that a question names together — and asks the one thing that
 * matters: when the rows are read as telling the parts, the parts they tell
 * ask every answered question about what it was answered for. Never a wrong
 * scope; `null` — "cannot tell", the full checkup — is always allowed.
 *
 * And the rows a run of before 2026-10-22 left — every one on its WHOLE
 * question's first part, whatever was picked — never read as narrowing an
 * answer that was given to a whole question.
 *
 * The corpus is read ONCE, at module scope (`plan-corpus.test.ts` says why).
 */
import { describe, expect, it } from "vitest";

import { deriveBike } from "@/lib/bike/rules";
import { planCheckup } from "@/lib/checkup/plan";
import { recordedScope, sameEffects, type PartsScope } from "@/lib/checkup/scope";
import type { CheckStepRef, CheckupScope } from "@/lib/checkup/types";
import { PARTS, type PartId } from "@/lib/domain/data/parts";
import { BIKE_PRESETS, type PresetId } from "@/lib/domain/data/presets";
import { planBeforeTheScopeRule } from "@/tests/_helpers/guest-work";
import { diskGuides } from "@/tests/_helpers/guides";

const FR = diskGuides().filter((guide) => guide.locale === "fr");
const PRESETS = Object.keys(BIKE_PRESETS) as PresetId[];

function buildOf(preset: PresetId) {
  // eslint-disable-next-line security/detect-object-injection -- `preset` is a PresetId literal
  const derived = deriveBike(BIKE_PRESETS[preset]);
  return { spec: derived.spec, parts: derived.parts };
}

/** The rows a run answering `answered` of `steps` writes: each on its question's first part. */
function rowsOf(steps: readonly CheckStepRef[], answered: number) {
  const asked = steps.slice(0, answered);
  return {
    answers: Object.fromEntries(asked.map((step) => [step.key, "ok" as const])),
    symptoms: {},
    recordedFor: Object.fromEntries(asked.map((step) => [step.key, step.partIds[0]])),
  };
}

/** Every scope a visitor can pick on `build`: one part, or two hosts a question names together. */
function scopesOf(build: ReturnType<typeof buildOf>, full: readonly CheckStepRef[]): PartsScope[] {
  const fitted = new Set(build.parts.map((part) => part.partId));
  const singles = PARTS.filter((part) => fitted.has(part.id)).map((part) => [part.id]);
  const pairs = new Map<string, PartId[]>();
  for (const step of full) {
    for (const [index, left] of step.partIds.entries()) {
      for (const right of step.partIds.slice(index + 1)) {
        pairs.set([left, right].sort().join(","), [left, right]);
      }
    }
  }
  return [...singles, ...pairs.values()].map((partIds) => ({ kind: "parts", partIds }));
}

describe("recordedScope over the corpus", () => {
  it.each(PRESETS)(
    "%s: the parts the rows tell ask every answered question as its run did",
    (preset) => {
      const build = buildOf(preset);
      const plan = (scope: CheckupScope) => planCheckup(build, scope, FR);
      const full = plan({ kind: "full" });
      let told = 0;
      let runs = 0;
      for (const scope of scopesOf(build, full)) {
        const steps = plan(scope);
        for (let answered = 1; answered <= steps.length; answered += 1) {
          runs += 1;
          const run = rowsOf(steps, answered);
          const recorded = recordedScope(run, full, plan);
          if (recorded === null) continue;
          told += 1;
          expect(
            sameEffects(run, plan(recorded), steps),
            `${preset}: ${scope.partIds.join("+")} (${answered} answered) read as ${recorded.partIds.join("+")}`,
          ).toBe(true);
        }
      }
      // Not vacuous: the rows tell the parts of a good share of the runs —
      // every one-sided run of the rear side among them.
      expect(told).toBeGreaterThan(runs / 4);
    },
  );

  it("tells the rear caliper from a rear-caliper run's rows, and nothing from a front one's — on every disc-brake preset", () => {
    for (const preset of PRESETS) {
      const build = buildOf(preset);
      const plan = (scope: CheckupScope) => planCheckup(build, scope, FR);
      const full = plan({ kind: "full" });
      if (!full.some((step) => step.key === "check-brakes-disc#pad-wear")) continue;
      const rear = plan({ kind: "parts", partIds: ["brake-caliper-rear"] });
      expect(recordedScope(rowsOf(rear, rear.length), full, plan), preset).toEqual({
        kind: "parts",
        partIds: ["brake-caliper-rear"],
      });
      const front = plan({ kind: "parts", partIds: ["brake-caliper-front"] });
      expect(recordedScope(rowsOf(front, front.length), full, plan), preset).toBeNull();
    }
  });

  it.each(PRESETS)(
    "%s: rows written before 2026-10-22 never read as narrowing an answer given to a whole question",
    (preset) => {
      const build = buildOf(preset);
      const plan = (scope: CheckupScope) => planCheckup(build, scope, FR);
      const full = plan({ kind: "full" });
      for (const scope of scopesOf(build, full)) {
        // The planner of then: every question whose hosts meet a picked one's,
        // whole — and so every row on its whole question's first part.
        const steps = planBeforeTheScopeRule(build, scope);
        for (let answered = 1; answered <= steps.length; answered += 1) {
          const run = rowsOf(steps, answered);
          const recorded = recordedScope(run, full, plan);
          if (recorded === null) continue;
          expect(
            sameEffects(run, plan(recorded), full),
            `${preset}: ${scope.partIds.join("+")} (${answered} answered, before) read as ${recorded.partIds.join("+")}`,
          ).toBe(true);
        }
      }
    },
  );
});
