/**
 * Who may attach a Google account to an existing user while a session cookie is
 * present.
 *
 * Auth.js's OAuth callback links an incoming Google account to WHOEVER the request's
 * session cookie names — decoded with a plain `jwt.decode`, so no `sessionVersion`
 * check, no expiry of our own — whenever that Google account is not linked yet
 * (`@auth/core` `handleLoginOrRegister`). A stolen cookie, even one a password change
 * had already revoked, therefore let an attacker link THEIR OWN Google account to the
 * victim: permanent sign-in the owner cannot see or undo, and a fresh Google `authAt`
 * that satisfies the re-authentication gate (W1 security re-review, `.debug/003`).
 *
 * The `signIn` callback runs before that linking step, so it applies this table:
 *
 *   no session cookie (or one that does not decrypt)  → allow: ordinary sign-in /
 *                                                        sign-up; e-mail linking is
 *                                                        still gated on email_verified
 *   Google account already linked to the cookie's user → allow (re-authentication)
 *   Google account linked to someone else              → refuse
 *   Google account not linked, verified e-mail equals
 *     the cookie user's CURRENT e-mail (from the row)  → allow: it is provably the
 *                                                        owner's own Google account
 *   Google account not linked, any other e-mail        → refuse
 *
 * Plain Node: the lookups are injected so the table is testable without Auth.js.
 */
import { normalizeEmail } from "./tokens";

export interface GoogleLinkInput {
  /** Google's stable account id (`account.providerAccountId`). */
  providerAccountId: string;
  /** The e-mail Google verified (`email_verified` is checked before this runs). */
  profileEmail: string | null | undefined;
  /** The user id the request's session cookie names, or null when there is none it can decode. */
  sessionUserId: string | null;
}

export interface GoogleLinkLookups {
  /** The user a Google account is already linked to, or null. */
  linkedUserId(providerAccountId: string): Promise<string | null>;
  /** A user's current e-mail, or null when the row is gone. */
  userEmail(userId: string): Promise<string | null>;
}

export type GoogleLinkDecision = "allow" | "refuse";

export async function decideGoogleSignIn(
  { providerAccountId, profileEmail, sessionUserId }: GoogleLinkInput,
  lookups: GoogleLinkLookups,
): Promise<GoogleLinkDecision> {
  if (sessionUserId === null) return "allow";

  const linkedTo = await lookups.linkedUserId(providerAccountId);
  if (linkedTo !== null) return linkedTo === sessionUserId ? "allow" : "refuse";

  if (!profileEmail) return "refuse";
  const ownerEmail = await lookups.userEmail(sessionUserId);
  if (ownerEmail === null) return "refuse";
  return normalizeEmail(ownerEmail) === normalizeEmail(profileEmail) ? "allow" : "refuse";
}

/** The slice of Auth.js's `signIn` callback parameters this guard reads. */
export interface SignInParams {
  account?: { provider?: string; providerAccountId?: string } | null;
  profile?: { email?: unknown } | null;
}

export interface GuardedSignInDeps {
  /** authConfig's own check (Google `email_verified`), which must pass first. */
  baseSignIn: (params: SignInParams) => Promise<boolean | string> | boolean | string;
  /** The user id the request's session cookie names (decrypted only), or null. */
  sessionUserId: () => Promise<string | null>;
  lookups: GoogleLinkLookups;
  /** Where a refused Google sign-in is sent (the localized form with an error). */
  refusalUrl: () => Promise<string>;
}

/** The node-side `signIn` callback: authConfig's check, then the linking guard for Google. */
export function guardedSignIn(deps: GuardedSignInDeps) {
  return async (params: SignInParams): Promise<boolean | string> => {
    const base = await deps.baseSignIn(params);
    if (base !== true || params.account?.provider !== "google") return base;

    const decision = await decideGoogleSignIn(
      {
        providerAccountId: params.account.providerAccountId ?? "",
        profileEmail: typeof params.profile?.email === "string" ? params.profile.email : null,
        sessionUserId: await deps.sessionUserId(),
      },
      deps.lookups,
    );
    return decision === "allow" ? true : deps.refusalUrl();
  };
}
