/**
 * Opaque keys and constant-time comparison.
 *
 * The only value this module produces that ever reaches storage is a rate-limit
 * bucket key. `AuthAttempt.key` is a SHA-256 hex digest of
 * `scope:ip:identifier`, so the table holds **no address and no e-mail** — a
 * dump of it says how often something was tried, never by whom. The digest is
 * salted with `AUTH_SECRET` so the mapping cannot be reversed by hashing a
 * candidate address offline.
 *
 * Plain Node (`node:crypto`): imported by `lib/auth/authorize.ts`, which is
 * itself imported by `auth.ts` and by tests. No `server-only`.
 */

import { createHash, randomBytes, timingSafeEqual } from "node:crypto";

/**
 * The secret mixed into every bucket key.
 *
 * Read lazily, per call: `tests/setup.ts` assigns `AUTH_SECRET` before the
 * suites run but module evaluation order is not something to depend on, and a
 * missing secret must not make rate limiting silently share one bucket — the
 * empty-string fallback still produces a stable, unique-per-input digest, it
 * just is not salted.
 */
function keySalt(): string {
  return process.env.AUTH_SECRET ?? "";
}

/**
 * Bucket key for a rate limit: `sha256(secret:scope:parts…)`, hex.
 *
 * Parts are lower-cased and joined with `:`. An absent part becomes an empty
 * segment, so `rateLimitKey('login', ip)` and `rateLimitKey('login', ip, '')`
 * are the same bucket — deliberately: "no e-mail given" is one case, not many.
 */
export function rateLimitKey(scope: string, ...parts: readonly (string | undefined)[]): string {
  const material = [keySalt(), scope, ...parts.map((part) => (part ?? "").toLowerCase())].join(":");
  return createHash("sha256").update(material, "utf8").digest("hex");
}

/** A URL-safe random token (used for nothing that is persisted today; kept for tokens issued later). */
export function randomToken(bytes = 32): string {
  return randomBytes(bytes).toString("base64url");
}

/**
 * Compare two strings without leaking where they first differ.
 *
 * Lengths are compared through the digests rather than up front, so a mismatch
 * in length costs the same as a mismatch in content.
 */
export function safeEqual(a: string, b: string): boolean {
  const digestA = createHash("sha256").update(a, "utf8").digest();
  const digestB = createHash("sha256").update(b, "utf8").digest();
  return timingSafeEqual(digestA, digestB);
}

/**
 * Canonical form of an e-mail address for lookups and bucket keys.
 *
 * `trim().toLowerCase()` only — no dot-stripping, no plus-address removal:
 * `a.b+test@gmail.com` is a different account from `ab@gmail.com` as far as
 * this application is concerned, and the database column is `citext`, which
 * applies exactly this rule.
 */
export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

/** The part of an address before the `@`, used as a zxcvbn user input. */
export function emailLocalPart(email: string): string {
  return normalizeEmail(email).split("@")[0] ?? "";
}
