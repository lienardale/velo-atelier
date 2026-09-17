/**
 * THREAT — a stolen session cookie on a Google-only account turning itself into a
 * permanent password the owner cannot revoke.
 *
 * Found by the W1 security review: `setPasswordAction` needed nothing but a session,
 * the change needs no current password, and the MVP has no reset flow — so the
 * victim could never evict the attacker. Decided with the user (2026-09-17): adding
 * a first password requires a Google sign-in within `REAUTH_WINDOW_MS`.
 *
 * CONTROLS PINNED
 *
 *   1. a session with no authentication stamp (what a cookie minted before this
 *      control, or forged without one, carries) cannot set a password;
 *   2. a Google sign-in older than the window cannot;
 *   3. a credentials sign-in cannot, however recent (it is not Google re-auth);
 *   4. a fresh Google sign-in can — and doing so signs every other device out.
 *   5. the refusal writes nothing.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

import { REAUTH_WINDOW_MS } from "@/lib/auth/reauth";
import { fakeDb } from "@/tests/_fakes/prisma";
import {
  sameOriginHeaders,
  sessionFor,
  setRequestHeaders,
  setSession,
} from "@/tests/_fakes/session";

vi.mock("@/auth", async () => (await import("@/tests/_fakes/session")).authModule());

const { setPasswordAction } = await import("@/app/[locale]/(protected)/compte/actions");
const { IDLE } = await import("@/lib/actions/result");

const PASSWORD = "Chaine-Cassette-58?";

function form(fields: Record<string, string>): FormData {
  const data = new FormData();
  for (const [key, value] of Object.entries(fields)) data.append(key, value);
  return data;
}

async function googleOnlyUser(stamp: { authAt?: number; authProvider?: string }) {
  const user = await fakeDb.seed("User", {
    email: "google-only@velo-atelier.test",
    locale: "fr",
    passwordHash: null,
    sessionVersion: 0,
  });
  setSession(
    sessionFor({
      id: String(user.id),
      email: "google-only@velo-atelier.test",
      locale: "fr",
      ...stamp,
    }),
  );
  return user;
}

beforeEach(() => {
  fakeDb.reset();
  setRequestHeaders(sameOriginHeaders());
  setSession(null);
});

describe("setPasswordAction on a Google-only account", () => {
  it.each([
    ["no authentication stamp (a stolen or pre-control cookie)", {}],
    [
      "a Google sign-in older than the window",
      { authProvider: "google", authAt: Date.now() - REAUTH_WINDOW_MS - 60_000 },
    ],
    ["a recent credentials sign-in", { authProvider: "credentials", authAt: Date.now() }],
  ])("refuses with %s, and writes nothing", async (_label, stamp) => {
    const user = await googleOnlyUser(stamp);

    const result = await setPasswordAction(IDLE, form({ next: PASSWORD }));

    expect(result).toMatchObject({
      ok: false,
      code: "FORBIDDEN",
      fieldErrors: { form: "errors.reauthRequired" },
    });
    const row = fakeDb.rows("User").find((entry) => entry.id === user.id);
    expect(row?.passwordHash).toBeNull();
    expect(row?.sessionVersion).toBe(0);
  });

  it("accepts a fresh Google sign-in and signs every other device out", async () => {
    const user = await googleOnlyUser({ authProvider: "google", authAt: Date.now() - 30_000 });

    const result = await setPasswordAction(IDLE, form({ next: PASSWORD }));

    expect(result).toEqual({ ok: true, data: true });
    const row = fakeDb.rows("User").find((entry) => entry.id === user.id);
    expect(row?.passwordHash).toEqual(expect.stringMatching(/^\$2b\$/));
    expect(row?.sessionVersion).toBe(1);
  });
});
