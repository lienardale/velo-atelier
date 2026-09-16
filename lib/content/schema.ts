/**
 * The frontmatter parser every guide goes through (§5.1).
 *
 * `GuideFrontmatterSchema` is `ProcedureMeta` (the domain contract, owned by
 * `lib/domain/schema/procedure.ts`) plus the fields that belong to the document
 * rather than to the procedure: `title`, `summary`, `status`, `related`,
 * `order` and the optional `safety` notes. It is used by:
 *
 *   - `content-collections.ts` — the build refuses a guide it does not parse;
 *   - `lib/content/check.ts`   — the authoritative validator (`npm run content:check`);
 *   - the content tests.
 *
 * Classic `zod`: server, build and test side only. Nothing under `components/`
 * imports this file (ESLint forbids `zod` there).
 *
 * Field schemas are reused from the domain one by one rather than extending
 * `ProcedureMetaSchema`, because that schema is a strict object with a
 * refinement attached (a refined schema cannot be extended), and the document
 * fields must be part of the same strict object or they would be rejected as
 * unknown keys.
 */
import * as z from "zod";

import { ID_PATTERN } from "@/lib/domain/data/conventions";
import { SpecConditionSchema } from "@/lib/domain/schema/condition";
import {
  checkProcedure,
  PROCEDURE_KINDS,
  ProcedureStepSchema,
  type ProcedureKind,
} from "@/lib/domain/schema/procedure";

import { GUIDE_STATUSES, type GuideFrontmatter } from "./types";

/**
 * A guide slug: kebab-case, starting with its kind (`check-brakes-disc`).
 * Slugs are English in both locales and become a URL segment and a folder
 * name, so the pattern is also the path-traversal guard: no dot, no slash.
 */
export const GUIDE_SLUG_PATTERN = /^(check|replace|clean|adjust|measure)-[a-z0-9-]+$/;

/** Is `value` shaped like a guide slug? (Existence is a separate question.) */
export function isGuideSlug(value: unknown): value is string {
  return typeof value === "string" && value.length <= 64 && GUIDE_SLUG_PATTERN.test(value);
}

/** The kind a slug announces — its first segment. */
export function kindOfGuideSlug(slug: string): ProcedureKind | null {
  const kind = slug.slice(0, slug.indexOf("-"));
  return (PROCEDURE_KINDS as readonly string[]).includes(kind) ? (kind as ProcedureKind) : null;
}

const IdSchema = z.string().regex(ID_PATTERN).max(48);
const SlugSchema = z.string().max(64).regex(GUIDE_SLUG_PATTERN);

const frontmatterShape = {
  slug: SlugSchema,
  kind: z.enum(PROCEDURE_KINDS),
  title: z.string().trim().min(1).max(120),
  summary: z.string().trim().min(1).max(320),
  status: z.enum(GUIDE_STATUSES),
  order: z.int().min(0).max(999),
  partIds: z.array(IdSchema).min(1),
  tools: z.array(z.strictObject({ toolId: IdSchema, alternatives: z.array(IdSchema) })),
  appliesTo: SpecConditionSchema.optional(),
  difficulty: z.literal([1, 2, 3]),
  minutes: z.int().positive().max(600),
  steps: z.array(ProcedureStepSchema).min(1),
  related: z.array(SlugSchema),
  safety: z.array(z.string().trim().min(1).max(400)).min(1).optional(),
};

/** Document-level refinements shared by both parsers below. */
function refineFrontmatter(ctx: z.core.ParsePayload<GuideFrontmatter>): void {
  for (const message of checkProcedure(ctx.value)) {
    ctx.issues.push({ code: "custom", message, input: ctx.value });
  }
  if (ctx.value.slug.split("-")[0] !== ctx.value.kind) {
    ctx.issues.push({
      code: "custom",
      message: `slug "${ctx.value.slug}" must start with its kind "${ctx.value.kind}-"`,
      input: ctx.value,
      path: ["slug"],
    });
  }
}

/** The YAML block of a guide file. */
export const GuideFrontmatterSchema: z.ZodType<GuideFrontmatter> = z
  .strictObject(frontmatterShape)
  .check(refineFrontmatter);

/**
 * What content-collections validates: the frontmatter plus the raw MDX body it
 * adds as `content` before calling the schema.
 */
export const GuideSourceSchema: z.ZodType<GuideFrontmatter & { content: string }> = z
  .strictObject({ ...frontmatterShape, content: z.string() })
  .check(refineFrontmatter);
