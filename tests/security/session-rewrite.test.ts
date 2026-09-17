/**
 * THREAT — a stolen session cookie slipping past the `sessionVersion` re-check
 * through the "cookie written in this request" path.
 *
 * `currentUser()` trusts a session cookie that server code rewrote during the
 * current request (Next re-renders the page in the same response after
 * `cookies().set()`, and that render would otherwise read the stale header;
 * `.debug/003`). A trusted path next to the normal re-check is exactly where a
 * bypass hides, so it is pinned from the attacker's side:
 *
 *   1. a genuine rewrite whose sessionVersion matches the row is trusted;
 *   2. a rewrite carrying an OLD sessionVersion is not — it goes through auth(),
 *      which rejects it (a token stolen before a password change stays dead);
 *   3. a client cannot fake a "rewrite" by percent-encoding its own cookie: the
 *      header is compared after the same decoding Next's cookie store applies;
 *   4. a cookie emptied during the request reads as signed out.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

import { cookieFromHeader, mintSessionToken, SESSION_COOKIE_NAME } from "@/lib/auth/session-cookie";
import { fakeDb } from "@/tests/_fakes/prisma";
import {
  authSpies,
  setRequestCookies,
  setRequestHeaders,
  setSession,
} from "@/tests/_fakes/session";

vi.mock("@/auth", async () => (await import("@/tests/_fakes/session")).authModule());

const { currentUser } = await import("@/lib/actions/with-user");

const SECRET = process.env.AUTH_SECRET ?? "";

async function seededUser(sessionVersion: number) {
  return fakeDb.seed("User", {
    email: "camille@velo-atelier.test",
    name: "Camille",
    locale: "fr",
    sessionVersion,
  });
}

async function token(id: string, sessionVersion: number): Promise<string> {
  return mintSessionToken(
    { id, email: "camille@velo-atelier.test", name: "Camille", locale: "fr", sessionVersion },
    { secret: SECRET, cookieName: SESSION_COOKIE_NAME },
  );
}

beforeEach(() => {
  fakeDb.reset();
  setSession(null);
  setRequestHeaders({});
  setRequestCookies({});
  authSpies.auth.mockClear();
});

describe("currentUser() and a session cookie rewritten during the request", () => {
  it("trusts a genuine rewrite whose sessionVersion matches the row, without auth()", async () => {
    const user = await seededUser(1);
    setRequestHeaders({ cookie: `${SESSION_COOKIE_NAME}=${await token(String(user.id), 0)}` });
    setRequestCookies({ [SESSION_COOKIE_NAME]: await token(String(user.id), 1) });

    await expect(currentUser()).resolves.toMatchObject({
      id: user.id,
      email: "camille@velo-atelier.test",
    });
    expect(authSpies.auth).not.toHaveBeenCalled();
  });

  it("does not trust a rewrite carrying an old sessionVersion: auth() decides, and rejects it", async () => {
    const user = await seededUser(2);
    setRequestHeaders({ cookie: `${SESSION_COOKIE_NAME}=something-else` });
    setRequestCookies({ [SESSION_COOKIE_NAME]: await token(String(user.id), 1) });

    await expect(currentUser()).resolves.toBeNull();
    expect(authSpies.auth).toHaveBeenCalledTimes(1);
  });

  it("cannot be faked by percent-encoding the cookie in the request header", async () => {
    const user = await seededUser(0);
    const stolen = await token(String(user.id), 0);
    // `.` is safe in a cookie but `%2E` decodes to it: Next's cookie store holds the
    // decoded value, so a raw comparison would have seen a "rewrite".
    const encoded = stolen.replace(".", "%2E");
    setRequestHeaders({ cookie: `${SESSION_COOKIE_NAME}=${encoded}` });
    setRequestCookies({ [SESSION_COOKIE_NAME]: stolen });

    await currentUser();
    expect(authSpies.auth).toHaveBeenCalledTimes(1);
  });

  it("reads an emptied cookie as signed out", async () => {
    setRequestHeaders({ cookie: `${SESSION_COOKIE_NAME}=old` });
    setRequestCookies({ [SESSION_COOKIE_NAME]: "" });
    await expect(currentUser()).resolves.toBeNull();
    expect(authSpies.auth).not.toHaveBeenCalled();
  });

  it("uses auth() on an ordinary request, where the store and the header agree", async () => {
    setRequestHeaders({ cookie: `NEXT_LOCALE=fr; ${SESSION_COOKIE_NAME}=abc` });
    setRequestCookies({ NEXT_LOCALE: "fr", [SESSION_COOKIE_NAME]: "abc" });
    await currentUser();
    expect(authSpies.auth).toHaveBeenCalledTimes(1);
  });
});

describe("cookieFromHeader", () => {
  it("finds a cookie among others and decodes it like Next's cookie store", () => {
    expect(cookieFromHeader("a=1; authjs.session-token=x%2Ey; b=2", SESSION_COOKIE_NAME)).toBe(
      "x.y",
    );
    expect(cookieFromHeader("authjs.session-token.0=part", SESSION_COOKIE_NAME)).toBeNull();
    expect(cookieFromHeader(null, SESSION_COOKIE_NAME)).toBeNull();
    expect(cookieFromHeader("authjs.session-token=%E0%A4%A", SESSION_COOKIE_NAME)).toBe("%E0%A4%A");
  });
});
