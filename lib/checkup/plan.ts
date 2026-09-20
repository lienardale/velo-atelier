/**
 * The plan: which questions THIS bike gets asked, in which order (§5.4).
 *
 * `planCheckup` is a pure function of `(build, scope, guides)` and is the only
 * thing that decides a checkup's content. That matters for more than tidiness:
 * the server recomputes it on every request and the client sends back a step
 * KEY, never a step (§4.4). A visitor who invents `?parts=`, edits storage or
 * posts a hand-written payload therefore cannot conjure a question, a reason or
 * a guide slug — the plan they get is the plan their bike deserves, and an
 * answer whose key is not in it is dropped on the way in.
 *
 * ## Four filters, in this order
 *
 *   1. `kind === 'check'` — a replace guide is a procedure, not a question.
 *   2. the guide's `appliesTo` matches the spec (no disc-brake steps on a
 *      rim-brake bike, no e-system steps on a muscular one);
 *   3. the step's own `appliesTo` matches (a tubeless bike is asked about
 *      sealant, a tubed one about its tubes);
 *   4. the step names at least one part this bike actually carries — and, when
 *      the scope is a set of parts, one the visitor picked.
 *
 * ## Hosted parts expand to hosts
 *
 * The viewer can only be clicked on parts that are drawn, so "the brake pads"
 * are picked by tapping their caliper (§1.2 `hostPartId`). Both sides of the
 * scope test therefore go through `clickTargetOf`, and `CheckStepRef.partIds`
 * holds the expanded set: it is what tints the viewer after the checkup, where
 * a hosted part has no mesh of its own to tint. The KO consequences keep the
 * REAL part id — the to-fix list is about pads, not about the caliper they sit
 * in.
 *
 * Pure and zod-free: imported by the wizard, so nothing here may reach React,
 * Prisma, `content-collections` or classic zod.
 */
import { matchesSpec } from "@/lib/content/applies-to";
import { clickTargetOf, isPartId, partDefinition, type PartId } from "@/lib/domain/data/parts";
import { isToolId, TOOL_IDS, type ToolId } from "@/lib/domain/data/tools";
import type { SpecCondition } from "@/lib/domain/schema/condition";
import type { BikeBuild } from "@/lib/domain/schema/part";
import type {
  KoConsequence,
  ProcedureKind,
  ProcedureStep,
  ProcedureTool,
} from "@/lib/domain/schema/procedure";

import type { CheckStepKey, CheckStepRef, CheckupScope, ToolRef } from "./types";

/**
 * What `planCheckup` needs of a guide — a structural subset of
 * `GuideDocument`, so the page can pass the content collection straight in
 * while a unit test passes three literals.
 */
export interface PlannableGuide {
  slug: string;
  kind: ProcedureKind;
  order: number;
  partIds: readonly string[];
  tools: readonly ProcedureTool[];
  steps: readonly ProcedureStep<string>[];
  appliesTo?: SpecCondition<string>;
  /** `stub` guides are planned like any other, and badged (§6.5). */
  status?: string;
}

/** `${guideSlug}#${stepId}` (§1.2) — the identity of a question. */
export function stepKeyOf(guideSlug: string, stepId: string): CheckStepKey {
  return `${guideSlug}#${stepId}`;
}

/** The two halves of a step key, or `null` when the string is not one. */
export function parseStepKey(key: string): { guideSlug: string; stepId: string } | null {
  const hash = key.indexOf("#");
  if (hash <= 0 || hash === key.length - 1) return null;
  return { guideSlug: key.slice(0, hash), stepId: key.slice(hash + 1) };
}

/** The part a click lands on: a hosted part reports through its host (§1.2). */
export function hostOf(partId: string): PartId | null {
  return isPartId(partId) ? clickTargetOf(partId) : null;
}

/** `?parts=` → a scope. An empty selection is a FULL checkup, not an empty one. */
export function scopeFromPartIds(partIds: readonly PartId[]): CheckupScope {
  return partIds.length === 0 ? { kind: "full" } : { kind: "parts", partIds };
}

/** The picked parts as their clickable hosts, deduplicated. */
function expandScope(scope: CheckupScope): ReadonlySet<PartId> | null {
  if (scope.kind === "full") return null;
  const hosts = new Set<PartId>();
  for (const partId of scope.partIds) {
    const host = hostOf(partId);
    if (host !== null) hosts.add(host);
  }
  return hosts;
}

/** The step's parts, kept to what is fitted, expanded to hosts, deduplicated. */
function reportedParts(
  partIds: readonly string[],
  fitted: ReadonlySet<string>,
): { parts: PartId[]; priority: number } {
  const parts: PartId[] = [];
  let priority = Number.MAX_SAFE_INTEGER;
  for (const partId of partIds) {
    if (!fitted.has(partId)) continue;
    // A bike row written before a taxonomy change can carry a part the
    // catalogue no longer has: it is not a question, and it is not a priority.
    const definition = partDefinition(partId);
    if (definition === undefined) continue;
    priority = Math.min(priority, definition.checkupPriority);
    const host = clickTargetOf(definition.id);
    if (!parts.includes(host)) parts.push(host);
  }
  return { parts, priority };
}

/** The guide's tools as `ToolRef`s; ids the catalogue does not know are dropped. */
export function toolRefs(tools: readonly ProcedureTool[]): ToolRef[] {
  return tools.flatMap((tool) =>
    isToolId(tool.toolId)
      ? [
          {
            toolId: tool.toolId,
            alternatives: tool.alternatives.filter(
              (alternative): alternative is ToolId =>
                isToolId(alternative) && alternative !== tool.toolId,
            ),
          },
        ]
      : [],
  );
}

interface PlannedStep {
  ref: CheckStepRef;
  /** Lowest `checkupPriority` of the parts the step reports on: brakes first. */
  priority: number;
  order: number;
  index: number;
}

/**
 * The questions to ask, ordered by `checkupPriority`, then the guide's `order`,
 * then the step's position in its guide — a total order, so two runs of the
 * same bike ask the same things in the same sequence and a stored `cursor`
 * still means what it meant.
 *
 * Duplicate keys are dropped: passing both locales of the corpus (or the same
 * guide twice) plans one checkup, not two.
 */
export function planCheckup(
  build: BikeBuild,
  scope: CheckupScope,
  guides: readonly PlannableGuide[],
): CheckStepRef[] {
  const fitted = new Set(build.parts.map((part) => part.partId));
  const wanted = expandScope(scope);
  const planned = new Map<CheckStepKey, PlannedStep>();

  for (const guide of guides) {
    if (guide.kind !== "check") continue;
    if (!matchesSpec(guide.appliesTo, build.spec)) continue;
    const tools = toolRefs(guide.tools);

    guide.steps.forEach((step, index) => {
      const question = step.checkQuestion;
      if (question === undefined) return;
      if (!matchesSpec(step.appliesTo, build.spec)) return;

      const { parts, priority } = reportedParts(step.partIds ?? guide.partIds, fitted);
      if (parts.length === 0) return;
      if (wanted !== null && !parts.some((partId) => wanted.has(partId))) return;

      const key = stepKeyOf(guide.slug, step.id);
      if (planned.has(key)) return;

      planned.set(key, {
        priority,
        order: guide.order,
        index,
        ref: {
          key,
          guideSlug: guide.slug,
          stepId: step.id,
          partIds: parts,
          // A consequence about a part this bike does not carry would put a
          // line on the to-fix list for something that is not on the bike.
          ko: question.ko.filter((consequence: KoConsequence) => fitted.has(consequence.partId)),
          skippable: question.skippable,
          tools,
          title: step.title,
          prompt: question.prompt,
          number: index + 1,
          ...(guide.status === "stub" ? { stub: true } : {}),
        },
      });
    });
  }

  return [...planned.values()]
    .sort(
      (left, right) =>
        left.priority - right.priority ||
        left.order - right.order ||
        left.index - right.index ||
        left.ref.key.localeCompare(right.ref.key),
    )
    .map((entry) => entry.ref);
}

/**
 * Every tool the plan needs, once, with the stand-ins its guides declare
 * (§6.5: the checklist shown before step 1).
 *
 * Catalogue order rather than plan order, for both the tools and each one's
 * alternatives: the list is read as a shopping list, and a stable order makes
 * it snapshot-testable.
 */
export function toolsFor(steps: readonly CheckStepRef[]): ToolRef[] {
  const merged = new Map<ToolId, Set<ToolId>>();
  for (const step of steps) {
    for (const tool of step.tools) {
      const alternatives = merged.get(tool.toolId) ?? new Set<ToolId>();
      for (const alternative of tool.alternatives) alternatives.add(alternative);
      merged.set(tool.toolId, alternatives);
    }
  }
  return TOOL_IDS.filter((toolId) => merged.has(toolId)).map((toolId) => ({
    toolId,
    alternatives: TOOL_IDS.filter((alternative) => merged.get(toolId)?.has(alternative) === true),
  }));
}
