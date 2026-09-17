/**
 * THREAT — linking an attacker's Google account to a victim through a stolen (even
 * revoked) session cookie.
 *
 * Auth.js's OAuth callback links an unknown Google account to whoever the request's
 * session cookie names, decoding it without our sessionVersion check. With a stolen
 * cookie an attacker signs in with THEIR OWN Google account and gets permanent
 * access the owner cannot see or remove — and a fresh Google `authAt` that passes the
 * set-password re-authentication gate (W1 security re-review, .debug/003). The
 * `signIn` callback runs before that link and applies `decideGoogleSignIn`.
 *
 * CONTROLS PINNED
 *
 *   1. a session cookie + a Google account that is not linked and whose verified
 *      e-mail is not the user's → refused (the takeover);
 *   2. a session cookie + a Google account linked to ANOTHER user → refused;
 *   3. a session cookie + the user's own linked Google account → allowed (re-auth);
 *   4. a session cookie + an unlinked Google account with the user's own verified
 *      e-mail (case-insensitive, compared with the CURRENT row) → allowed;
 *   5. no session cookie → allowed (ordinary sign-in / sign-up);
 *   6. the user row is gone → refused.
 */
import { describe, expect, it, vi } from "vitest";

import {
  decideGoogleSignIn,
  guardedSignIn,
  type GoogleLinkLookups,
} from "@/lib/auth/oauth-link-guard";

/* eslint-disable security/detect-object-injection -- lookup tables keyed by fixture ids this file defines */
const VICTIM = "00000000-0000-4000-8000-00000000000a";
const OTHER = "00000000-0000-4000-8000-00000000000b";

function lookups(links: Record<string, string>, emails: Record<string, string>): GoogleLinkLookups {
  return {
    linkedUserId: vi.fn(async (providerAccountId: string) => links[providerAccountId] ?? null),
    userEmail: vi.fn(async (id: string) => emails[id] ?? null),
  };
}

describe("decideGoogleSignIn while a session cookie names a user", () => {
  it("refuses to link the attacker's own, unlinked Google account to the victim", async () => {
    await expect(
      decideGoogleSignIn(
        {
          providerAccountId: "g-attacker",
          profileEmail: "attacker@gmail.test",
          sessionUserId: VICTIM,
        },
        lookups({}, { [VICTIM]: "victim@velo-atelier.test" }),
      ),
    ).resolves.toBe("refuse");
  });

  it("refuses a Google account already linked to another user", async () => {
    await expect(
      decideGoogleSignIn(
        {
          providerAccountId: "g-other",
          profileEmail: "victim@velo-atelier.test",
          sessionUserId: VICTIM,
        },
        lookups({ "g-other": OTHER }, { [VICTIM]: "victim@velo-atelier.test" }),
      ),
    ).resolves.toBe("refuse");
  });

  it("allows the user's own linked Google account (re-authentication)", async () => {
    await expect(
      decideGoogleSignIn(
        {
          providerAccountId: "g-victim",
          profileEmail: "whatever@gmail.test",
          sessionUserId: VICTIM,
        },
        lookups({ "g-victim": VICTIM }, { [VICTIM]: "victim@velo-atelier.test" }),
      ),
    ).resolves.toBe("allow");
  });

  it("allows linking an unlinked Google account that proves the user's current e-mail", async () => {
    await expect(
      decideGoogleSignIn(
        {
          providerAccountId: "g-new",
          profileEmail: "Victim@Velo-Atelier.test",
          sessionUserId: VICTIM,
        },
        lookups({}, { [VICTIM]: "victim@velo-atelier.test" }),
      ),
    ).resolves.toBe("allow");
  });

  it("refuses when the e-mail is missing or the user row is gone", async () => {
    await expect(
      decideGoogleSignIn(
        { providerAccountId: "g-new", profileEmail: null, sessionUserId: VICTIM },
        lookups({}, { [VICTIM]: "victim@velo-atelier.test" }),
      ),
    ).resolves.toBe("refuse");
    await expect(
      decideGoogleSignIn(
        {
          providerAccountId: "g-new",
          profileEmail: "victim@velo-atelier.test",
          sessionUserId: VICTIM,
        },
        lookups({}, {}),
      ),
    ).resolves.toBe("refuse");
  });
});

describe("decideGoogleSignIn without a session cookie", () => {
  it("allows ordinary sign-in and sign-up, without touching the database", async () => {
    const deps = lookups({}, {});
    await expect(
      decideGoogleSignIn(
        { providerAccountId: "g-anyone", profileEmail: "a@gmail.test", sessionUserId: null },
        deps,
      ),
    ).resolves.toBe("allow");
    expect(deps.linkedUserId).not.toHaveBeenCalled();
  });
});

describe("guardedSignIn (the callback auth.ts installs)", () => {
  const REFUSAL = "/fr/connexion?error=OAuthAccountNotLinked";
  const google = (providerAccountId: string, email: string) => ({
    account: { provider: "google", providerAccountId },
    profile: { email, email_verified: true },
  });

  function callback(sessionUserId: string | null, base: boolean | string = true) {
    const deps = {
      baseSignIn: vi.fn(async () => base),
      sessionUserId: vi.fn(async () => sessionUserId),
      lookups: lookups({ "g-victim": VICTIM }, { [VICTIM]: "victim@velo-atelier.test" }),
      refusalUrl: vi.fn(async () => REFUSAL),
    };
    return { signIn: guardedSignIn(deps), deps };
  }

  it("sends the takeover attempt to the localized refusal URL, never linking", async () => {
    const { signIn, deps } = callback(VICTIM);
    await expect(signIn(google("g-attacker", "attacker@gmail.test"))).resolves.toBe(REFUSAL);
    expect(deps.lookups.linkedUserId).toHaveBeenCalledWith("g-attacker");
  });

  it("lets the owner's own linked Google account through", async () => {
    const { signIn } = callback(VICTIM);
    await expect(signIn(google("g-victim", "victim@velo-atelier.test"))).resolves.toBe(true);
  });

  it("keeps authConfig's verdict first: an unverified profile is refused before any lookup", async () => {
    const { signIn, deps } = callback(VICTIM, "/fr/connexion?error=OAuthAccountNotLinked");
    await expect(signIn(google("g-victim", "victim@velo-atelier.test"))).resolves.toBe(REFUSAL);
    expect(deps.sessionUserId).not.toHaveBeenCalled();
  });

  it("does not inspect credentials sign-ins", async () => {
    const { signIn, deps } = callback(VICTIM);
    await expect(
      signIn({ account: { provider: "credentials", providerAccountId: VICTIM }, profile: null }),
    ).resolves.toBe(true);
    expect(deps.lookups.linkedUserId).not.toHaveBeenCalled();
  });
});
