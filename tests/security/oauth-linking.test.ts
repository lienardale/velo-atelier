/**
 * THREAT — Account takeover through OAuth e-mail linking.
 *
 * `allowDangerousEmailAccountLinking: true` is set on the Google provider
 * (auth.config.ts). It is named "dangerous" for a real reason: it tells Auth.js
 * to attach an OAuth sign-in to any existing account with the same address. If
 * the provider hands out addresses it has not verified, anybody who can claim
 * `camille@velo-atelier.test` at that provider owns Camille's account here.
 *
 * It is switched on because the alternative is worse in practice — a visitor
 * who signed up with a password and later clicks "Continue with Google" must
 * land on their own account, not a silent duplicate they cannot reach.
 *
 * THE CONTROL that makes it safe is the `signIn` callback: a Google profile
 * without `email_verified === true` never gets through. This file is the test
 * for that one predicate and that one callback, which is the only thing
 * standing between the flag and a takeover.
 *
 * CONTROLS PINNED
 *
 *   1. `email_verified: true` (and the string `"true"`, which some providers
 *      send) is accepted; `false`, `undefined`, `null`, `0`, `"1"`, `"yes"` and
 *      an absent profile are all refused;
 *   2. a refusal returns the **localized login URL** with
 *      `?error=OAuthAccountNotLinked`, never `false` — `false` would send the
 *      visitor to Auth.js's unprefixed page, losing the locale;
 *   3. the locale comes from the `NEXT_LOCALE` cookie, because an OAuth
 *      callback carries none;
 *   4. the Credentials provider is not inspected by this callback — it has
 *      already been decided by `authorizeCredentials`;
 *   5. Google is the ONLY OAuth provider configured. A second one would need
 *      its own verified-address story, so its arrival must fail a test.
 */
import { beforeEach, describe, expect, it } from "vitest";

import { authConfig, isEmailVerified, localeFromCookie, LOCALE_COOKIE } from "@/auth.config";
import { setRequestCookies } from "@/tests/_fakes/session";

type SignInCallback = NonNullable<(typeof authConfig)["callbacks"]["signIn"]>;
type SignInParams = Parameters<SignInCallback>[0];

const signIn = authConfig.callbacks.signIn as (params: unknown) => Promise<boolean | string>;

const googleAccount = { provider: "google", providerAccountId: "1", type: "oidc" };

function call(profile: unknown, provider = "google"): Promise<boolean | string> {
  return signIn({
    user: { id: "1", email: "camille@velo-atelier.test" },
    account: { ...googleAccount, provider },
    profile,
  } as unknown as SignInParams);
}

beforeEach(() => {
  setRequestCookies({});
});

describe("isEmailVerified", () => {
  it("accepts only a real affirmative", () => {
    expect(isEmailVerified({ email_verified: true })).toBe(true);
    // Some OIDC providers serialise the claim as a string.
    expect(isEmailVerified({ email_verified: "true" })).toBe(true);
  });

  it.each([
    ["false", { email_verified: false }],
    ["the string false", { email_verified: "false" }],
    ["absent", {}],
    ["null", { email_verified: null }],
    ["the number 1", { email_verified: 1 }],
    ["the string 1", { email_verified: "1" }],
    ["yes", { email_verified: "yes" }],
    ["TRUE in caps", { email_verified: "TRUE" }],
    ["an object", { email_verified: {} }],
    ["no profile at all", undefined],
    ["null profile", null],
  ])("refuses %s", (_label, profile) => {
    expect(isEmailVerified(profile)).toBe(false);
  });
});

describe("the signIn callback", () => {
  it("lets a verified Google profile through", async () => {
    await expect(call({ email_verified: true })).resolves.toBe(true);
  });

  it("refuses an unverified one with the French login URL and the right error", async () => {
    await expect(call({ email_verified: false })).resolves.toBe(
      "/fr/connexion?error=OAuthAccountNotLinked",
    );
  });

  it("refuses one with no claim at all", async () => {
    await expect(call({})).resolves.toBe("/fr/connexion?error=OAuthAccountNotLinked");
  });

  it("speaks the visitor's language, read from the NEXT_LOCALE cookie", async () => {
    setRequestCookies({ [LOCALE_COOKIE]: "en" });

    await expect(call({ email_verified: false })).resolves.toBe(
      "/en/sign-in?error=OAuthAccountNotLinked",
    );
  });

  it("falls back to French for a cookie that is not a locale", async () => {
    setRequestCookies({ [LOCALE_COOKIE]: "de-DE" });

    await expect(call({ email_verified: false })).resolves.toBe(
      "/fr/connexion?error=OAuthAccountNotLinked",
    );
    expect(localeFromCookie("de-DE")).toBe("fr");
  });

  it("NEVER returns false — that loses the locale and the localized path", async () => {
    for (const profile of [{ email_verified: false }, {}, null, undefined]) {
      const result = await call(profile);
      expect(result).not.toBe(false);
      expect(typeof result === "string" || result === true).toBe(true);
    }
  });

  it("does not inspect a credentials sign-in", async () => {
    // `authorizeCredentials` has already decided; a missing `email_verified`
    // on a password sign-in must not refuse it.
    await expect(call({}, "credentials")).resolves.toBe(true);
  });
});

describe("the provider list", () => {
  it("configures Google, and only Google", () => {
    const ids = authConfig.providers.map((provider) =>
      typeof provider === "function" ? "fn" : provider.id,
    );
    expect(ids).toEqual(["google"]);
  });

  it("keeps the dangerous flag paired with the callback that makes it safe", () => {
    const google = authConfig.providers[0] as unknown as {
      options?: { allowDangerousEmailAccountLinking?: boolean };
      allowDangerousEmailAccountLinking?: boolean;
    };
    const flag =
      google.allowDangerousEmailAccountLinking ?? google.options?.allowDangerousEmailAccountLinking;
    expect(flag).toBe(true);
    expect(typeof authConfig.callbacks.signIn).toBe("function");
  });

  it("maps the profile to our own fields, so nothing extra is trusted", () => {
    // next-auth 5 beta keeps a provider's user-supplied overrides under
    // `options`; the merge into the top-level object happens at request time.
    const google = authConfig.providers[0] as unknown as {
      profile?: (profile: Record<string, unknown>) => Record<string, unknown>;
      options?: { profile?: (profile: Record<string, unknown>) => Record<string, unknown> };
    };
    const profile = google.profile ?? google.options?.profile;
    expect(profile).toBeTypeOf("function");

    const mapped = profile?.({
      sub: "google-123",
      name: "Camille",
      email: "camille@velo-atelier.test",
      picture: "https://lh3.googleusercontent.com/a",
      // Fields Google may add tomorrow, which must not reach the adapter.
      hd: "evil.test",
      email_verified: true,
      locale: "de",
    });

    expect(mapped).toEqual({
      id: "google-123",
      name: "Camille",
      email: "camille@velo-atelier.test",
      image: "https://lh3.googleusercontent.com/a",
    });
  });
});
