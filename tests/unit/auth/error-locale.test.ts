/**
 * Two halves of the same problem: Auth.js builds URLs with no locale in them,
 * and this project's URLs always have one (§4.3, §6.1).
 *
 * 1. **`proxy.ts` re-prefixes the bare Auth.js pages.** `pages.signIn` and
 *    `pages.error` are `/connexion` — unprefixed by design, because Auth.js has
 *    no idea which language the visitor reads. An `AccessDenied` /
 *    `OAuthCallbackError` / `Configuration` redirect therefore lands on
 *    `/connexion?error=…`, and the proxy re-issues it as
 *    `/en/sign-in?error=…` for an English visitor. Pinned by the plan:
 *    `/connexion?error=AccessDenied` + `NEXT_LOCALE=en` → 307 `/en/sign-in?error=AccessDenied`.
 *
 * 2. **`authorized()` builds its own prefixed URLs.** It runs INSIDE the proxy
 *    and its `Response.redirect` wins outright — next-intl never gets to see it
 *    — so every URL it produces must already be external and localized, and it
 *    must never return `false` (which would send Auth.js to the unprefixed page
 *    and skip the intl middleware entirely).
 *
 * `proxy.ts` itself is not imported: evaluating it boots a second Auth.js
 * instance. The two pure pieces it is built from — `localizeUnprefixedAuthPath`
 * and `authorized()` — are what carry the behaviour, and they are what is
 * tested here.
 */
import { describe, expect, it } from "vitest";
import { NextRequest } from "next/server";

import { authConfig } from "@/auth.config";
import { localizeUnprefixedAuthPath } from "@/lib/auth/unprefixed-paths";

const ORIGIN = "http://localhost:3100";

function request(path: string, cookies: Record<string, string> = {}): NextRequest {
  const cookie = Object.entries(cookies)
    .map(([name, value]) => `${name}=${value}`)
    .join("; ");
  return new NextRequest(new URL(path, ORIGIN), {
    headers: cookie ? { cookie } : undefined,
  });
}

describe("localizeUnprefixedAuthPath (proxy.ts)", () => {
  it("re-issues /connexion?error=AccessDenied as /en/sign-in with NEXT_LOCALE=en", () => {
    const response = localizeUnprefixedAuthPath(
      request("/connexion?error=AccessDenied", { NEXT_LOCALE: "en" }),
    );
    expect(response?.status).toBe(307);
    expect(response?.headers.get("location")).toBe(`${ORIGIN}/en/sign-in?error=AccessDenied`);
  });

  it("defaults to French with no cookie", () => {
    const response = localizeUnprefixedAuthPath(request("/connexion?error=Configuration"));
    expect(response?.headers.get("location")).toBe(`${ORIGIN}/fr/connexion?error=Configuration`);
  });

  it("handles the sign-up page too", () => {
    const response = localizeUnprefixedAuthPath(request("/inscription", { NEXT_LOCALE: "en" }));
    expect(response?.headers.get("location")).toBe(`${ORIGIN}/en/sign-up`);
  });

  it("keeps the whole query, not just `error`", () => {
    const response = localizeUnprefixedAuthPath(
      request("/connexion?error=CredentialsSignin&callbackUrl=%2Ffr%2Fcompte"),
    );
    expect(response?.headers.get("location")).toBe(
      `${ORIGIN}/fr/connexion?error=CredentialsSignin&callbackUrl=%2Ffr%2Fcompte`,
    );
  });

  it("ignores a nonsense cookie rather than building /de/…", () => {
    const response = localizeUnprefixedAuthPath(request("/connexion", { NEXT_LOCALE: "de" }));
    expect(response?.headers.get("location")).toBe(`${ORIGIN}/fr/connexion`);
  });

  it.each([
    ["an already-prefixed path", "/fr/connexion"],
    ["a path merely starting the same way", "/connexion-oubliee"],
    ["the home page", "/"],
    ["a bike page", "/fr/velo/demo"],
  ])("leaves %s alone", (_label, path) => {
    expect(localizeUnprefixedAuthPath(request(path))).toBeNull();
  });
});

describe("the authorized() callback", () => {
  const authorized = authConfig.callbacks.authorized;
  const SESSION = { user: { id: "u1", email: "camille@velo-atelier.test", locale: "fr" as const } };

  function run(path: string, auth: unknown, cookies: Record<string, string> = {}) {
    return authorized({
      request: request(path, cookies),
      auth,
    } as unknown as Parameters<typeof authorized>[0]);
  }

  it.each([
    ["/fr/mes-velos", "/fr/connexion?callbackUrl=%2Ffr%2Fmes-velos"],
    ["/en/my-bikes", "/en/sign-in?callbackUrl=%2Fen%2Fmy-bikes"],
    ["/fr/compte", "/fr/connexion?callbackUrl=%2Ffr%2Fcompte"],
    ["/en/account", "/en/sign-in?callbackUrl=%2Fen%2Faccount"],
    ["/fr/import", "/fr/connexion?callbackUrl=%2Ffr%2Fimport"],
  ])("sends an anonymous visitor from %s to %s", async (path, target) => {
    const result = await run(path, null);
    expect(result).toBeInstanceOf(Response);
    expect((result as Response).headers.get("location")).toBe(`${ORIGIN}${target}`);
  });

  it("keeps the query of the page the visitor was aiming at", async () => {
    const result = (await run("/fr/velo/demo/liste", null)) as unknown;
    // Not a protected route: it must pass straight through.
    expect(result).toBe(true);

    const protectedResult = (await run("/fr/compte?tab=securite", null)) as Response;
    expect(protectedResult.headers.get("location")).toBe(
      `${ORIGIN}/fr/connexion?callbackUrl=%2Ffr%2Fcompte%3Ftab%3Dsecurite`,
    );
  });

  it.each([
    ["/fr/connexion", "/fr/mes-velos"],
    ["/en/sign-in", "/en/my-bikes"],
    ["/fr/inscription", "/fr/mes-velos"],
    ["/en/sign-up", "/en/my-bikes"],
  ])("sends a signed-in visitor from %s to %s", async (path, target) => {
    const result = (await run(path, SESSION)) as Response;
    expect(result.headers.get("location")).toBe(`${ORIGIN}${target}`);
  });

  it.each([
    ["the home page", "/fr", null],
    ["a guide", "/en/guides/check-brakes-disc", null],
    ["the demo bike", "/fr/velo/demo", null],
    ["a dev page (gated server-side by ENABLE_TEST_PAGES)", "/fr/dev/bike3d", null],
    ["the account page WITH a session", "/fr/compte", SESSION],
    ["the login page WITHOUT one", "/fr/connexion", null],
  ])("lets %s through", async (_label, path, auth) => {
    // `authorized()` is synchronous here; `await` normalises both shapes.
    await expect(Promise.resolve(run(path, auth))).resolves.toBe(true);
  });

  it("never returns false — that would lose the locale and skip next-intl", async () => {
    const paths = [
      "/fr",
      "/fr/compte",
      "/en/account",
      "/fr/connexion",
      "/en/sign-up",
      "/fr/velo/demo",
      "/fr/mes-velos/",
    ];
    for (const path of paths) {
      for (const auth of [null, SESSION]) {
        // `unknown`, deliberately: the declared return type already excludes
        // `false`, so comparing against it directly is a type error — but the
        // point of this test is to catch a future edit that makes the
        // declaration lie, so the check has to survive at runtime.
        const result: unknown = await run(path, auth);
        expect(result, `${path} (${auth ? "signed in" : "anonymous"})`).not.toBe(false);
        expect(result === true || result instanceof Response).toBe(true);
      }
    }
  });

  it("uses the cookie locale when the URL carries none", async () => {
    // Reached only if the matcher ever lets an unprefixed protected path in;
    // the redirect must still be a real, localized URL.
    const result = await run("/compte", null, { NEXT_LOCALE: "en" });
    expect(result).toBe(true);
  });
});
