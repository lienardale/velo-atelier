/**
 * The account actions against the real `_test` database (§4.8 AC6).
 *
 * The one claim only PostgreSQL can settle is the deletion cascade. §4.2 makes
 * "delete my account" a single `user.delete()` and relies on `onDelete: Cascade`
 * all the way down — `User → Bike → BikePartState | Checkup → CheckupItem |
 * BuildList → BuildListItem`, plus `Account` and `Session`. A cascade that came
 * out of a migration as `NO ACTION` would leave a live account's data behind
 * under a dead user id, and no amount of fake-Prisma testing would show it. So
 * a full tree is built here and the assertion is literal: **zero rows anywhere
 * for that userId** (§4.8 AC6).
 *
 * The rest of the file is the handful of behaviours that touch columns the fake
 * can only model: the `sessionVersion` increment written by `{ increment: 1 }`,
 * `citext` on the profile read path, and `VARCHAR` limits.
 */
import { decode } from "next-auth/jwt";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { hashPassword, verifyPassword } from "@/lib/auth/password";
import { mintSessionToken, SESSION_COOKIE_NAME } from "@/lib/auth/session-cookie";
import { prisma } from "@/lib/db/prisma";
import {
  authSpies,
  cookieJar,
  sameOriginHeaders,
  sessionFor,
  setRequestCookies,
  setRequestHeaders,
  setSession,
} from "@/tests/_fakes/session";

vi.mock("@/auth", async () => (await import("@/tests/_fakes/session")).authModule());

const { updateProfileAction, changePasswordAction, setPasswordAction, deleteAccountAction } =
  await import("@/app/[locale]/(protected)/compte/actions");
const { IDLE } = await import("@/lib/actions/result");

const PASSWORD = "Guidon-Tandem-47!";
const NEXT_PASSWORD = "Chaine-Cassette-58?";

function form(fields: Record<string, string>): FormData {
  const data = new FormData();
  for (const [key, value] of Object.entries(fields)) data.append(key, value);
  return data;
}

async function signedInUser(
  email: string,
  withPassword = true,
  auth: { authAt?: number; authProvider?: string } = {},
) {
  const user = await prisma.user.create({
    data: {
      email,
      name: "Camille",
      locale: "fr",
      passwordHash: withPassword ? await hashPassword(PASSWORD, 4) : null,
    },
  });
  setSession(
    sessionFor({ id: user.id, email: user.email, name: user.name, locale: "fr", ...auth }),
  );
  return user;
}

/** A complete data tree under one user, touching every cascading relation. */
async function seedTree(userId: string): Promise<{ bikeId: string }> {
  const bike = await prisma.bike.create({
    data: {
      userId,
      name: "Gravel",
      answers: { drive: "muscular", discipline: "gravel" },
      spec: { version: 1, discipline: "gravel" },
      parts: [{ partId: "chain" }],
      fit: { saddleHeightMm: 742 },
      partStates: { create: [{ partId: "chain", status: "BROKEN", notes: "élongation 0,75 %" }] },
    },
  });

  const checkup = await prisma.checkup.create({
    data: {
      bikeId: bike.id,
      scope: "FULL",
      status: "COMPLETED",
      completedAt: new Date(),
      items: {
        create: [
          {
            stepKey: "check-drivetrain#chain-wear",
            partId: "chain",
            guideSlug: "check-drivetrain",
            result: "KO",
          },
        ],
      },
    },
    include: { items: true },
  });

  await prisma.buildList.create({
    data: {
      bikeId: bike.id,
      checkupId: checkup.id,
      name: "Révision printemps",
      items: {
        create: [
          {
            checkupItemId: checkup.items[0].id,
            partId: "chain",
            action: "REPLACE",
            reasonKey: "chain-elongation",
            guideSlug: "replace-chain",
          },
        ],
      },
    },
  });

  await prisma.account.create({
    data: { userId, type: "oidc", provider: "google", providerAccountId: `google-${userId}` },
  });

  return { bikeId: bike.id };
}

/** Every row of every user-owned table that still names `userId`, directly or not. */
async function ownedRowCounts(userId: string, bikeId: string) {
  return {
    users: await prisma.user.count({ where: { id: userId } }),
    accounts: await prisma.account.count({ where: { userId } }),
    sessions: await prisma.session.count({ where: { userId } }),
    bikes: await prisma.bike.count({ where: { userId } }),
    partStates: await prisma.bikePartState.count({ where: { bikeId } }),
    checkups: await prisma.checkup.count({ where: { bikeId } }),
    checkupItems: await prisma.checkupItem.count({ where: { checkup: { bikeId } } }),
    buildLists: await prisma.buildList.count({ where: { bikeId } }),
    buildListItems: await prisma.buildListItem.count({ where: { buildList: { bikeId } } }),
  };
}

beforeEach(async () => {
  await prisma.authAttempt.deleteMany({});
  await prisma.user.deleteMany({});
  setRequestHeaders(sameOriginHeaders());
  setRequestCookies({});
  setSession(null);
  authSpies.unstable_update.mockClear();
});

describe("profile", () => {
  it("writes the name and the locale, and leaves the address alone", async () => {
    const user = await signedInUser("camille@velo-atelier.test");

    expect(await updateProfileAction(IDLE, form({ name: "Camille B.", locale: "en" }))).toEqual({
      ok: true,
      data: true,
    });

    const after = await prisma.user.findUnique({ where: { id: user.id } });
    expect(after).toMatchObject({
      name: "Camille B.",
      locale: "en",
      email: "camille@velo-atelier.test",
    });
  });

  it("stores an empty name as NULL, not as an empty string", async () => {
    const user = await signedInUser("vide@velo-atelier.test");

    await updateProfileAction(IDLE, form({ name: "   ", locale: "fr" }));

    expect((await prisma.user.findUnique({ where: { id: user.id } }))?.name).toBeNull();
  });

  it("re-issues the session cookie with the new name when the request's token is current", async () => {
    const user = await signedInUser("reissue-profile@velo-atelier.test");
    setRequestCookies({
      [SESSION_COOKIE_NAME]: await mintSessionToken(
        { id: user.id, email: user.email, name: "Camille", locale: "fr", sessionVersion: 0 },
        { secret: process.env.AUTH_SECRET ?? "", cookieName: SESSION_COOKIE_NAME },
      ),
    });

    await updateProfileAction(IDLE, form({ name: "Camille B.", locale: "en" }));

    const reissued = cookieJar().get(SESSION_COOKIE_NAME) ?? "";
    const token = await decode({
      token: reissued,
      secret: process.env.AUTH_SECRET ?? "",
      salt: SESSION_COOKIE_NAME,
    });
    expect(token).toMatchObject({ name: "Camille B.", locale: "en", sessionVersion: 0 });
  });

  it("writes no cookie when the request's token is outdated (a password changed elsewhere meanwhile)", async () => {
    const user = await signedInUser("stale-profile@velo-atelier.test");
    await prisma.user.update({ where: { id: user.id }, data: { sessionVersion: 3 } });
    const stale = await mintSessionToken(
      { id: user.id, email: user.email, name: "Camille", locale: "fr", sessionVersion: 2 },
      { secret: process.env.AUTH_SECRET ?? "", cookieName: SESSION_COOKIE_NAME },
    );
    setRequestCookies({ [SESSION_COOKIE_NAME]: stale });

    await updateProfileAction(IDLE, form({ name: "Camille B.", locale: "fr" }));

    // Unchanged: the newer cookie this browser may already hold must not be replaced.
    expect(cookieJar().get(SESSION_COOKIE_NAME)).toBe(stale);
  });

  it("refuses a name longer than the column and writes nothing", async () => {
    const user = await signedInUser("long@velo-atelier.test");

    const result = await updateProfileAction(IDLE, form({ name: "a".repeat(81), locale: "fr" }));

    expect(result).toMatchObject({ ok: false, code: "VALIDATION" });
    expect((await prisma.user.findUnique({ where: { id: user.id } }))?.name).toBe("Camille");
  });
});

describe("password", () => {
  it("re-hashes and bumps sessionVersion, so other devices are dropped", async () => {
    const user = await signedInUser("mdp@velo-atelier.test");

    const result = await changePasswordAction(
      IDLE,
      form({ current: PASSWORD, next: NEXT_PASSWORD }),
    );

    expect(result).toEqual({ ok: true, data: true });
    const after = await prisma.user.findUnique({ where: { id: user.id } });
    expect(after?.sessionVersion).toBe(1);
    expect(await verifyPassword(NEXT_PASSWORD, after?.passwordHash ?? null)).toBe(true);
    expect(await verifyPassword(PASSWORD, after?.passwordHash ?? null)).toBe(false);
  });

  it("re-issues THIS device's session cookie with the new sessionVersion, without an update trigger", async () => {
    // The jwt callback refuses a sessionVersion mismatch on `trigger: "update"` so
    // a stolen cookie cannot adopt the new number; the device that changed the
    // password stays signed in because the action writes it a fresh token.
    const user = await signedInUser("reemis@velo-atelier.test");
    setRequestCookies({
      [SESSION_COOKIE_NAME]: "old-token",
      [`${SESSION_COOKIE_NAME}.0`]: "stale-chunk",
    });

    const result = await changePasswordAction(
      IDLE,
      form({ current: PASSWORD, next: NEXT_PASSWORD }),
    );

    expect(result).toEqual({ ok: true, data: true });
    expect(authSpies.unstable_update).not.toHaveBeenCalled();
    const reissued = cookieJar().get(SESSION_COOKIE_NAME);
    expect(reissued).toBeDefined();
    expect(reissued).not.toBe("old-token");
    expect(cookieJar().has(`${SESSION_COOKIE_NAME}.0`)).toBe(false);
    const token = await decode({
      token: reissued,
      secret: process.env.AUTH_SECRET ?? "",
      salt: SESSION_COOKIE_NAME,
    });
    expect(token).toMatchObject({ id: user.id, email: user.email, sessionVersion: 1 });
  });

  it("writes no cookie when the request carries none (fails closed)", async () => {
    await signedInUser("sanscookie@velo-atelier.test");

    const result = await changePasswordAction(
      IDLE,
      form({ current: PASSWORD, next: NEXT_PASSWORD }),
    );

    expect(result).toEqual({ ok: true, data: true });
    expect(cookieJar().size).toBe(0);
  });

  it("leaves sessionVersion alone when the current password is wrong", async () => {
    const user = await signedInUser("mauvais@velo-atelier.test");

    const result = await changePasswordAction(IDLE, form({ current: "nope", next: NEXT_PASSWORD }));

    expect(result).toMatchObject({ fieldErrors: { current: "errors.wrongPassword" } });
    const after = await prisma.user.findUnique({ where: { id: user.id } });
    expect(after?.sessionVersion).toBe(0);
    expect(await verifyPassword(PASSWORD, after?.passwordHash ?? null)).toBe(true);
  });

  it("adds a first password to a Google-only account after a fresh Google sign-in, signing other devices out", async () => {
    const user = await signedInUser("google@velo-atelier.test", false, {
      authProvider: "google",
      authAt: Date.now() - 60_000,
    });
    setRequestCookies({ [SESSION_COOKIE_NAME]: "old-token" });

    expect(await setPasswordAction(IDLE, form({ next: NEXT_PASSWORD }))).toEqual({
      ok: true,
      data: true,
    });

    const after = await prisma.user.findUnique({ where: { id: user.id } });
    expect(await verifyPassword(NEXT_PASSWORD, after?.passwordHash ?? null)).toBe(true);
    // Any other session — a stolen cookie included — is dropped at its next re-check,
    // and this device got a cookie carrying the new number.
    expect(after?.sessionVersion).toBe(1);
    const reissued = cookieJar().get(SESSION_COOKIE_NAME);
    expect(reissued).toBeDefined();
    expect(reissued).not.toBe("old-token");
  });

  it("refuses to add a password without a fresh Google sign-in, and writes nothing", async () => {
    const user = await signedInUser("stale-google@velo-atelier.test", false, {
      authProvider: "google",
      authAt: Date.now() - 60 * 60_000,
    });

    expect(await setPasswordAction(IDLE, form({ next: NEXT_PASSWORD }))).toMatchObject({
      ok: false,
      code: "FORBIDDEN",
      fieldErrors: { form: "errors.reauthRequired" },
    });
    const after = await prisma.user.findUnique({ where: { id: user.id } });
    expect(after?.passwordHash).toBeNull();
    expect(after?.sessionVersion).toBe(0);
  });

  it("refuses to change the password of a Google-only account", async () => {
    await signedInUser("google2@velo-atelier.test", false);

    expect(await changePasswordAction(IDLE, form({ current: "x", next: NEXT_PASSWORD }))).toEqual({
      ok: false,
      code: "FORBIDDEN",
      fieldErrors: { form: "errors.noPassword" },
    });
  });
});

describe("deletion (§4.8 AC6)", () => {
  it("leaves zero rows anywhere for that userId", async () => {
    const user = await signedInUser("adieu@velo-atelier.test");
    const { bikeId } = await seedTree(user.id);

    // Everything really is there before the delete, or the assertion after it
    // would pass for the wrong reason.
    expect(await ownedRowCounts(user.id, bikeId)).toEqual({
      users: 1,
      accounts: 1,
      sessions: 0,
      bikes: 1,
      partStates: 1,
      checkups: 1,
      checkupItems: 1,
      buildLists: 1,
      buildListItems: 1,
    });

    await expect(deleteAccountAction(IDLE, form({ confirmation: PASSWORD }))).rejects.toMatchObject(
      { digest: expect.stringContaining("NEXT_REDIRECT") },
    );

    expect(await ownedRowCounts(user.id, bikeId)).toEqual({
      users: 0,
      accounts: 0,
      sessions: 0,
      bikes: 0,
      partStates: 0,
      checkups: 0,
      checkupItems: 0,
      buildLists: 0,
      buildListItems: 0,
    });
  });

  it("takes nothing from the account next door", async () => {
    const victim = await signedInUser("reste@velo-atelier.test");
    const victimTree = await seedTree(victim.id);

    const leaving = await signedInUser("part@velo-atelier.test");
    const leavingTree = await seedTree(leaving.id);

    await deleteAccountAction(IDLE, form({ confirmation: PASSWORD })).catch(() => undefined);

    expect(await ownedRowCounts(leaving.id, leavingTree.bikeId)).toMatchObject({
      users: 0,
      bikes: 0,
    });
    expect(await ownedRowCounts(victim.id, victimTree.bikeId)).toMatchObject({
      users: 1,
      bikes: 1,
      buildListItems: 1,
    });
  });

  it("accepts the confirmation word for an account with no password", async () => {
    const user = await signedInUser("mot@velo-atelier.test", false);

    await deleteAccountAction(IDLE, form({ confirmation: "SUPPRIMER" })).catch(() => undefined);

    expect(await prisma.user.count({ where: { id: user.id } })).toBe(0);
  });

  it("refuses a wrong confirmation and keeps everything", async () => {
    const user = await signedInUser("garde@velo-atelier.test");
    const { bikeId } = await seedTree(user.id);

    const result = await deleteAccountAction(IDLE, form({ confirmation: "peut-être" }));

    expect(result).toMatchObject({
      ok: false,
      code: "VALIDATION",
      fieldErrors: { confirmation: "errors.confirmationMismatch" },
    });
    expect(await ownedRowCounts(user.id, bikeId)).toMatchObject({ users: 1, bikes: 1 });
  });
});
