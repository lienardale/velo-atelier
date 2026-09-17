/**
 * "Prove it again" for the one account change a stolen session must not be able
 * to make: giving a Google-only account a password.
 *
 * Without this, a cookie stolen from a Google-only visitor could set a password and
 * turn temporary access into permanent access the owner cannot revoke — changing a
 * password needs the current one, and the MVP has no reset flow (W1 security
 * review; decided with the user 2026-09-17, overriding plan §4's no-re-auth spec).
 *
 * The `jwt` callback stamps `authAt` / `authProvider` at sign-in. Setting a first
 * password requires a Google sign-in no older than `REAUTH_WINDOW_MS`; `/compte`
 * offers "Confirm with Google" (`prompt=login`) otherwise. Plain Node.
 */

/** How recent the Google sign-in must be. */
export const REAUTH_WINDOW_MS = 10 * 60_000;

export interface AuthStamp {
  authAt?: number;
  authProvider?: string;
}

/** Whether this session signed in with Google within the re-authentication window. */
export function hasFreshGoogleAuth(stamp: AuthStamp, now = Date.now()): boolean {
  if (stamp.authProvider !== "google" || typeof stamp.authAt !== "number") return false;
  const age = now - stamp.authAt;
  // A future stamp is clock skew at best and tampering at worst: not fresh.
  return age >= 0 && age <= REAUTH_WINDOW_MS;
}
