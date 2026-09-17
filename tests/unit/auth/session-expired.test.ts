/**
 * The exit from a half-believed session (`.debug/003`, W1 security review).
 *
 * After a password change on another device, the proxy (no `sessionVersion`
 * check) and the pages (`@/auth`, with one) disagree, and redirecting straight
 * to the sign-in form looped forever. Two pieces break the loop, both pinned here:
 *
 *   1. `redirectToSignIn` / `requireSignedInUser` send a rejected visitor who still
 *      carries a session cookie through `/api/session-expired` — and only then;
 *   2. that route clears the session cookies ONLY when the server itself rejects
 *      the session (so a third-party page cannot sign anyone out), and its
 *      callback URL goes through `safeCallbackUrl`.
 */
import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  isRedirectInterrupt,
  sessionFor,
  setRequestCookies,
  setSession,
} from "@/tests/_fakes/session";

vi.mock("@/auth", async () => (await import("@/tests/_fakes/session")).authModule());
vi.mock(
  "next/navigation",
  async () => (await import("@/tests/_fakes/session")).nextNavigationModule,
);

const { GET } = await import("@/app/api/session-expired/route");
const { redirectToSignIn, requireSignedInUser } = await import("@/lib/actions/with-user");

const USER = {
  id: "00000000-0000-4000-8000-0000000000aa",
  email: "camille@velo-atelier.test",
  name: "Camille",
  locale: "fr" as const,
};

function request(query: string, cookie = "", fetchMode: string | null = "navigate"): NextRequest {
  const headers: Record<string, string> = {};
  if (cookie) headers.cookie = cookie;
  if (fetchMode !== null) headers["sec-fetch-mode"] = fetchMode;
  return new NextRequest(`http://localhost:3100/api/session-expired${query}`, { headers });
}

async function redirectUrl(run: () => Promise<unknown>): Promise<string> {
  try {
    await run();
  } catch (error) {
    if (isRedirectInterrupt(error)) return (error as { url: string }).url;
    throw error;
  }
  throw new Error("expected a redirect");
}

beforeEach(() => {
  setSession(null);
  setRequestCookies({});
});

describe("GET /api/session-expired", () => {
  it("clears every session cookie (both names, all chunks) when the session is rejected", async () => {
    const response = await GET(
      request(
        "?locale=fr&callbackUrl=%2Ffr%2Fcompte",
        "authjs.session-token=old; authjs.session-token.0=a; __Secure-authjs.session-token=b; NEXT_LOCALE=fr",
      ),
    );

    expect(response.status).toBe(303);
    expect(response.headers.get("location")).toBe(
      "http://localhost:3100/fr/connexion?callbackUrl=%2Ffr%2Fcompte",
    );
    const cleared = response.headers.getSetCookie();
    expect(cleared.map((cookie) => cookie.split("=")[0]).sort()).toEqual([
      "__Secure-authjs.session-token",
      "authjs.session-token",
      "authjs.session-token.0",
    ]);
    for (const cookie of cleared) expect(cookie).toMatch(/Max-Age=0/i);
    expect(cleared.some((cookie) => cookie.startsWith("NEXT_LOCALE="))).toBe(false);
  });

  it("clears nothing while the session is valid: it cannot be used to sign someone out", async () => {
    setSession(sessionFor(USER));
    const response = await GET(request("?locale=fr", "authjs.session-token=valid"));

    expect(response.status).toBe(303);
    expect(response.headers.getSetCookie()).toEqual([]);
  });

  it.each(["cors", "same-origin", "no-cors"])(
    "never clears on a background request (Sec-Fetch-Mode: %s): a stale prefetch must not delete a newer cookie",
    async (mode) => {
      const response = await GET(request("?locale=fr", "authjs.session-token=stale", mode));
      expect(response.status).toBe(401);
      expect(response.headers.get("location")).toBeNull();
      expect(response.headers.getSetCookie()).toEqual([]);
    },
  );

  it("treats a client without fetch metadata as a navigation", async () => {
    const response = await GET(request("?locale=fr", "authjs.session-token=stale", null));
    expect(response.status).toBe(303);
    expect(response.headers.getSetCookie().length).toBeGreaterThan(0);
  });

  it("never redirects off-site: the callback goes through safeCallbackUrl", async () => {
    const response = await GET(request("?locale=en&callbackUrl=%2F%2Fevil.example%2Fphish"));
    expect(new URL(response.headers.get("location") ?? "").origin).toBe("http://localhost:3100");
    expect(response.headers.get("location")).toBe(
      "http://localhost:3100/en/sign-in?callbackUrl=%2Fen%2Fmy-bikes",
    );
  });

  it("falls back to the default locale for an unknown one, and omits an absent callback", async () => {
    const response = await GET(request("?locale=de"));
    expect(response.headers.get("location")).toBe("http://localhost:3100/fr/connexion");
  });
});

describe("redirectToSignIn / requireSignedInUser", () => {
  it("goes through /api/session-expired when a rejected session cookie is still present", async () => {
    setRequestCookies({ "authjs.session-token": "stale" });
    const url = await redirectUrl(() => redirectToSignIn("en", "/compte"));
    expect(url).toBe("/api/session-expired?locale=en&callbackUrl=%2Fen%2Faccount");
  });

  it("goes straight to the sign-in form when there is no session cookie at all", async () => {
    const url = await redirectUrl(() => redirectToSignIn("fr", "/mes-velos"));
    expect(url).toBe("/fr/connexion?callbackUrl=%2Ffr%2Fmes-velos");
  });

  it("returns the user when the session is valid", async () => {
    setSession(sessionFor(USER));
    await expect(requireSignedInUser("fr", "/compte")).resolves.toMatchObject({
      id: USER.id,
      email: USER.email,
    });
  });

  it("redirects when the session is rejected", async () => {
    setRequestCookies({ "__Secure-authjs.session-token": "stale" });
    const url = await redirectUrl(() => requireSignedInUser("fr", "/compte"));
    expect(url).toBe("/api/session-expired?locale=fr&callbackUrl=%2Ffr%2Fcompte");
  });
});
