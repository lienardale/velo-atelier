/**
 * A checkup's answers as ROWS (§4.4, §5.4) — what a `CheckupItem` holds.
 *
 * One function, because two writers produce those rows and they must not
 * disagree: `writeItems` (`app/[locale]/velo/[id]/controle/actions.ts`), which
 * saves and finishes a checkup on an account, and the guest import
 * (`lib/guest/import.ts`), which writes a checkup that was answered in a
 * browser. Both hand it a state that has ALREADY been married to the plan the
 * server computed (`fromStored` → `reconcile`), so every row here is about a
 * question the bike really gets asked.
 *
 *   one row per ANSWERED step, in plan order — a step with no verdict has no
 *                row, and a note left on one is not stored;
 *   `partId`     the step's FIRST reported part. A row names one part, and the
 *                plan lists a step's parts host-expanded and in the guide's own
 *                order, so this is the part the question is mainly about;
 *   `reasonKeys` only for a KO — an OK or a skipped step has no symptom, even
 *                if the state still remembers one from before the verdict
 *                changed.
 *
 * Pure and zod-free, like the rest of this folder.
 */
import type { PartId } from "@/lib/domain/data/parts";

import type { CheckStepKey, CheckupAnswer, CheckupState } from "./types";

/** One `CheckupItem` row, in the domain's vocabulary (the writer maps `result`). */
export interface AnsweredItem {
  stepKey: CheckStepKey;
  partId: PartId;
  guideSlug: string;
  result: CheckupAnswer;
  /** `null`, not `""`, when the visitor wrote nothing: the column is nullable. */
  notes: string | null;
  reasonKeys: string[];
}

/** The rows `state` implies: one per step of its plan that has a verdict. */
export function answeredItems(state: CheckupState): AnsweredItem[] {
  return state.steps.flatMap((step) => {
    const result = Object.hasOwn(state.answers, step.key) ? state.answers[step.key] : undefined;
    if (result === undefined) return [];
    return [
      {
        stepKey: step.key,
        partId: step.partIds[0],
        guideSlug: step.guideSlug,
        result,
        notes: Object.hasOwn(state.notes, step.key) ? state.notes[step.key] : null,
        reasonKeys:
          result === "ko" && Object.hasOwn(state.symptoms, step.key)
            ? [...state.symptoms[step.key]]
            : [],
      },
    ];
  });
}
