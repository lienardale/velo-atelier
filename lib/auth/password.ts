/**
 * Password hashing.
 *
 * `bcryptjs` (pure JS, no native build) with the `$2b$` prefix, cost from
 * `BCRYPT_COST` (12 by default, 4 in the test environment so the suites are
 * not dominated by KDF time).
 *
 * **Plain Node — no `server-only`.** `prisma/seed.ts` and `scripts/**` import
 * this module, and `server-only` would make those crash outside a request
 * (tests/unit/no-server-only-in-scripts.test.ts walks that import graph).
 * The *policy* — length, character classes, common-list, zxcvbn score — lives
 * in `lib/auth/password-policy.ts`, which is `server-only`.
 *
 * bcrypt only reads the first 72 **bytes** of its input, so a longer password
 * would silently be equivalent to its prefix. Hashing therefore rejects those
 * rather than truncating; the policy schema rejects them earlier with a
 * user-facing message.
 */

import bcrypt from "bcryptjs";

import type { EnvSource } from "../env";

/** bcrypt's own input limit, in bytes (not characters). */
export const MAX_PASSWORD_BYTES = 72;

/** Cost used when `BCRYPT_COST` is unset or unusable. */
export const DEFAULT_BCRYPT_COST = 12;

const MIN_BCRYPT_COST = 4;
const MAX_BCRYPT_COST = 15;

/** `$2<variant>$<cost>$<22-char salt><31-char digest>` */
const BCRYPT_HASH = /^\$2[aby]\$(\d{2})\$[./A-Za-z0-9]{53}$/;

export class PasswordTooLongError extends Error {
  constructor(bytes: number) {
    super(`Password is ${bytes} bytes; bcrypt reads at most ${MAX_PASSWORD_BYTES}.`);
    this.name = "PasswordTooLongError";
  }
}

/** Length of a password as bcrypt sees it. */
export function passwordByteLength(password: string): number {
  return Buffer.byteLength(password, "utf8");
}

/** Effective work factor, clamped to a range where bcrypt is still bcrypt. */
export function bcryptCost(env: EnvSource = process.env): number {
  const raw = env.BCRYPT_COST?.trim();
  if (!raw) return DEFAULT_BCRYPT_COST;
  const parsed = Number.parseInt(raw, 10);
  if (!Number.isInteger(parsed)) return DEFAULT_BCRYPT_COST;
  return Math.min(MAX_BCRYPT_COST, Math.max(MIN_BCRYPT_COST, parsed));
}

/** Cost baked into an existing hash, or `undefined` if it is not a bcrypt hash. */
export function hashCost(hash: string): number | undefined {
  const match = BCRYPT_HASH.exec(hash);
  return match ? Number.parseInt(match[1], 10) : undefined;
}

/** Hash a password. Emits `$2b$<cost>$…`. */
export async function hashPassword(password: string, cost: number = bcryptCost()): Promise<string> {
  const bytes = passwordByteLength(password);
  if (bytes > MAX_PASSWORD_BYTES) throw new PasswordTooLongError(bytes);
  return bcrypt.hash(password, cost);
}

/**
 * Verify a password against a stored hash.
 *
 * `hash` may be `null`/`undefined`/garbage: an unknown email and a
 * Google-only account then cost the same wall-clock time as a wrong password,
 * so the response time leaks nothing about which case it was. The dummy hash
 * is compared for real — skipping it is exactly the timing side-channel this
 * is here to close.
 */
export async function verifyPassword(
  password: string,
  hash: string | null | undefined,
): Promise<boolean> {
  if (!hash || !BCRYPT_HASH.test(hash)) {
    await bcrypt.compare(password, dummyHash());
    return false;
  }
  return bcrypt.compare(password, hash);
}

/**
 * True when a valid hash should be replaced on the next successful sign-in:
 * wrong bcrypt variant (an imported `$2a$`), or a cost below the current one.
 * Never true for a stronger hash — nobody is downgraded.
 */
export function needsRehash(hash: string, cost: number = bcryptCost()): boolean {
  const current = hashCost(hash);
  if (current === undefined) return true;
  if (!hash.startsWith("$2b$")) return true;
  return current < cost;
}

/**
 * A real bcrypt hash of a value nobody can supply, generated once per process
 * at the environment's current cost, so the dummy compare takes as long as a
 * compare against a freshly written hash would.
 */
let dummy: string | undefined;
function dummyHash(): string {
  dummy ??= bcrypt.hashSync("velo-atelier:no-password-on-this-account", bcryptCost());
  return dummy;
}
