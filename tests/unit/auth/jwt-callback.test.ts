/**
 * `refreshSessionToken()` — the `jwt` callback's decision table (§4.3).
 *
 * The property that matters is **when the database is read**. Reading it on
 * every request would put an indexed query in front of every page a signed-in
 * visitor loads; never reading it would mean a password change never logs the
 * other devices out. Five minutes is the compromise, and both sides of it are
 * pinned here.
 *
 * Both paths the plan names are covered:
 *   - the fresh token that is handed straight back, with NO query;
 *   - the stale one that is re-checked, and dropped when `sessionVersion` moved.
 *
 * Plus the two ways a token can outlive its account: a deleted row, and a token
 * with no subject at all.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

import { refreshSessionToken, SESSION_RECHECK_MS } from "@/lib/auth/jwt";

const USER_ID = "00000000-0000-4000-8000-0000000000aa";

const ROW = { sessionVersion: 7, locale: "en" as const, name: "Camille", image: null };

function prismaWith(row: typeof ROW | null) {
  const findUnique = vi.fn(async () => row);
  return { prisma: { user: { findUnique } }, findUnique };
}

/** A frozen clock, so "stale" is a decision and not a race. */
const NOW = Date.UTC(2026, 8, 12, 9, 0, 0);
const now = () => NOW;

describe("refreshSessionToken", () => {
  beforeEach(() => vi.clearAllMocks());

  describe("sign-in", () => {
    it("seeds the token from the credentials user and stamps the check", async () => {
      const { prisma, findUnique } = prismaWith(ROW);
      const token = await refreshSessionToken(
        {
          token: { sub: USER_ID },
          user: { id: USER_ID, locale: "fr", sessionVersion: 7 },
          trigger: "signIn",
        },
        { prisma, now },
      );

      expect(token).toMatchObject({
        id: USER_ID,
        locale: "fr",
        sessionVersion: 7,
        checkedAt: NOW,
      });
      // Everything needed was in the user: no query.
      expect(findUnique).not.toHaveBeenCalled();
    });

    it("reads the row when the provider gave no sessionVersion (Google via the adapter)", async () => {
      const { prisma, findUnique } = prismaWith(ROW);
      const token = await refreshSessionToken(
        { token: { sub: USER_ID }, user: { id: USER_ID }, trigger: "signIn" },
        { prisma, now },
      );

      expect(findUnique).toHaveBeenCalledWith({
        where: { id: USER_ID },
        select: { sessionVersion: true, locale: true, name: true, image: true },
      });
      expect(token).toMatchObject({ sessionVersion: 7, locale: "en", name: "Camille" });
    });

    it("falls back to `sub` when the provider's user has no id", async () => {
      const { prisma } = prismaWith(ROW);
      const token = await refreshSessionToken(
        { token: { sub: USER_ID }, user: { locale: "fr", sessionVersion: 7 } },
        { prisma, now },
      );
      expect(token).toMatchObject({ id: USER_ID });
    });
  });

  describe("subsequent requests", () => {
    it("hands a fresh token back untouched, with no query", async () => {
      const { prisma, findUnique } = prismaWith(ROW);
      const token = await refreshSessionToken(
        {
          token: {
            sub: USER_ID,
            id: USER_ID,
            locale: "fr",
            sessionVersion: 7,
            checkedAt: NOW - 60_000,
          },
        },
        { prisma, now },
      );

      expect(findUnique).not.toHaveBeenCalled();
      expect(token).toMatchObject({ locale: "fr", checkedAt: NOW - 60_000 });
    });

    it("re-reads once the token is older than the recheck window", async () => {
      const { prisma, findUnique } = prismaWith(ROW);
      const token = await refreshSessionToken(
        {
          token: {
            sub: USER_ID,
            id: USER_ID,
            locale: "fr",
            sessionVersion: 7,
            checkedAt: NOW - SESSION_RECHECK_MS - 1,
          },
        },
        { prisma, now },
      );

      expect(findUnique).toHaveBeenCalledTimes(1);
      // The row wins: a locale changed on another device follows the visitor here.
      expect(token).toMatchObject({ locale: "en", name: "Camille", checkedAt: NOW });
    });

    it("re-reads immediately on an explicit update (unstable_update)", async () => {
      const { prisma, findUnique } = prismaWith(ROW);
      await refreshSessionToken(
        {
          token: { sub: USER_ID, id: USER_ID, sessionVersion: 7, checkedAt: NOW },
          trigger: "update",
        },
        { prisma, now },
      );
      expect(findUnique).toHaveBeenCalledTimes(1);
    });

    it("honours a caller-supplied window", async () => {
      const { prisma, findUnique } = prismaWith(ROW);
      await refreshSessionToken(
        { token: { sub: USER_ID, id: USER_ID, sessionVersion: 7, checkedAt: NOW - 2_000 } },
        { prisma, now, recheckMs: 1_000 },
      );
      expect(findUnique).toHaveBeenCalledTimes(1);
    });
  });

  describe("sign-in stamps when and how the session authenticated", () => {
    it("records authAt and the provider (Google)", async () => {
      const { prisma } = prismaWith(ROW);
      const token = await refreshSessionToken(
        {
          token: { sub: USER_ID },
          user: { id: USER_ID, locale: "fr", sessionVersion: 7 },
          account: { provider: "google" },
          trigger: "signIn",
        },
        { prisma, now },
      );
      expect(token).toMatchObject({ authAt: NOW, authProvider: "google" });
    });

    it("records the credentials provider too, which never counts as a Google re-authentication", async () => {
      const { prisma } = prismaWith(ROW);
      const token = await refreshSessionToken(
        {
          token: { sub: USER_ID },
          user: { id: USER_ID, locale: "fr", sessionVersion: 7 },
          account: { provider: "credentials" },
          trigger: "signIn",
        },
        { prisma, now },
      );
      expect(token).toMatchObject({ authAt: NOW, authProvider: "credentials" });
    });

    it("keeps the original stamp on later requests (it is not refreshed by a re-check)", async () => {
      const { prisma } = prismaWith(ROW);
      const token = await refreshSessionToken(
        {
          token: {
            sub: USER_ID,
            id: USER_ID,
            sessionVersion: 7,
            checkedAt: NOW - SESSION_RECHECK_MS - 1,
            authAt: NOW - 3_600_000,
            authProvider: "google",
          },
        },
        { prisma, now },
      );
      expect(token).toMatchObject({ authAt: NOW - 3_600_000, authProvider: "google" });
    });
  });

  describe("the token is dropped", () => {
    it("on an update trigger too, so a stolen cookie cannot adopt a new sessionVersion", async () => {
      // Auth.js fires `update` from the client (`POST /api/auth/session`). If an
      // update could adopt the row's number, a cookie stolen before a password
      // change would survive it. The device that changed the password is kept
      // signed in by a re-issued cookie instead (lib/auth/session-cookie.ts).
      const { prisma } = prismaWith({ ...ROW, sessionVersion: 8 });
      const token = await refreshSessionToken(
        {
          token: { sub: USER_ID, id: USER_ID, sessionVersion: 7, checkedAt: NOW },
          trigger: "update",
        },
        { prisma, now },
      );
      expect(token).toBeNull();
    });

    it("when `sessionVersion` has moved on (password changed elsewhere)", async () => {
      const { prisma } = prismaWith({ ...ROW, sessionVersion: 8 });
      const token = await refreshSessionToken(
        {
          token: { sub: USER_ID, id: USER_ID, sessionVersion: 7, checkedAt: NOW - 10 * 60_000 },
        },
        { prisma, now },
      );
      expect(token).toBeNull();
    });

    it("when the account no longer exists", async () => {
      const { prisma } = prismaWith(null);
      const token = await refreshSessionToken(
        {
          token: { sub: USER_ID, id: USER_ID, sessionVersion: 7, checkedAt: NOW - 10 * 60_000 },
        },
        { prisma, now },
      );
      expect(token).toBeNull();
    });

    it("when it carries no subject at all", async () => {
      const { prisma, findUnique } = prismaWith(ROW);
      const token = await refreshSessionToken({ token: {} }, { prisma, now });
      expect(token).toBeNull();
      expect(findUnique).not.toHaveBeenCalled();
    });
  });

  it("defaults the locale when the row somehow has none", async () => {
    const { prisma } = prismaWith({ ...ROW, locale: undefined as unknown as "en" });
    const token = await refreshSessionToken(
      { token: { sub: USER_ID, id: USER_ID, sessionVersion: 7, checkedAt: 0 } },
      { prisma, now },
    );
    expect(token).toMatchObject({ locale: "fr" });
  });

  it("uses a five-minute window by default", () => {
    expect(SESSION_RECHECK_MS).toBe(5 * 60_000);
  });
});
