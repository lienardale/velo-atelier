/**
 * `(action, partId)` is the identity of a build-list LINE, not of a question —
 * over every preset's full plan, on both paths (§5.4, §6.7; W3 follow-up (a)).
 *
 * Two rules, and the two paths that must apply them identically:
 *
 *   within one checkup   an OK on another question naming the same pair never
 *                        closes the line a KO of that checkup derived (on the
 *                        demo bike alone ten pairs are named by two questions);
 *   a later checkup      an OK on a question naming the pair DOES close an open
 *                        line — `done`, with `doneReason: 'recheck-ok'` — and a
 *                        KO naming it again reopens it.
 *
 *   guest   `mergeGuestBuildList` over `va:buildlist:<ref>` (one list per bike);
 *   server  `finishCheckupAction` against the recording fake: one `BuildList`
 *           per checkup, `closeRecheckedItems` on the others.
 *
 * Before W4 they disagreed twice. The server closed by PART, through the
 * viewer's host-expanded tint, so a hosted part (the pads, planned through the
 * caliper) never closed and a line with another action on the same part did;
 * the guest merge could hand a KO's line back already closed. Both are what the
 * cross-path assertion below catches — `recheckedLines` is the one rule, and
 * the two paths must close exactly its pairs.
 *
 * `fast-check` draws the verdicts (ok / ko / skipped / unanswered, a symptom or
 * none) from each preset's real plan; the corpus is planned once, at module
 * scope (`.debug/009`).
 */
import fc from "fast-check";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { fakeDb } from "@/tests/_fakes/prisma";
import {
  sameOriginHeaders,
  sessionFor,
  setRequestHeaders,
  setSession,
} from "@/tests/_fakes/session";

vi.mock("@/auth", async () => (await import("@/tests/_fakes/session")).authModule());
vi.mock("content-collections", async () => ({
  allGuides: (await import("@/tests/_helpers/guides")).diskGuides(),
  allLegalPages: [],
}));

const { finishCheckupAction } = await import("@/app/[locale]/velo/[id]/controle/actions");
const { deriveBuildList, mergeGuestBuildList, recheckedLines } =
  await import("@/lib/checkup/build-list");
const { planCheckup } = await import("@/lib/checkup/plan");
const { toStored } = await import("@/lib/checkup/storage");
const { deriveBike } = await import("@/lib/bike/rules");
const { BIKE_PRESETS } = await import("@/lib/domain/data/presets");
const { diskGuides } = await import("@/tests/_helpers/guides");
const { makeState } = await import("@/tests/_helpers/checkup");

type CheckStepRef = import("@/lib/checkup/types").CheckStepRef;
type CheckupState = import("@/lib/checkup/types").CheckupState;
type BuildListItem = import("@/lib/checkup/types").BuildListItem;

const FR = diskGuides().filter((guide) => guide.locale === "fr");

/** The Prisma spelling of a `KoAction` — the server stores the enum. */
const PRISMA_ACTION: Record<string, string> = {
  replace: "REPLACE",
  fix: "FIX",
  clean: "CLEAN",
  adjust: "ADJUST",
  "inspect-shop": "INSPECT_SHOP",
};
const pair = (action: string, partId: string) => `${action}|${partId}`;
const rowPair = (row: Record<string, unknown>) =>
  `${Object.entries(PRISMA_ACTION).find(([, value]) => value === row.action)?.[0]}|${String(row.partId)}`;

const PRESETS = Object.entries(BIKE_PRESETS).map(([id, answers]) => {
  const derived = deriveBike(answers);
  const steps = planCheckup({ spec: derived.spec, parts: derived.parts }, { kind: "full" }, FR);
  return { id, derived, steps };
});

interface Draw {
  verdict: "ok" | "ko" | "skipped" | "none";
  symptom: string | undefined;
}

function drawsFor(steps: readonly CheckStepRef[]): fc.Arbitrary<Draw[]> {
  return fc.tuple(
    ...steps.map((step) =>
      fc.record({
        verdict: fc.constantFrom("ok" as const, "ko" as const, "skipped" as const, "none" as const),
        symptom: fc.option(
          fc.constantFrom(...step.ko.map((consequence) => consequence.reasonKey)),
          {
            nil: undefined,
          },
        ),
      }),
    ),
  );
}

function stateOf(
  steps: readonly CheckStepRef[],
  draws: readonly Draw[],
  startedAt: string,
): CheckupState {
  const answers: Record<string, "ok" | "ko" | "skipped"> = {};
  const symptoms: Record<string, string[]> = {};
  steps.forEach((step, index) => {
    const draw = draws[index];
    if (draw.verdict === "none") return;
    answers[step.key] = draw.verdict;
    if (draw.verdict === "ko" && draw.symptom !== undefined) symptoms[step.key] = [draw.symptom];
  });
  return makeState(steps, { answers, symptoms, startedAt });
}

const derivedPairs = (state: CheckupState) =>
  new Set(deriveBuildList(state).map((item) => pair(item.action, item.partId)));
const closingPairs = (state: CheckupState) =>
  new Set(recheckedLines(state).map((line) => pair(line.action, line.partId)));

describe.each(PRESETS)("$id", ({ id, derived, steps }) => {
  it("never lets a checkup close a line it derives — the pure rule and the guest merge", () => {
    fc.assert(
      fc.property(
        drawsFor(steps),
        fc.boolean(),
        fc.array(fc.constantFrom("manual", "recheck-ok", "open"), { minLength: 60, maxLength: 60 }),
        (draws, sameCheckup, previousStates) => {
          const state = stateOf(steps, draws, "2026-09-15T08:00:00.000Z");
          const kept = derivedPairs(state);

          // The rule itself: what a checkup closes and what it derives are disjoint.
          for (const closed of closingPairs(state)) expect(kept.has(closed), closed).toBe(false);

          // A stored copy of every derived line, in any state, merged back.
          const previous: BuildListItem[] = deriveBuildList(state).map((item, index) => {
            const how = previousStates[index % previousStates.length];
            return how === "open" ? item : { ...item, done: true, doneReason: how };
          });
          const merged = mergeGuestBuildList(previous, deriveBuildList(state), state, sameCheckup);
          for (const line of merged) {
            if (!kept.has(pair(line.action, line.partId))) continue;
            // Never closed by this checkup's own recheck…
            expect(line.doneReason, `${id} ${line.id}`).not.toBe("recheck-ok");
            // …and, for a LATER checkup, open whatever closed it before.
            if (!sameCheckup) expect(line.done, `${id} ${line.id}`).toBe(false);
          }
        },
      ),
      { numRuns: 200 },
    );
  });

  describe("a later checkup, guest and server", () => {
    const USER = {
      id: "00000000-0000-4000-8000-0000000000a1",
      email: "camille@velo-atelier.test",
      name: "Camille",
      locale: "fr" as const,
    };
    let bikeId: string;

    beforeEach(async () => {
      fakeDb.reset();
      setRequestHeaders(sameOriginHeaders());
      await fakeDb.seed("User", USER);
      bikeId = (
        (await fakeDb.seed("Bike", {
          userId: USER.id,
          name: id,
          answers: derived.answers,
          spec: derived.spec,
          parts: derived.parts,
        })) as { id: string }
      ).id;
      setSession(sessionFor(USER));
    });

    it("closes exactly the open lines its OKs name and its KOs do not, on both paths", async () => {
      await fc.assert(
        fc.asyncProperty(
          drawsFor(steps),
          drawsFor(steps),
          fc.array(fc.boolean(), { maxLength: 60 }),
          async (first, second, ticks) => {
            fakeDb.reset();
            await fakeDb.seed("User", USER);
            bikeId = (
              (await fakeDb.seed("Bike", {
                userId: USER.id,
                name: id,
                answers: derived.answers,
                spec: derived.spec,
                parts: derived.parts,
              })) as { id: string }
            ).id;

            const earlier = stateOf(steps, first, "2026-09-01T08:00:00.000Z");
            const later = stateOf(steps, second, "2026-09-15T08:00:00.000Z");

            // ── the first checkup, and the lines the visitor ticked by hand ──
            const firstList = deriveBuildList(earlier);
            const ticked = new Set(
              firstList
                .filter((_, index) => ticks[index] === true)
                .map((item) => pair(item.action, item.partId)),
            );
            const guestList = firstList.map((item) =>
              ticked.has(pair(item.action, item.partId))
                ? { ...item, done: true, doneReason: "manual" as const }
                : item,
            );
            const firstResult = await finishCheckupAction({ bikeId, checkup: toStored(earlier) });
            expect(firstResult.ok).toBe(true);
            const listOne = firstResult.ok ? firstResult.data.buildListId : "";
            for (const row of fakeDb.rows("BuildListItem")) {
              if (ticked.has(rowPair(row))) {
                await fakeDb.client.buildListItem.update({
                  where: { id: row.id as string },
                  data: { done: true, doneReason: "manual" },
                });
              }
            }

            // ── the later checkup ──
            const expectedClosed = new Set(
              [...closingPairs(later)].filter(
                (closing) =>
                  firstList.some((item) => pair(item.action, item.partId) === closing) &&
                  !ticked.has(closing),
              ),
            );

            const merged = mergeGuestBuildList(guestList, deriveBuildList(later), later, false);
            const guestClosed = new Set(
              merged
                .filter((line) => line.doneReason === "recheck-ok")
                .map((line) => pair(line.action, line.partId)),
            );

            const secondResult = await finishCheckupAction({ bikeId, checkup: toStored(later) });
            expect(secondResult.ok).toBe(true);
            const rows = fakeDb.rows("BuildListItem");
            const serverClosed = new Set(
              rows
                .filter((row) => row.buildListId === listOne && row.doneReason === "recheck-ok")
                .map(rowPair),
            );

            // The one rule, applied the same way on both paths.
            expect(guestClosed, `${id}: guest`).toEqual(expectedClosed);
            expect(serverClosed, `${id}: server`).toEqual(expectedClosed);
            for (const row of rows.filter(
              (entry) => entry.buildListId === listOne && serverClosed.has(rowPair(entry)),
            )) {
              expect(row.done).toBe(true);
            }
            // A hand tick is the visitor's, on both paths.
            for (const tick of ticked) {
              expect(
                rows.find((row) => row.buildListId === listOne && rowPair(row) === tick)
                  ?.doneReason,
              ).toBe("manual");
            }
            // And the later checkup's own findings are open lines, on both paths.
            const found = derivedPairs(later);
            const secondList = secondResult.ok ? secondResult.data.buildListId : "";
            const listTwo = rows.filter((row) => row.buildListId === secondList);
            expect(new Set(listTwo.map(rowPair))).toEqual(found);
            expect(listTwo.every((row) => row.done === false)).toBe(true);
            expect(
              merged
                .filter((line) => found.has(pair(line.action, line.partId)))
                .every((line) => !line.done),
            ).toBe(true);
          },
        ),
        // A failure is reported as its first counterexample, unshrunk: shrinking
        // fifty runs of two finishes each takes several seconds, past the tier's
        // 5 s timeout, while a passing run takes under one (0.8 s at most under
        // the full coverage run). No timeout of its own (the W4 gate rules).
        { numRuns: 50, endOnFailure: true },
      );
    });
  });
});
