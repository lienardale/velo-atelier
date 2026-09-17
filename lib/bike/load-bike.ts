/**
 * What `/velo/[id]` and its sub-routes read before they render (§6.2).
 *
 * One function, three branches, and the branch is the whole point:
 *
 *   demo   a preset. No request APIs at all — no `auth()`, no `cookies()`, no
 *          `headers()` — which is what lets `/[locale]/velo/demo` prerender
 *          (`●` in the build output, §6.8 AC2). Adding a request read anywhere
 *          on this path silently turns the page dynamic.
 *   local  the server genuinely does not know. It returns `build: null` and the
 *          page hydrates from `va:bike:local`; a server-planned sub-route gets
 *          the bike from `?spec=` instead (§5.4), which is why `specCode` is an
 *          option here rather than a second loader.
 *   db     `getUser()` — and ONLY here — then a query that carries the owner in
 *          its `where`. A bike that is not the caller's produces no row, and no
 *          row is `notFound()`: 404, never 403 (§4.7).
 *
 * ## Query budget
 *
 * Two queries, whatever the bike: the bike with its part states, and the
 * checkup to resume. `tests/unit/bike/load-bike.test.ts` counts them against
 * the ≤ 3 budget of §7.3 with the recording fake, so an `include` that turns
 * into a loop fails the build rather than the production database.
 *
 * Server-side only: in the `db` branch `getUser` defaults to `currentUser()`,
 * which imports `server-only`, and the Prisma client is imported there too —
 * both with a dynamic `import()`, so neither is in the module graph of the demo
 * and local branches. Never import this module from a client component: the
 * panel receives the loaded bike as props.
 */
import { notFound } from "next/navigation";

import { BIKE_PRESETS, DEMO_PRESET_ID } from "@/lib/domain/data/presets";
import { validateBuild } from "@/lib/domain/engine/validate-build";
import type { Answers } from "@/lib/domain/schema/decision";
import type { BikeBuild } from "@/lib/domain/schema/part";

import { decodeAnswers } from "./spec-codec";
import { bikeRefParam, type BikeRef } from "./resolve-bike-ref";
import { coerceFit, deriveBike, type BikeFit } from "./rules";

/** Part status as the panel shows it — the Prisma enum, kept as a plain union. */
export type PartStatusValue = "OK" | "ATTENTION" | "BROKEN" | "UNKNOWN";

export interface ResumableCheckup {
  id: string;
  scope: "FULL" | "PARTIAL";
  startedAt: string;
  /** How many steps already have a verdict — the banner shows "3/12". */
  answered: number;
}

export interface LoadedBike {
  ref: BikeRef;
  /** The `[id]` segment this bike is addressed by (`demo`, `local`, or the UUID). */
  param: string;
  /** The row id, for the actions. `null` for `demo` and `local`. */
  bikeId: string | null;
  /** The owner's name for the bike; `null` means "use the localized default". */
  name: string | null;
  /** `null` for a `local` bike the server could not resolve — the client hydrates. */
  answers: Answers | null;
  build: BikeBuild | null;
  fit: BikeFit;
  /** Per-part status from `BikePartState`; empty for guest bikes. */
  statuses: Partial<Record<string, PartStatusValue>>;
  /** `false` for the demo bike: edits fork to a local copy instead. */
  canEdit: boolean;
  resume: ResumableCheckup | null;
  updatedAt: string | null;
}

/** The slice of the Prisma client this loader uses — the fake implements it too. */
export interface BikeLoaderPrisma {
  bike: {
    findFirst(args: unknown): Promise<unknown>;
  };
  checkup: {
    findFirst(args: unknown): Promise<unknown>;
  };
}

export interface LoadBikeOptions {
  /** `?spec=` for a `local` bike on a server-planned route (§5.4). */
  specCode?: unknown;
  /** Called ONLY in the `db` branch. */
  getUser?: () => Promise<{ id: string } | null>;
  prisma?: BikeLoaderPrisma;
  /** `notFound()` by default; the tests pass a throw they can catch. */
  onMissing?: () => never;
}

/** The demo bike: the gravel preset, read-only, identical for everyone. */
export function loadDemoBike(): LoadedBike {
  const derived = deriveBike(BIKE_PRESETS[DEMO_PRESET_ID]);
  return {
    ref: { kind: "demo" },
    param: "demo",
    bikeId: null,
    name: null,
    answers: derived.answers,
    build: { spec: derived.spec, parts: derived.parts },
    fit: {},
    statuses: {},
    canEdit: false,
    resume: null,
    updatedAt: null,
  };
}

/**
 * The guest bike, as much of it as the server can know: the answers carried by
 * `?spec=` when there are any, nothing otherwise.
 */
export function loadLocalBike(specCode?: unknown): LoadedBike {
  const answers = specCode === undefined ? null : decodeAnswers(specCode);
  const derived = answers === null ? null : deriveBike(answers);
  return {
    ref: { kind: "local" },
    param: "local",
    bikeId: null,
    name: null,
    answers: derived?.answers ?? null,
    build: derived === null ? null : { spec: derived.spec, parts: derived.parts },
    fit: {},
    statuses: {},
    canEdit: true,
    resume: null,
    updatedAt: null,
  };
}

interface BikeRow {
  id: string;
  name: string;
  answers: unknown;
  spec: unknown;
  parts: unknown;
  fit: unknown;
  updatedAt: Date;
  partStates: { partId: string; status: PartStatusValue }[];
}

interface CheckupRow {
  id: string;
  scope: "FULL" | "PARTIAL";
  startedAt: Date;
  _count?: { items: number };
  items?: { id: string }[];
}

/**
 * Re-derive the build from the stored answers, falling back to the stored
 * `parts` only when the answers cannot produce a valid build.
 *
 * `answers` is the source of truth (§1.2), so a `spec`/`parts` pair written by
 * an older release is a *cache*, not an authority: recomputing is how a bike
 * saved before a taxonomy change opens at all. The stored attribute edits are
 * carried across by `deriveBike`.
 */
export function buildFromRow(row: Pick<BikeRow, "answers" | "parts">): {
  answers: Answers;
  build: BikeBuild;
} | null {
  const answers = row.answers;
  if (typeof answers !== "object" || answers === null || Array.isArray(answers)) return null;
  const stored = validateBuildParts(row.parts);
  const derived = deriveBike(answers as Answers, stored);
  return { answers: derived.answers, build: { spec: derived.spec, parts: derived.parts } };
}

/** The stored parts, when they still parse as parts at all; `undefined` otherwise. */
function validateBuildParts(parts: unknown): BikeBuild["parts"] | undefined {
  if (!Array.isArray(parts)) return undefined;
  const usable = parts.filter(
    (part): part is { partId: string; attributes: Record<string, never> } =>
      typeof part === "object" &&
      part !== null &&
      typeof (part as { partId?: unknown }).partId === "string",
  );
  return usable.length > 0 ? (usable as unknown as BikeBuild["parts"]) : undefined;
}

/**
 * The bike a request is about.
 *
 * Throws Next's `notFound()` for a `db` id that is not the caller's — which is
 * also what an anonymous visitor gets, so the 404 says nothing about whether
 * the bike exists.
 */
export async function loadBikeForRequest(
  ref: BikeRef,
  options: LoadBikeOptions = {},
): Promise<LoadedBike> {
  if (ref.kind === "demo") return loadDemoBike();
  if (ref.kind === "local") return loadLocalBike(options.specCode);

  const missing = options.onMissing ?? notFound;
  // `/velo/[id]` enumerates `demo` in `generateStaticParams`, so Next renders a
  // param it does not know (a UUID) in its ON-DEMAND static mode — where reading
  // the session would be `DYNAMIC_SERVER_USAGE`, a 500. `connection()` says "this
  // particular render belongs to one request", which is exactly true here and
  // nowhere else on this route. Skipped entirely when the caller injects its own
  // `getUser` (the tests), which is also what keeps it out of the demo branch.
  if (options.getUser === undefined) {
    const { connection } = await import("next/server");
    await connection();
  }
  const getUser =
    options.getUser ?? (async () => (await import("@/lib/actions/with-user")).currentUser());
  const db =
    options.prisma ?? ((await import("@/lib/db/prisma")).prisma as unknown as BikeLoaderPrisma);

  const user = await getUser();
  if (!user) return missing();

  const row = (await db.bike.findFirst({
    // The ownership predicate is IN the query: a foreign id simply finds nothing.
    where: { id: ref.id, userId: user.id },
    select: {
      id: true,
      name: true,
      answers: true,
      spec: true,
      parts: true,
      fit: true,
      updatedAt: true,
      partStates: { select: { partId: true, status: true } },
    },
  })) as BikeRow | null;
  if (row === null) return missing();

  const resolved = buildFromRow(row);
  if (resolved === null) return missing();

  const checkup = (await db.checkup.findFirst({
    where: { bikeId: row.id, status: "IN_PROGRESS", bike: { userId: user.id } },
    orderBy: { startedAt: "desc" },
    select: { id: true, scope: true, startedAt: true, items: { select: { id: true } } },
  })) as CheckupRow | null;

  return {
    ref,
    param: bikeRefParam(ref),
    bikeId: row.id,
    name: row.name,
    answers: resolved.answers,
    build: resolved.build,
    fit: coerceFit(row.fit),
    statuses: Object.fromEntries(
      (row.partStates ?? []).map((state) => [state.partId, state.status]),
    ),
    canEdit: true,
    resume:
      checkup === null
        ? null
        : {
            id: checkup.id,
            scope: checkup.scope,
            startedAt: new Date(checkup.startedAt).toISOString(),
            answered: checkup._count?.items ?? checkup.items?.length ?? 0,
          },
    updatedAt: new Date(row.updatedAt).toISOString(),
  };
}

/** `validateBuild` on a `{ spec, parts }` pair — re-exported so pages need one import. */
export { validateBuild };
