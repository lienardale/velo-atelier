/**
 * `[id]` → `BikeRef` (§1.2) — the one place that decides what `/velo/<id>`
 * means.
 *
 *   demo    the read-only gravel preset anybody can open, and the bike the
 *           decision tree's "skip" link lands on. Editing it forks to `local`.
 *   local   the guest bike in `localStorage`. The server knows only that the
 *           visitor asked for it; the build arrives on the client (or, for a
 *           server-planned sub-route, through `?spec=`, §5.4).
 *   db      a saved bike, addressed by its UUID. Ownership is checked in
 *           `load-bike.ts`, and a bike that is not the caller's answers 404 —
 *           never 403, which would confirm that the id exists.
 *
 * Anything else — `/velo/not-a-uuid`, `/velo/../etc`, a v1 UUID, an id with a
 * trailing newline — is not a bike, and {@link resolveBikeRef} calls
 * `notFound()`. The parse is a hand-written regex rather than zod because this
 * module is imported by client components that build links, and by
 * `middleware`-adjacent code paths where a parser is dead weight.
 *
 * `demo` and `local` are reserved words: a UUID can never collide with them,
 * and nothing in the app ever writes a bike named `demo`.
 */
import { notFound } from "next/navigation";

/** The three kinds of bike a URL can address. */
export const BIKE_REF_KINDS = ["demo", "local", "db"] as const;

export type BikeRefKind = (typeof BIKE_REF_KINDS)[number];

export type BikeRef = { kind: "demo" } | { kind: "local" } | { kind: "db"; id: string };

/** The two ids that are words rather than UUIDs. */
export const GUEST_REF_IDS = ["demo", "local"] as const;

/**
 * RFC 9562 version 4, variant 1 — exactly what `crypto.randomUUID()` and
 * Postgres' `gen_random_uuid()` produce, lower-case. Accepting any UUID shape
 * would let `00000000-0000-0000-0000-000000000000` reach a query.
 */
export const UUID_V4_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

export function isBikeUuid(value: unknown): value is string {
  return typeof value === "string" && UUID_V4_PATTERN.test(value);
}

/** The ref an `[id]` segment names, or `null` when it names nothing. */
export function parseBikeRef(id: unknown): BikeRef | null {
  if (typeof id !== "string") return null;
  if (id === "demo") return { kind: "demo" };
  if (id === "local") return { kind: "local" };
  return isBikeUuid(id) ? { kind: "db", id } : null;
}

/** The `[id]` segment a ref is addressed by — the inverse of {@link parseBikeRef}. */
export function bikeRefParam(ref: BikeRef): string {
  return ref.kind === "db" ? ref.id : ref.kind;
}

/** Is this one of the two bikes that live in the browser rather than the database? */
export function isGuestRef(ref: BikeRef): ref is { kind: "demo" } | { kind: "local" } {
  return ref.kind !== "db";
}

/**
 * Same as {@link parseBikeRef}, but a URL that names no bike **is** a 404.
 *
 * Every `/velo/[id]/**` page starts with this line, so there is exactly one
 * definition of "this is not a bike" and no page can forget it.
 */
export function resolveBikeRef(id: unknown): BikeRef {
  const ref = parseBikeRef(id);
  if (ref === null) notFound();
  return ref;
}
