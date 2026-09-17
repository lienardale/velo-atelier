/**
 * `lib/auth/session-cookie.ts` — the session cookie the app re-issues itself.
 *
 * The re-issue after a password change is only safe if the token is one Auth.js
 * decodes as its own (same `encode`, same salt) and lands under the cookie name
 * the request arrived with. These tests pin both, plus the cookie attributes a
 * browser needs to replace the old cookie rather than add a second one.
 */
import { decode } from "next-auth/jwt";
import { describe, expect, it } from "vitest";

import {
  isDeletingSetCookie,
  isSessionSetCookie,
  mintSessionToken,
  presentSessionCookie,
  SECURE_SESSION_COOKIE_NAME,
  SESSION_COOKIE_NAME,
  SESSION_MAX_AGE_S,
  sessionCookieNameFor,
  sessionCookieNamesIn,
  sessionCookieOptions,
  sessionRefreshPolicy,
  sessionTokenAgeS,
  SESSION_UPDATE_AGE_S,
  withoutSessionRefresh,
  withoutSessionSetCookies,
} from "@/lib/auth/session-cookie";

const SECRET = "test-secret-with-enough-entropy-for-hkdf-000000";
const NOW = 1_780_000_000_000;

describe("sessionCookieNameFor", () => {
  it("uses the __Secure- prefix over HTTPS only", () => {
    expect(sessionCookieNameFor(true)).toBe(SECURE_SESSION_COOKIE_NAME);
    expect(sessionCookieNameFor(false)).toBe(SESSION_COOKIE_NAME);
  });
});

describe("presentSessionCookie", () => {
  it("finds the plain cookie", () => {
    expect(presentSessionCookie(["authjs.csrf-token", SESSION_COOKIE_NAME])).toEqual({
      name: SESSION_COOKIE_NAME,
      chunks: [],
    });
  });

  it("finds the secure cookie", () => {
    expect(presentSessionCookie([SECURE_SESSION_COOKIE_NAME])).toEqual({
      name: SECURE_SESSION_COOKIE_NAME,
      chunks: [],
    });
  });

  it("recognises a chunked token and lists its chunks", () => {
    expect(
      presentSessionCookie([`${SESSION_COOKIE_NAME}.0`, `${SESSION_COOKIE_NAME}.1`, "NEXT_LOCALE"]),
    ).toEqual({
      name: SESSION_COOKIE_NAME,
      chunks: [`${SESSION_COOKIE_NAME}.0`, `${SESSION_COOKIE_NAME}.1`],
    });
  });

  it("does not mistake look-alike cookies for chunks", () => {
    expect(
      presentSessionCookie([
        "authjs.callback-url",
        `${SESSION_COOKIE_NAME}-backup`,
        `${SESSION_COOKIE_NAME}.abc`,
        `${SESSION_COOKIE_NAME}.`,
      ]),
    ).toBeNull();
  });

  it("does not read the plain name out of the secure one", () => {
    // "__Secure-authjs.session-token" ends with "authjs.session-token".
    expect(presentSessionCookie([SECURE_SESSION_COOKIE_NAME])?.name).toBe(
      SECURE_SESSION_COOKIE_NAME,
    );
  });

  it("prefers the secure cookie when a browser holds both", () => {
    expect(presentSessionCookie([SESSION_COOKIE_NAME, SECURE_SESSION_COOKIE_NAME])?.name).toBe(
      SECURE_SESSION_COOKIE_NAME,
    );
  });

  it("returns null without a session cookie: there is no device to keep signed in", () => {
    expect(presentSessionCookie([])).toBeNull();
    expect(presentSessionCookie(["NEXT_LOCALE", "authjs.csrf-token"])).toBeNull();
  });
});

describe("mintSessionToken", () => {
  const claims = {
    id: "00000000-0000-4000-8000-000000000001",
    email: "camille@velo-atelier.test",
    name: "Camille",
    picture: null,
    locale: "fr",
    sessionVersion: 8,
  };

  it("produces a token Auth.js decodes as its own, carrying the new sessionVersion", async () => {
    const token = await mintSessionToken(claims, {
      secret: SECRET,
      cookieName: SESSION_COOKIE_NAME,
      now: () => NOW,
    });

    const decoded = await decode({ token, secret: SECRET, salt: SESSION_COOKIE_NAME });
    expect(decoded).toMatchObject({
      sub: claims.id,
      id: claims.id,
      email: claims.email,
      name: "Camille",
      locale: "fr",
      sessionVersion: 8,
      checkedAt: NOW,
    });
  });

  it("is salted with the cookie name: the secure cookie cannot be decoded as the plain one", async () => {
    const token = await mintSessionToken(claims, {
      secret: SECRET,
      cookieName: SECURE_SESSION_COOKIE_NAME,
    });
    await expect(decode({ token, secret: SECRET, salt: SESSION_COOKIE_NAME })).rejects.toThrow();
    await expect(
      decode({ token, secret: SECRET, salt: SECURE_SESSION_COOKIE_NAME }),
    ).resolves.toMatchObject({ sessionVersion: 8 });
  });

  it("cannot be decoded with another secret", async () => {
    const token = await mintSessionToken(claims, {
      secret: SECRET,
      cookieName: SESSION_COOKIE_NAME,
    });
    await expect(
      decode({ token, secret: `${SECRET}-other`, salt: SESSION_COOKIE_NAME }),
    ).rejects.toThrow();
  });
});

describe("sessionCookieOptions", () => {
  it("matches Auth.js's own session cookie over HTTP", () => {
    expect(sessionCookieOptions(SESSION_COOKIE_NAME)).toEqual({
      httpOnly: true,
      sameSite: "lax",
      path: "/",
      secure: false,
      maxAge: SESSION_MAX_AGE_S,
    });
  });

  it("sets Secure for the __Secure- name, which browsers require", () => {
    expect(sessionCookieOptions(SECURE_SESSION_COOKIE_NAME).secure).toBe(true);
  });
});

describe("isSessionSetCookie", () => {
  it("matches the session cookie, its secure twin and their chunks", () => {
    expect(isSessionSetCookie(`${SESSION_COOKIE_NAME}=eyJ; Path=/; HttpOnly`)).toBe(true);
    expect(isSessionSetCookie(`${SESSION_COOKIE_NAME}=; Path=/; Max-Age=0`)).toBe(true);
    expect(isSessionSetCookie(`${SECURE_SESSION_COOKIE_NAME}=eyJ; Secure`)).toBe(true);
    expect(isSessionSetCookie(`${SESSION_COOKIE_NAME}.1=part; Path=/`)).toBe(true);
  });

  it("leaves every other cookie alone", () => {
    expect(isSessionSetCookie("NEXT_LOCALE=fr; Path=/")).toBe(false);
    expect(isSessionSetCookie("authjs.csrf-token=abc; Path=/")).toBe(false);
    expect(isSessionSetCookie("authjs.callback-url=http%3A%2F%2Flocalhost; Path=/")).toBe(false);
    expect(isSessionSetCookie(`${SESSION_COOKIE_NAME}-x=1`)).toBe(false);
  });
});

describe("withoutSessionSetCookies", () => {
  it("drops the proxy's session refresh and keeps everything else (the observed sign-out POST)", () => {
    const headers = new Headers({ "x-middleware-next": "1" });
    headers.append(
      "set-cookie",
      `${SESSION_COOKIE_NAME}=eyJrefresh; Path=/; Expires=Mon, 12 Oct 2026 22:11:00 GMT`,
    );
    headers.append(
      "set-cookie",
      "authjs.callback-url=http%3A%2F%2Flocalhost%3A3100%2Ffr; Path=/; HttpOnly",
    );
    headers.append("set-cookie", "NEXT_LOCALE=fr; Path=/; SameSite=lax");

    const kept = withoutSessionSetCookies(headers);

    expect(kept.getSetCookie()).toEqual([
      "authjs.callback-url=http%3A%2F%2Flocalhost%3A3100%2Ffr; Path=/; HttpOnly",
      "NEXT_LOCALE=fr; Path=/; SameSite=lax",
    ]);
    expect(kept.get("x-middleware-next")).toBe("1");
  });

  it("does not mutate the headers it was given", () => {
    const headers = new Headers();
    headers.append("set-cookie", `${SESSION_COOKIE_NAME}=eyJ; Path=/`);
    withoutSessionSetCookies(headers);
    expect(headers.getSetCookie()).toHaveLength(1);
  });

  it("returns headers without any Set-Cookie when only session cookies were present", () => {
    const headers = new Headers();
    headers.append("set-cookie", `${SECURE_SESSION_COOKIE_NAME}=eyJ; Secure`);
    headers.append("set-cookie", `${SECURE_SESSION_COOKIE_NAME}.0=part; Secure`);
    expect(withoutSessionSetCookies(headers).getSetCookie()).toEqual([]);
  });
});

describe("isDeletingSetCookie", () => {
  it("recognises an empty value or Max-Age=0 as a deletion", () => {
    expect(isDeletingSetCookie(`${SESSION_COOKIE_NAME}=; Path=/; Max-Age=0`)).toBe(true);
    expect(isDeletingSetCookie(`${SESSION_COOKIE_NAME}=; Path=/`)).toBe(true);
    expect(isDeletingSetCookie(`${SESSION_COOKIE_NAME}=eyJ; Path=/; max-age = 0`)).toBe(true);
  });

  it("does not treat a refresh as a deletion", () => {
    expect(isDeletingSetCookie(`${SESSION_COOKIE_NAME}=eyJ; Path=/; Max-Age=2592000`)).toBe(false);
    expect(
      isDeletingSetCookie(
        `${SESSION_COOKIE_NAME}=eyJ; Path=/; Expires=Mon, 12 Oct 2026 22:11:00 GMT`,
      ),
    ).toBe(false);
  });
});

describe("withoutSessionSetCookies({ keepDeletions: true })", () => {
  it("drops a refresh but keeps a deletion", () => {
    const headers = new Headers();
    headers.append("set-cookie", `${SESSION_COOKIE_NAME}=eyJ; Path=/; Max-Age=2592000`);
    headers.append("set-cookie", `${SESSION_COOKIE_NAME}.0=; Path=/; Max-Age=0`);
    expect(withoutSessionSetCookies(headers, { keepDeletions: true }).getSetCookie()).toEqual([
      `${SESSION_COOKIE_NAME}.0=; Path=/; Max-Age=0`,
    ]);
  });
});

describe("withoutSessionRefresh", () => {
  it("keeps the session JSON and status but not the refreshed cookie (a late read cannot sign the visitor back in)", async () => {
    const headers = new Headers({ "content-type": "application/json" });
    headers.append("set-cookie", `${SESSION_COOKIE_NAME}=eyJlate; Path=/; Max-Age=2592000`);
    const response = new Response(JSON.stringify({ user: { id: "u1" } }), { status: 200, headers });

    const stripped = withoutSessionRefresh(response);

    expect(stripped.status).toBe(200);
    expect(stripped.headers.get("content-type")).toBe("application/json");
    expect(stripped.headers.getSetCookie()).toEqual([]);
    await expect(stripped.json()).resolves.toEqual({ user: { id: "u1" } });
  });

  it("still passes a deletion for an invalidated session", () => {
    const headers = new Headers();
    headers.append("set-cookie", `${SESSION_COOKIE_NAME}=; Path=/; Max-Age=0`);
    const stripped = withoutSessionRefresh(new Response("{}", { headers }));
    expect(stripped.headers.getSetCookie()).toEqual([`${SESSION_COOKIE_NAME}=; Path=/; Max-Age=0`]);
  });
});

describe("sessionRefreshPolicy", () => {
  const DAY = SESSION_UPDATE_AGE_S;

  it("drops every proxy session cookie on a server action: the action writes the only one", () => {
    expect(
      sessionRefreshPolicy({ isServerAction: true, isRouterRequest: false, tokenAgeS: 2 * DAY }),
    ).toBe("drop-all");
  });

  it("never refreshes on a router request, however old the token (a prefetch can land after a sign-out)", () => {
    expect(
      sessionRefreshPolicy({ isServerAction: false, isRouterRequest: true, tokenAgeS: 2 * DAY }),
    ).toBe("drop-refresh");
  });

  it("refreshes a document navigation once the token is a day old (§4 updateAge)", () => {
    expect(
      sessionRefreshPolicy({ isServerAction: false, isRouterRequest: false, tokenAgeS: DAY }),
    ).toBe("keep");
  });

  it("does not refresh a younger token, nor one it could not read", () => {
    expect(
      sessionRefreshPolicy({ isServerAction: false, isRouterRequest: false, tokenAgeS: DAY - 1 }),
    ).toBe("drop-refresh");
    expect(
      sessionRefreshPolicy({ isServerAction: false, isRouterRequest: false, tokenAgeS: null }),
    ).toBe("drop-refresh");
  });
});

describe("sessionTokenAgeS", () => {
  it("reads the age from the token's iat", async () => {
    const issued = 1_780_000_000_000;
    const token = await mintSessionToken(
      { id: "u1", email: "a@velo-atelier.test", name: null, locale: "fr", sessionVersion: 0 },
      { secret: SECRET, cookieName: SESSION_COOKIE_NAME, now: () => issued },
    );
    // encode() stamps iat from the real clock, so measure against it.
    const age = await sessionTokenAgeS(token, {
      secret: SECRET,
      cookieName: SESSION_COOKIE_NAME,
      now: () => Date.now() + 3_600_000,
    });
    expect(age).toBeGreaterThanOrEqual(3_599);
    expect(age).toBeLessThanOrEqual(3_605);
  });

  it("is null for a token it cannot decrypt (wrong salt, garbage)", async () => {
    const token = await mintSessionToken(
      { id: "u1", email: "a@velo-atelier.test", name: null, locale: "fr", sessionVersion: 0 },
      { secret: SECRET, cookieName: SECURE_SESSION_COOKIE_NAME },
    );
    await expect(
      sessionTokenAgeS(token, { secret: SECRET, cookieName: SESSION_COOKIE_NAME }),
    ).resolves.toBeNull();
    await expect(
      sessionTokenAgeS("not-a-jwe", { secret: SECRET, cookieName: SESSION_COOKIE_NAME }),
    ).resolves.toBeNull();
  });
});

describe("sessionCookieNamesIn", () => {
  it("lists both session cookie names and their chunks, nothing else", () => {
    expect(
      sessionCookieNamesIn([
        "NEXT_LOCALE",
        SESSION_COOKIE_NAME,
        `${SESSION_COOKIE_NAME}.0`,
        SECURE_SESSION_COOKIE_NAME,
        "authjs.csrf-token",
        `${SESSION_COOKIE_NAME}-backup`,
      ]),
    ).toEqual([SESSION_COOKIE_NAME, `${SESSION_COOKIE_NAME}.0`, SECURE_SESSION_COOKIE_NAME]);
  });
});
