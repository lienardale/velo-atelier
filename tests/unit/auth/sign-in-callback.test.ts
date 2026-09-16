/**
 * The `signIn`, `session` and `redirect` callbacks of `auth.config.ts` (§4.3).
 *
 * `signIn` is the single predicate that makes
 * `allowDangerousEmailAccountLinking: true` safe. With linking on, anyone who
 * can make Google hand out a profile carrying someone else's address takes over
 * that account — unless the address is one Google itself has verified. So
 * `email_verified === true` is required, `false` and `undefined` are equally
 * refused, and the refusal is a **URL** (the localized login page) rather than
 * `false`, which would drop the visitor on Auth.js's unprefixed error page.
 *
 * `tests/security/oauth-linking.test.ts` re-states the same three cases as a
 * security test; this file also covers the credentials path, the locale that
 * comes out of the cookie, and the two smaller callbacks next door.
 */
import { beforeEach, describe, expect, it } from "vitest";

import { authConfig, isEmailVerified, localeFromCookie } from "@/auth.config";
import { setRequestCookies } from "@/tests/_fakes/session";

const callbacks = authConfig.callbacks;

const GOOGLE = { provider: "google", providerAccountId: "1", type: "oidc" as const };
const USER = { id: "u1", email: "camille@velo-atelier.test" };

async function signIn(params: Record<string, unknown>) {
  return callbacks.signIn(params as unknown as Parameters<typeof callbacks.signIn>[0]);
}

describe("isEmailVerified", () => {
  it.each([
    [true, true],
    ["true", true],
    [false, false],
    ["false", false],
    [undefined, false],
    [null, false],
    [1, false],
  ])("%j → %s", (claim, expected) => {
    expect(isEmailVerified({ email_verified: claim })).toBe(expected);
  });

  it("is false for a profile that is not an object at all", () => {
    expect(isEmailVerified(undefined)).toBe(false);
    expect(isEmailVerified({})).toBe(false);
  });
});

describe("the signIn callback", () => {
  beforeEach(() => setRequestCookies({}));

  it("lets a verified Google profile through", async () => {
    await expect(
      signIn({ user: USER, account: GOOGLE, profile: { email_verified: true } }),
    ).resolves.toBe(true);
  });

  it("refuses an unverified Google profile with the localized login URL", async () => {
    await expect(
      signIn({ user: USER, account: GOOGLE, profile: { email_verified: false } }),
    ).resolves.toBe("/fr/connexion?error=OAuthAccountNotLinked");
  });

  it("refuses a Google profile with no email_verified claim at all", async () => {
    await expect(
      signIn({ user: USER, account: GOOGLE, profile: { email: USER.email } }),
    ).resolves.toBe("/fr/connexion?error=OAuthAccountNotLinked");
  });

  it("uses the NEXT_LOCALE cookie for the refusal URL", async () => {
    setRequestCookies({ NEXT_LOCALE: "en" });
    await expect(
      signIn({ user: USER, account: GOOGLE, profile: { email_verified: false } }),
    ).resolves.toBe("/en/sign-in?error=OAuthAccountNotLinked");
  });

  it("falls back to French for a nonsense cookie", async () => {
    setRequestCookies({ NEXT_LOCALE: "../de" });
    await expect(
      signIn({ user: USER, account: GOOGLE, profile: { email_verified: false } }),
    ).resolves.toBe("/fr/connexion?error=OAuthAccountNotLinked");
  });

  it("does not inspect a credentials sign-in — authorize() already decided", async () => {
    await expect(
      signIn({ user: USER, account: { ...GOOGLE, provider: "credentials" } }),
    ).resolves.toBe(true);
    await expect(signIn({ user: USER, account: null })).resolves.toBe(true);
  });
});

describe("localeFromCookie", () => {
  it.each([
    ["fr", "fr"],
    ["en", "en"],
    ["de", "fr"],
    ["", "fr"],
    [undefined, "fr"],
    [null, "fr"],
  ])("%j → %s", (value, expected) => {
    expect(localeFromCookie(value)).toBe(expected);
  });
});

describe("the session callback", () => {
  it("copies id and locale off the token", () => {
    const session = callbacks.session({
      session: { user: { email: USER.email }, expires: "" },
      token: { id: "u1", locale: "en" },
    } as unknown as Parameters<typeof callbacks.session>[0]);

    expect(session).toMatchObject({ user: { id: "u1", locale: "en" } });
  });

  it("falls back to `sub` and to the default locale", () => {
    const session = callbacks.session({
      session: { user: { email: USER.email }, expires: "" },
      token: { sub: "u2" },
    } as unknown as Parameters<typeof callbacks.session>[0]);

    expect(session).toMatchObject({ user: { id: "u2", locale: "fr" } });
  });

  it("leaves a session with no user alone", () => {
    const session = callbacks.session({
      session: { expires: "" },
      token: { id: "u1" },
    } as unknown as Parameters<typeof callbacks.session>[0]);
    expect(session).toEqual({ expires: "" });
  });
});

describe("the redirect callback", () => {
  const baseUrl = "http://localhost:3100";
  const redirect = (url: string) => callbacks.redirect({ url, baseUrl });

  it("resolves a relative path against our own origin", () => {
    expect(redirect("/fr/mes-velos")).toBe(`${baseUrl}/fr/mes-velos`);
  });

  it("keeps an absolute URL on our own origin", () => {
    expect(redirect(`${baseUrl}/en/account`)).toBe(`${baseUrl}/en/account`);
  });

  it.each([
    ["another origin", "https://evil.example/fr"],
    ["protocol-relative", "//evil.example"],
    ["not a URL at all", "not a url"],
  ])("sends %s back to the base URL", (_label, url) => {
    expect(redirect(url)).toBe(baseUrl);
  });
});

describe("the configuration itself", () => {
  it("uses JWT sessions for 30 days", () => {
    expect(authConfig.session).toEqual({
      strategy: "jwt",
      maxAge: 30 * 24 * 3600,
      updateAge: 24 * 3600,
    });
  });

  it("points both pages at the UNPREFIXED login path (proxy.ts re-prefixes)", () => {
    expect(authConfig.pages).toEqual({ signIn: "/connexion", error: "/connexion" });
  });

  // Verified against next-auth 5.0.0-beta.32 / @auth/core: a provider factory
  // returns `{ id, name, type, issuer, style, options }` — the arguments the
  // caller passed stay under `options` until Auth.js merges them at request
  // time, so that is where the assertion has to look.
  const google = authConfig.providers[0] as unknown as {
    id: string;
    options: {
      allowDangerousEmailAccountLinking?: boolean;
      profile: (raw: Record<string, unknown>) => Record<string, unknown>;
    };
  };

  it("enables e-mail account linking — the signIn callback is what makes it safe", () => {
    expect(google.id).toBe("google");
    expect(google.options.allowDangerousEmailAccountLinking).toBe(true);
  });

  it("maps a Google profile onto our own user shape", () => {
    expect(
      google.options.profile({
        sub: "g1",
        name: "Camille",
        email: "camille@velo-atelier.test",
        picture: "https://lh3.googleusercontent.com/x",
      }),
    ).toEqual({
      id: "g1",
      name: "Camille",
      email: "camille@velo-atelier.test",
      image: "https://lh3.googleusercontent.com/x",
    });
  });
});
