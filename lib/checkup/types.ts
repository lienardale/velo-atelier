/**
 * The checkup contract (plan §5.4) — the shapes W3-T1 (engine + wizard) and
 * W3-T2 (build list + shop) both build on.
 *
 * **Zod-free on purpose**, exactly like `lib/content/types.ts`: the wizard and
 * the build list are client components, and `import type` from here never drags
 * a parser into a bundle. The parsers live next door — `lib/checkup/storage.ts`
 * guards what comes back from `localStorage` with `zod/mini`, and the server
 * actions of `app/[locale]/velo/[id]/{controle,liste}/actions.ts` guard what
 * comes back from a form with classic zod.
 *
 * Vocabulary:
 *
 *   plan     the ordered `CheckStepRef[]` a (build, scope) pair produces. It is
 *            derived, never persisted: the server recomputes it from
 *            `(spec, scope)` on every request and the client sends back only a
 *            step KEY (§4.4), so a visitor cannot invent a step.
 *   state    the visitor's answers to that plan, which IS persisted —
 *            `va:checkup:<ref>` for a guest, `Checkup` + `CheckupItem` rows for
 *            a saved bike.
 *   item     one line of the to-fix list, derived from the KO answers.
 */
import type { BikeRef } from "@/lib/bike/resolve-bike-ref";
import type { PartId } from "@/lib/domain/data/parts";
import type { ToolId } from "@/lib/domain/data/tools";
import type { KoAction, KoConsequence } from "@/lib/domain/schema/procedure";
import type { Locale } from "@/lib/i18n/routing";

/** A full checkup, or the parts the visitor ticked in the parts panel. */
export type CheckupScope = { kind: "full" } | { kind: "parts"; partIds: readonly PartId[] };

/** What the visitor said about one step. Mirrors Prisma's `CheckupResult`. */
export const CHECKUP_ANSWERS = ["ok", "ko", "skipped"] as const;

export type CheckupAnswer = (typeof CHECKUP_ANSWERS)[number];

/**
 * `${guideSlug}#${stepId}` — stable across re-plans, which is what lets
 * `reconcile()` keep an answer when the corpus grows, and what `CheckupItem`
 * stores. Never a number: a cursor is a position in one plan, a key is not.
 */
export type CheckStepKey = string;

/** A tool a step needs, and what the visitor may use instead. */
export interface ToolRef {
  toolId: ToolId;
  alternatives: readonly ToolId[];
}

/** One planned question: a `check` step of a guide that applies to this bike. */
export interface CheckStepRef {
  key: CheckStepKey;
  guideSlug: string;
  stepId: string;
  /** The parts this step reports on — already expanded from hosted to host. */
  partIds: readonly PartId[];
  /** The symptoms a "ça ne marche pas" offers, and what each one costs. */
  ko: readonly KoConsequence[];
  skippable: boolean;
  tools: readonly ToolRef[];
}

/** Bumped only by a shape change that `storage.ts` cannot read (§1.2). */
export const CHECKUP_STATE_VERSION = 1;

export interface CheckupState {
  /** A uuid, so a guest state can be imported without colliding. */
  id: string;
  bikeRef: BikeRef;
  scope: CheckupScope;
  locale: Locale;
  /** The plan this state was built against — re-planned and reconciled on load. */
  steps: readonly CheckStepRef[];
  /** Position in `steps`; `steps.length` means "on the summary". */
  cursor: number;
  answers: Readonly<Record<CheckStepKey, CheckupAnswer>>;
  /** Free text the visitor added, per step. Never a message key. */
  notes: Readonly<Record<CheckStepKey, string>>;
  /** Tools the visitor said they do not have, so the step offers alternatives. */
  toolsMissing: readonly ToolId[];
  /** ISO 8601. */
  startedAt: string;
  completedAt?: string;
  /**
   * `CONTENT_VERSION` at the time the plan was made
   * (`lib/content/generated/version.ts`). A mismatch on load means the corpus
   * moved under the visitor and `reconcile()` has work to do.
   */
  contentVersion: string;
  version: typeof CHECKUP_STATE_VERSION;
}

export type CheckupEvent =
  | { type: "ANSWER"; key: CheckStepKey; result: Exclude<CheckupAnswer, "skipped">; notes?: string }
  | { type: "SKIP"; key: CheckStepKey }
  | { type: "BACK" }
  | { type: "JUMP"; key: CheckStepKey }
  /** Accepted only once every step is answered or skipped. */
  | { type: "FINISH" }
  | { type: "TOOL_MISSING"; toolId: ToolId; missing: boolean };

/** The build list's action. Same vocabulary as a KO consequence (§1.2). */
export type BuildAction = KoAction;

/** What the visitor settled on buying — `BuildListItem.chosenProduct` (§4.2). */
export interface ChosenProduct {
  brand: string;
  model: string;
  size: string;
  /** A `RetailerId`, or `"other"` for a link the visitor pasted. */
  vendor: string;
  /** https, and on the retailer's own host unless `vendor` is `"other"` (§4.4). */
  url: string;
}

/**
 * One line of the to-fix list.
 *
 * `deriveBuildList(state)` emits one per KO consequence and merges them on
 * `(action, partId)` — the same brake pads named by two steps are one line. The
 * id is `${stepKey}|${partId}|${action}` built from the FIRST step that named
 * it, which makes it deterministic without hashing (§5.4) and stable when a
 * later step adds the same pair.
 *
 * `refinement` and `chosenProduct` are the visitor's own edits, so they are
 * absent on a freshly derived item and restored from storage by W3-T2.
 */
export interface BuildListItem {
  /** `${stepKey}|${partId}|${action}` */
  id: string;
  /** The step that first produced it; `sourceKeys` has the rest. */
  stepKey: CheckStepKey;
  /** Every step whose KO contributed, in plan order — what a recheck consults. */
  sourceKeys: readonly CheckStepKey[];
  partId: PartId;
  action: BuildAction;
  /** `guides.reasons.<reasonKey>`, validated against the generated enum. */
  reasonKey: string;
  /** Absent only when `action` is `inspect-shop`. */
  guideSlug?: string;
  done: boolean;
  /**
   * Why it is done. `recheck-ok` is set by the engine when a later partial
   * checkup answers OK on a part with an open item (§5.4, §6.7); `manual` is
   * the visitor ticking the box.
   */
  doneReason?: "manual" | "recheck-ok";
  /** Answers to the buying-guide questions (`PART_QUESTIONS`, W3-T2). */
  refinement?: Readonly<Record<string, string>>;
  chosenProduct?: ChosenProduct;
  sortOrder: number;
}
