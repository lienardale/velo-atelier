/**
 * Prisma error narrowing.
 *
 * Server actions turn expected database failures into an `ActionResult` code
 * instead of throwing (§4.4), so the two cases they actually branch on get a
 * predicate each.
 *
 * Structural checks rather than `instanceof PrismaClientKnownRequestError`:
 * the generated client is re-emitted on every `prisma generate`, and an
 * `instanceof` against a stale copy of the class silently returns `false`.
 * The wire contract (`code`, `meta.target`) is stable across Prisma majors.
 */

export interface KnownPrismaError {
  code: string;
  meta?: { target?: unknown };
}

/** Any Prisma "known request error" (`P____`). */
export function isKnownPrismaError(error: unknown): error is KnownPrismaError {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    typeof (error as { code: unknown }).code === "string" &&
    /^P\d{4}$/.test((error as { code: string }).code)
  );
}

/** Columns named by a P2002 unique-constraint violation, lowercased. */
export function uniqueViolationTargets(error: unknown): string[] {
  if (!isKnownPrismaError(error) || error.code !== "P2002") return [];
  const target = error.meta?.target;
  if (Array.isArray(target)) return target.filter((t) => typeof t === "string").map(lower);
  if (typeof target === "string") return [lower(target)];
  return [];
}

function lower(value: string): string {
  return value.toLowerCase();
}

/**
 * P2002 — unique constraint violated.
 *
 * With `field`, also requires that column to be named by the constraint, so
 * `signUpAction` can answer `errors.emailTaken` for the email index without
 * mistaking an unrelated unique index for the same thing.
 */
export function isUniqueViolation(error: unknown, field?: string): boolean {
  if (!isKnownPrismaError(error) || error.code !== "P2002") return false;
  if (field === undefined) return true;
  return uniqueViolationTargets(error).some((target) => target.includes(field.toLowerCase()));
}

/** P2025 — "an operation failed because it depends on records that were required but not found". */
export function isNotFoundError(error: unknown): boolean {
  return isKnownPrismaError(error) && error.code === "P2025";
}
