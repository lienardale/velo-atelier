/**
 * Read-side queries over one bike (§6.4) — "which guides apply to this part on
 * THIS bike", "how is the parts list grouped", "what is hosted under what".
 *
 * Pure functions over data the caller passes in. In particular `guidesFor`
 * takes the guide summaries as an argument instead of importing
 * `lib/content/collection.ts`: that module pulls the compiled MDX of all 47
 * guides in, and the parts panel is a client component. The server page reads
 * `GUIDES`, maps them with `toSummary`, and hands over the handful of fields
 * the panel actually renders.
 *
 * ## "Most specific `appliesTo`" (§6.4)
 *
 * A part can name several guides of the same kind — `replace-tube-tire` and
 * `replace-tire-tubeless` are both `replace` guides for `tire-front`. Only the
 * ones whose `appliesTo` matches this bike's spec are offered, and among those
 * the **most specific** comes first: a guide that says "tubeless only" beats
 * one that says nothing, because the author wrote that condition precisely to
 * be preferred when it holds. Specificity is the number of leaf conditions;
 * ties fall back to the catalogue's own order (`procedures[kind]`), which is
 * the author's.
 */
import { matchesSpec, conditionLeaves } from "@/lib/content/applies-to";
import type { GuideSummary } from "@/lib/content/types";
import { GEOMETRY_MEASURES, type GeometryMeasure } from "@/lib/domain/data/geometry-measures";
import { PARTS, partDefinition, type CatalogPart, type PartId } from "@/lib/domain/data/parts";
import { findPart } from "@/lib/domain/engine/parts-for-spec";
import type { BikeBuild, BikePart, PartSystem } from "@/lib/domain/schema/part";
import type { ProcedureKind } from "@/lib/domain/schema/procedure";

/**
 * The three fields of a guide the part panel needs. Deliberately a subset of
 * `GuideSummary`: the panel is a client component, and shipping whole summaries
 * (let alone compiled MDX) to the browser for 47 guides is not a link list.
 */
export type GuideRef = Pick<GuideSummary, "slug" | "title" | "appliesTo">;

/** The three actions the part panel offers, in the order it shows them. */
export const PART_ACTION_KINDS = ["replace", "clean", "adjust"] as const;

export type PartActionKind = (typeof PART_ACTION_KINDS)[number];

/** How specific a guide's `appliesTo` is: 0 for "applies to everything". */
export function conditionSpecificity(guide: Pick<GuideRef, "appliesTo">): number {
  return guide.appliesTo === undefined ? 0 : conditionLeaves(guide.appliesTo).length;
}

/**
 * The guides of `kind` that this bike's `partId` can use, most specific first.
 *
 * The candidate set comes from the part definition (`procedures[kind]`), never
 * from a scan of every guide: a guide that merely mentions the part in
 * `partIds` is not necessarily about it.
 */
export function guidesFor<T extends GuideRef>(
  guides: readonly T[],
  build: BikeBuild,
  partId: string,
  kind: ProcedureKind,
): T[] {
  const definition = partDefinition(partId);
  if (definition === undefined) return [];
  // eslint-disable-next-line security/detect-object-injection -- `kind` is a ProcedureKind literal
  const slugs = definition.procedures[kind] ?? [];
  if (slugs.length === 0) return [];

  const bySlug = new Map(guides.map((guide) => [guide.slug, guide]));
  return slugs
    .flatMap((slug, index) => {
      const guide = bySlug.get(slug);
      if (guide === undefined || !matchesSpec(guide.appliesTo, build.spec)) return [];
      return [{ guide, index }];
    })
    .sort(
      (left, right) =>
        conditionSpecificity(right.guide) - conditionSpecificity(left.guide) ||
        left.index - right.index,
    )
    .map((entry) => entry.guide);
}

/** The first guide `guidesFor` would offer, or `null`. */
export function bestGuideFor<T extends GuideRef>(
  guides: readonly T[],
  build: BikeBuild,
  partId: string,
  kind: ProcedureKind,
): T | null {
  return guidesFor(guides, build, partId, kind)[0] ?? null;
}

/** `{ replace, clean, adjust }` → the best guide for each, for one part's panel. */
export function partActionGuides<T extends GuideRef>(
  guides: readonly T[],
  build: BikeBuild,
  partId: string,
): Partial<Record<PartActionKind, T>> {
  const result: Partial<Record<PartActionKind, T>> = {};
  for (const kind of PART_ACTION_KINDS) {
    const guide = bestGuideFor(guides, build, partId, kind);
    // eslint-disable-next-line security/detect-object-injection -- `kind` is a PART_ACTION_KINDS literal
    if (guide) result[kind] = guide;
  }
  return result;
}

// ── The parts list (§6.4) ────────────────────────────────────────────────────

/** One row of the parts list: a rendered part, with the parts hosted on it. */
export interface PartRow {
  partId: PartId;
  definition: CatalogPart;
  part: BikePart;
  /** Parts with no mesh of their own (`hostPartId`), shown nested under this one. */
  hosted: PartRow[];
}

export interface PartGroup {
  system: PartSystem;
  rows: PartRow[];
}

/** Systems in the order the panel shows them — outside in, as a mechanic works. */
export const SYSTEM_ORDER: readonly PartSystem[] = [
  "frame",
  "wheels",
  "tires",
  "drivetrain",
  "brakes",
  "cockpit",
  "saddle",
  "pedals",
  "suspension",
  "e-system",
  "accessories",
];

function rowFor(part: BikePart): PartRow | null {
  const definition = partDefinition(part.partId);
  if (definition === undefined) return null;
  return { partId: definition.id, definition, part, hosted: [] };
}

/**
 * The bike's parts grouped by system, hosted parts nested under their host
 * (§6.4). A hosted part whose host is not on the bike is promoted to a row of
 * its own rather than disappearing — the checkup still has to be able to reach
 * it.
 */
export function partGroups(build: BikeBuild): PartGroup[] {
  const rows = build.parts.flatMap((part) => rowFor(part) ?? []);
  const byId = new Map(rows.map((row) => [row.partId as string, row]));

  const top: PartRow[] = [];
  for (const row of rows) {
    const host = row.definition.hostPartId;
    const hostRow = host === undefined ? undefined : byId.get(host);
    if (hostRow === undefined || hostRow === row) top.push(row);
    else hostRow.hosted.push(row);
  }

  const groups = new Map<PartSystem, PartRow[]>();
  for (const row of top) {
    const list = groups.get(row.definition.system);
    if (list) list.push(row);
    else groups.set(row.definition.system, [row]);
  }

  return SYSTEM_ORDER.flatMap((system) => {
    const list = groups.get(system);
    return list === undefined || list.length === 0 ? [] : [{ system, rows: list }];
  });
}

/** Every part id in a group, hosted ones included — what "select all" checks. */
export function partIdsOfGroup(group: PartGroup): PartId[] {
  return group.rows.flatMap((row) => [row.partId, ...row.hosted.map((child) => child.partId)]);
}

/** Is `partId` fitted to this bike? The 404 test of `/velo/[id]/piece/[partId]`. */
export function isPartOnBike(build: BikeBuild, partId: string): boolean {
  return findPart(build, partId) !== undefined;
}

/** The part row for `partId`, hosted or not, or `null`. */
export function findPartRow(build: BikeBuild, partId: string): PartRow | null {
  for (const group of partGroups(build)) {
    for (const row of group.rows) {
      if (row.partId === partId) return row;
      const hosted = row.hosted.find((child) => child.partId === partId);
      if (hosted) return hosted;
    }
  }
  return null;
}

// ── What the client needs, and no more ───────────────────────────────────────

/**
 * Every slug a part panel could possibly link to — for the whole catalogue when
 * `build` is `null` (a `local` bike, whose parts the server does not know), for
 * this bike's parts otherwise.
 *
 * The page passes the result to `BikeWorkspace`, which is how a client
 * component resolves "Changer / Nettoyer / Régler" without `content-collections`
 * (and its 47 compiled guides) anywhere near the browser bundle.
 */
export function actionGuideSlugs(build: BikeBuild | null): string[] {
  const definitions =
    build === null
      ? PARTS
      : build.parts.flatMap((part) => {
          const definition = partDefinition(part.partId);
          return definition === undefined ? [] : [definition];
        });
  const slugs = new Set<string>();
  for (const definition of definitions) {
    for (const kind of PART_ACTION_KINDS) {
      // eslint-disable-next-line security/detect-object-injection -- `kind` is a PART_ACTION_KINDS literal
      for (const slug of definition.procedures[kind] ?? []) slugs.add(slug);
    }
  }
  return [...slugs].sort();
}

/** Those slugs, as the `GuideRef`s the panel renders. */
export function actionGuideRefs<T extends GuideRef>(
  guides: readonly T[],
  build: BikeBuild | null,
): GuideRef[] {
  const wanted = new Set(actionGuideSlugs(build));
  return guides
    .filter((guide) => wanted.has(guide.slug))
    .map((guide) => ({
      slug: guide.slug,
      title: guide.title,
      ...(guide.appliesTo === undefined ? {} : { appliesTo: guide.appliesTo }),
    }));
}

// ── Fit measures (§5.6) ──────────────────────────────────────────────────────

/**
 * The measurements `/velo/[id]/reglages` offers for THIS bike.
 *
 * The rule is "at least one of the measure's parts is fitted", plus two
 * exceptions the parts alone cannot express:
 *
 *   sag             every bike has a `fork` part, rigid ones included, so the
 *                   suspension flags decide instead of the part list;
 *   cleat-position  every bike has pedals, but only clipless ones have cleats.
 *
 * Both are spec reads rather than extra parts, because inventing a
 * `suspension-fork` part to make a query tidy would change what the 3D viewer
 * draws.
 */
export function measuresForBuild(
  build: BikeBuild,
  measures: readonly GeometryMeasure[] = GEOMETRY_MEASURES,
): GeometryMeasure[] {
  const fitted = new Set(build.parts.map((part) => part.partId));
  const suspended = build.spec.suspension.front || build.spec.suspension.rear;
  const clipless = build.spec.pedals !== "flat" && build.spec.pedals !== "toe-clips";

  return measures.filter((measure) => {
    if (measure.id === "sag") return suspended;
    if (measure.id === "cleat-position") return clipless;
    return measure.partIds.some((partId) => fitted.has(partId));
  });
}
