/**
 * Procedures: the contract every guide's MDX frontmatter has to satisfy
 * (§1.2, §5).
 *
 * A guide is a procedure of one `kind` — the field is **always** `kind`, never
 * `type` — over one or more parts. `check` guides are the backbone of the
 * checkup: each of their steps may carry a `checkQuestion`, and each answer of
 * "ça ne marche pas" turns into a {@link KoConsequence}, which is exactly one
 * line of the to-fix list.
 *
 * `content-collections.ts` (W1-T4) extends this schema with the fields that
 * belong to the document rather than to the procedure (`title`, `summary`,
 * `status`, `related`, `order`); `scripts/content-check.ts` is what validates
 * the cross-document rules (does the target guide exist, does its kind match).
 */
import * as z from "zod";

import { ID_PATTERN } from "../data/conventions";

import type { SpecPath } from "./bike-spec";
import { SpecConditionSchema, type SpecCondition } from "./condition";

export const PROCEDURE_KINDS = ["check", "replace", "clean", "adjust", "measure"] as const;

export type ProcedureKind = (typeof PROCEDURE_KINDS)[number];

/**
 * What a failed check leads to.
 *
 * `fix` is the "you can sort this out yourself without new parts" action and
 * resolves to an **`adjust`** guide; every other action resolves to a guide of
 * the same kind. `inspect-shop` is the honest answer for the jobs this site
 * deliberately does not teach (hydraulic bleeding, wheel truing, bearings) and
 * is the only action that may omit `guideSlug`.
 */
export const KO_ACTIONS = ["replace", "fix", "clean", "adjust", "inspect-shop"] as const;

export type KoAction = (typeof KO_ACTIONS)[number];

export interface KoConsequence {
  action: KoAction;
  partId: string;
  /** `guides.reasons.<reasonKey>` — why this part landed on the list. */
  reasonKey: string;
  /** Required unless the action is `inspect-shop`. */
  guideSlug?: string;
}

export interface ProcedureTool {
  toolId: string;
  /** Tools that do the same job, offered when the visitor says they lack the first. */
  alternatives: readonly string[];
}

export interface ProcedureStep<P extends string = SpecPath> {
  id: string;
  /** Plain text in the document's own language, not a message key. */
  title: string;
  /** Narrows the step to some parts of the guide's `partIds`. */
  partIds?: readonly string[];
  /** Narrows the step to some bikes. */
  appliesTo?: SpecCondition<P>;
  /** An id from the illustration registry. */
  illustration?: string;
  /** Present on the steps a checkup asks about. */
  checkQuestion?: {
    prompt: string;
    ko: readonly KoConsequence[];
    /** May the visitor skip this check (no tool, no time)? */
    skippable: boolean;
  };
}

export interface ProcedureMeta<P extends string = SpecPath> {
  /** Equals the folder name under `content/guides/`. */
  slug: string;
  kind: ProcedureKind;
  partIds: readonly string[];
  tools: readonly ProcedureTool[];
  /** Absent = applies to every bike. */
  appliesTo?: SpecCondition<P>;
  difficulty: 1 | 2 | 3;
  /** Rough time on the tools, in minutes. */
  minutes: number;
  steps: readonly ProcedureStep<P>[];
}

/** A tool, and what can stand in for it (`data/tools.ts`, W1-T2). */
export interface ToolDef {
  id: string;
  /** `tools.<id>.label` */
  labelKey: string;
  alternatives: readonly string[];
}

const IdSchema = z.string().regex(ID_PATTERN).max(48);
const SlugSchema = z.string().regex(ID_PATTERN).max(64);

export const KoConsequenceSchema: z.ZodType<KoConsequence> = z
  .strictObject({
    action: z.enum(KO_ACTIONS),
    partId: IdSchema,
    reasonKey: z.string().regex(ID_PATTERN).max(80),
    guideSlug: SlugSchema.optional(),
  })
  .check((ctx) => {
    if (ctx.value.action !== "inspect-shop" && ctx.value.guideSlug === undefined) {
      ctx.issues.push({
        code: "custom",
        message: `a "${ctx.value.action}" consequence needs a guideSlug`,
        input: ctx.value,
      });
    }
  });

export const ProcedureStepSchema: z.ZodType<ProcedureStep<string>> = z.strictObject({
  id: IdSchema,
  title: z.string().min(1),
  partIds: z.array(IdSchema).optional(),
  appliesTo: SpecConditionSchema.optional(),
  illustration: IdSchema.optional(),
  checkQuestion: z
    .strictObject({
      prompt: z.string().min(1),
      ko: z.array(KoConsequenceSchema).min(1),
      skippable: z.boolean(),
    })
    .optional(),
});

export const ToolDefSchema: z.ZodType<ToolDef> = z.strictObject({
  id: IdSchema,
  labelKey: z.string().min(1),
  alternatives: z.array(IdSchema),
});

export const ProcedureMetaSchema: z.ZodType<ProcedureMeta<string>> = z
  .strictObject({
    slug: SlugSchema,
    kind: z.enum(PROCEDURE_KINDS),
    partIds: z.array(IdSchema).min(1),
    tools: z.array(z.strictObject({ toolId: IdSchema, alternatives: z.array(IdSchema) })),
    appliesTo: SpecConditionSchema.optional(),
    difficulty: z.literal([1, 2, 3]),
    minutes: z.int().positive().max(600),
    steps: z.array(ProcedureStepSchema).min(1),
  })
  .check((ctx) => {
    for (const message of checkProcedure(ctx.value)) {
      ctx.issues.push({ code: "custom", message, input: ctx.value });
    }
  });

/**
 * Document-level refinements: step ids are unique, a step only narrows to parts
 * the guide is about, and only a `check` guide asks questions.
 */
export function checkProcedure(meta: ProcedureMeta<string>): string[] {
  const errors: string[] = [];
  const seen = new Set<string>();
  const partIds = new Set(meta.partIds);

  for (const step of meta.steps) {
    if (seen.has(step.id)) errors.push(`${meta.slug}#${step.id}: duplicate step id`);
    seen.add(step.id);

    for (const partId of step.partIds ?? []) {
      if (!partIds.has(partId)) {
        errors.push(`${meta.slug}#${step.id}: "${partId}" is not one of the guide's partIds`);
      }
    }
    if (step.checkQuestion !== undefined && meta.kind !== "check") {
      errors.push(`${meta.slug}#${step.id}: only a "check" guide carries a checkQuestion`);
    }
  }

  return errors;
}

/** The guide kind a KO consequence resolves to (`fix` is handled by an adjust guide). */
export function guideKindFor(action: KoAction): ProcedureKind | null {
  if (action === "inspect-shop") return null;
  return action === "fix" ? "adjust" : action;
}
