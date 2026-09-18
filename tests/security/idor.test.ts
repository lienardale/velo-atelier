/**
 * THREAT — Insecure direct object reference: acting on somebody else's row by
 * putting their id in the request.
 *
 * The account actions are the first surface in the project that owns data, so
 * they are the first place the rule has to hold. Later tasks extend this file
 * with bikes, checkups and build lists (§4.7); the shape of the assertions does
 * not change.
 *
 * CONTROLS PINNED
 *
 *   1. **Identity comes from the session, never from the form.** Every one of
 *      these actions is `withUser()`-wrapped and uses `user.id`. A form that
 *      carries `id`, `userId` or `email` must not move the target — and,
 *      because every input schema is `.strict()`, it is rejected outright.
 *   2. **The ownership predicate is in the query.** `expectScopedToUser()`
 *      walks the recorded Prisma calls and fails unless every read and write of
 *      user-owned data is constrained by the owner in its `where`. Fetching a
 *      row and checking `row.userId` afterwards is one refactor away from an
 *      IDOR, so the fake refuses to accept it.
 *   3. **Another user's rows are untouched.** After a delete that names a
 *      foreign id in the payload, the victim's row is still there.
 *   4. **404, not 403** (§4.7): a missing row answers `NOT_FOUND`, which says
 *      nothing about whether it exists and belongs to someone else.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

import { hashPassword } from "@/lib/auth/password";
import { expectScopedToUser, fakeDb } from "@/tests/_fakes/prisma";
import {
  sameOriginHeaders,
  sessionFor,
  setRequestHeaders,
  setSession,
} from "@/tests/_fakes/session";

vi.mock("@/auth", async () => (await import("@/tests/_fakes/session")).authModule());

const { updateProfileAction, changePasswordAction, setPasswordAction, deleteAccountAction } =
  await import("@/app/[locale]/(protected)/compte/actions");

const { updateBikePartAction } = await import("@/app/[locale]/velo/[id]/actions");
const { updateBikeFitAction } = await import("@/app/[locale]/velo/[id]/reglages/actions");
const { createBikeAction, updateBikeAction, renameBikeAction, deleteBikeAction } =
  await import("@/app/[locale]/(protected)/mes-velos/actions");
const { deriveBike } = await import("@/lib/bike/rules");
const { BIKE_PRESETS } = await import("@/lib/domain/data/presets");

const { IDLE } = await import("@/lib/actions/result");

const CURRENT = "Guidon-Tandem-47!";
const NEXT = "Chaine-Cassette-58?";

interface SeededUser {
  id: string;
  email: string;
  name: string | null;
  locale: "fr" | "en";
}

async function seedUser(email: string, withPassword = true): Promise<SeededUser> {
  const row = await fakeDb.seed("User", {
    email,
    name: email.split("@")[0],
    locale: "fr",
    passwordHash: withPassword ? await hashPassword(CURRENT, 4) : null,
  });
  return row as unknown as SeededUser;
}

function form(fields: Record<string, string>): FormData {
  const data = new FormData();
  for (const [key, value] of Object.entries(fields)) data.append(key, value);
  return data;
}

let me: SeededUser;
let victim: SeededUser;

beforeEach(async () => {
  fakeDb.reset();
  setRequestHeaders(sameOriginHeaders());
  me = await seedUser("camille@velo-atelier.test");
  victim = await seedUser("victime@velo-atelier.test");
  setSession(sessionFor(me));
  fakeDb.resetCalls();
});

describe("profile", () => {
  it("updates only the caller's row, whatever ids the form carries", async () => {
    const result = await updateProfileAction(
      IDLE,
      form({ name: "Pirate", locale: "fr", id: victim.id, userId: victim.id }),
    );

    // `.strict()` rejects the extra keys outright — nothing is written at all.
    expect(result).toMatchObject({ ok: false, code: "VALIDATION" });
    expect(fakeDb.calls.filter((call) => call.op === "update")).toHaveLength(0);

    const victimRow = fakeDb.rows("User").find((row) => row.id === victim.id);
    expect(victimRow?.name).toBe("victime");
  });

  it("scopes its write to the session user", async () => {
    await updateProfileAction(IDLE, form({ name: "Camille B.", locale: "en" }));

    expectScopedToUser(fakeDb.calls, me.id);
    expect(fakeDb.rows("User").find((row) => row.id === me.id)?.name).toBe("Camille B.");
    expect(fakeDb.rows("User").find((row) => row.id === victim.id)?.name).toBe("victime");
  });
});

describe("password", () => {
  it("changes the caller's password, not the one named in the payload", async () => {
    const before = fakeDb.rows("User").find((row) => row.id === victim.id)?.passwordHash;
    expect(before).toEqual(expect.stringMatching(/^\$2b\$/));

    const result = await changePasswordAction(
      IDLE,
      form({ current: CURRENT, next: NEXT, userId: victim.id }),
    );

    expect(result).toMatchObject({ ok: false, code: "VALIDATION" });
    expect(fakeDb.rows("User").find((row) => row.id === victim.id)?.passwordHash).toBe(before);
  });

  it("scopes the read and the write to the session user", async () => {
    const result = await changePasswordAction(IDLE, form({ current: CURRENT, next: NEXT }));

    expect(result).toEqual({ ok: true, data: true });
    expectScopedToUser(fakeDb.calls, me.id);
    // The victim's hash is untouched, and so is their session version.
    const victimRow = fakeDb.rows("User").find((row) => row.id === victim.id);
    expect(victimRow?.sessionVersion).toBe(0);
  });

  it("refuses to set a password on an account that already has one", async () => {
    const result = await setPasswordAction(IDLE, form({ next: NEXT }));

    expect(result).toMatchObject({ ok: false, code: "FORBIDDEN" });
    expectScopedToUser(fakeDb.calls, me.id);
  });

  it("answers NOT_FOUND — not FORBIDDEN — when the session outlives the row", async () => {
    // The account was deleted on another device; the JWT has not re-checked yet.
    await fakeDb.client.user.delete({ where: { id: me.id } });
    fakeDb.resetCalls();

    expect(await changePasswordAction(IDLE, form({ current: CURRENT, next: NEXT }))).toEqual({
      ok: false,
      code: "NOT_FOUND",
    });
    expect(await setPasswordAction(IDLE, form({ next: NEXT }))).toEqual({
      ok: false,
      code: "NOT_FOUND",
    });
    expect(await deleteAccountAction(IDLE, form({ confirmation: "SUPPRIMER" }))).toEqual({
      ok: false,
      code: "NOT_FOUND",
    });
  });
});

describe("deletion", () => {
  it("deletes the caller and leaves the other account standing", async () => {
    await expect(deleteAccountAction(IDLE, form({ confirmation: CURRENT }))).rejects.toMatchObject({
      digest: expect.stringContaining("NEXT_REDIRECT"),
    });

    expectScopedToUser(fakeDb.calls, me.id);
    expect(fakeDb.rows("User").map((row) => row.id)).toEqual([victim.id]);
  });

  it("ignores a foreign id in the payload — `.strict()` refuses the submission", async () => {
    const result = await deleteAccountAction(
      IDLE,
      form({ confirmation: "SUPPRIMER", userId: victim.id }),
    );

    expect(result).toMatchObject({ ok: false, code: "VALIDATION" });
    expect(fakeDb.rows("User")).toHaveLength(2);
  });
});

/**
 * Bikes (W2-T3). Same four controls, one surface further in: a bike has an
 * owner, so every read and write must carry `userId` (or the nested
 * `bike: { userId }` for its children), and a foreign id must look exactly like
 * an id that does not exist.
 */
describe("bikes", () => {
  const otherBikeId = "3f2504e0-4f89-41d3-9a0c-0305e82c3301";

  async function seedBike(userId: string, name = "Gravel"): Promise<{ id: string }> {
    const derived = deriveBike(BIKE_PRESETS["gravel-1x11"]);
    const bike = (await fakeDb.seed("Bike", {
      userId,
      name,
      answers: derived.answers,
      spec: derived.spec,
      parts: derived.parts,
      fit: { riderKg: 70 },
    })) as { id: string };
    for (const part of derived.parts) {
      await fakeDb.seed("BikePartState", { bikeId: bike.id, partId: part.partId });
    }
    return bike;
  }

  it("edits a part only on the caller's own bike", async () => {
    const mine = await seedBike(me.id);
    const theirs = await seedBike(victim.id, "Vélo de la victime");
    fakeDb.resetCalls();

    const refused = await updateBikePartAction({
      bikeId: theirs.id,
      partId: "cassette",
      attributes: { range: "11-42" },
    });
    expect(refused).toEqual({ ok: false, code: "NOT_FOUND" });
    expectScopedToUser(fakeDb.calls, me.id);

    const allowed = await updateBikePartAction({
      bikeId: mine.id,
      partId: "cassette",
      attributes: { range: "11-36" },
    });
    expect(allowed.ok).toBe(true);
    expectScopedToUser(fakeDb.calls, me.id);

    // The victim's bike is byte-for-byte what it was, whatever the payload said.
    const victimBike = fakeDb.rows("Bike").find((row) => row.id === theirs.id);
    expect(victimBike?.parts).toEqual(deriveBike(BIKE_PRESETS["gravel-1x11"]).parts);
  });

  it("answers NOT_FOUND for a bike id that exists nowhere, exactly as for a foreign one", async () => {
    const theirs = await seedBike(victim.id);
    fakeDb.resetCalls();

    const missing = await updateBikeFitAction({ bikeId: otherBikeId, fit: { riderKg: 80 } });
    const foreign = await updateBikeFitAction({ bikeId: theirs.id, fit: { riderKg: 80 } });
    expect(missing).toEqual(foreign);
    expect(foreign).toEqual({ ok: false, code: "NOT_FOUND" });
  });

  it("writes the fit of the caller's bike and nobody else's", async () => {
    const mine = await seedBike(me.id);
    const theirs = await seedBike(victim.id);
    fakeDb.resetCalls();

    expect(await updateBikeFitAction({ bikeId: mine.id, fit: { saddleHeightMm: 742 } })).toEqual({
      ok: true,
      data: { riderKg: 70, saddleHeightMm: 742 },
    });
    expectScopedToUser(fakeDb.calls, me.id);
    expect(fakeDb.rows("Bike").find((row) => row.id === theirs.id)?.fit).toEqual({ riderKg: 70 });
  });

  it("renames and deletes only the caller's bike", async () => {
    const mine = await seedBike(me.id);
    const theirs = await seedBike(victim.id, "Vélo de la victime");
    fakeDb.resetCalls();

    expect(await renameBikeAction({ bikeId: theirs.id, name: "Volé" })).toEqual({
      ok: false,
      code: "NOT_FOUND",
    });
    expect(await deleteBikeAction({ bikeId: theirs.id })).toEqual({
      ok: false,
      code: "NOT_FOUND",
    });
    expectScopedToUser(fakeDb.calls, me.id);

    expect(fakeDb.rows("Bike").find((row) => row.id === theirs.id)?.name).toBe(
      "Vélo de la victime",
    );

    expect(await renameBikeAction({ bikeId: mine.id, name: "Gravel 2" })).toMatchObject({
      ok: true,
    });
    expect(await deleteBikeAction({ bikeId: mine.id })).toEqual({ ok: true, data: null });
    expect(fakeDb.rows("Bike").map((row) => row.id)).toEqual([theirs.id]);
  });

  it("re-describes only the caller's bike", async () => {
    const theirs = await seedBike(victim.id);
    fakeDb.resetCalls();

    expect(
      await updateBikeAction({ bikeId: theirs.id, answers: BIKE_PRESETS["road-disc-2x12"] }),
    ).toEqual({ ok: false, code: "NOT_FOUND" });
    expectScopedToUser(fakeDb.calls, me.id);

    const victimBike = fakeDb.rows("Bike").find((row) => row.id === theirs.id);
    expect((victimBike?.spec as { discipline: string }).discipline).toBe("gravel");
  });

  it("creates a bike for the session user, never for the id in the payload", async () => {
    fakeDb.resetCalls();
    const result = await createBikeAction({
      name: "Pirate",
      answers: BIKE_PRESETS["gravel-1x11"],
      userId: victim.id,
    });

    // `.strict()` refuses the extra key outright.
    expect(result).toMatchObject({ ok: false, code: "VALIDATION" });
    expect(fakeDb.rows("Bike")).toHaveLength(0);

    const honest = await createBikeAction({ name: "Gravel", answers: BIKE_PRESETS["gravel-1x11"] });
    expect(honest.ok).toBe(true);
    expectScopedToUser(fakeDb.calls, me.id);
    expect(fakeDb.rows("Bike")[0]?.userId).toBe(me.id);
  });

  it("refuses every bike action to an anonymous caller, before any query", async () => {
    const mine = await seedBike(me.id);
    setSession(null);
    fakeDb.resetCalls();

    for (const result of [
      await updateBikePartAction({ bikeId: mine.id, partId: "chain", attributes: {} }),
      await updateBikeFitAction({ bikeId: mine.id, fit: { riderKg: 80 } }),
      await renameBikeAction({ bikeId: mine.id, name: "x" }),
      await deleteBikeAction({ bikeId: mine.id }),
      await createBikeAction({ name: "x", answers: BIKE_PRESETS["gravel-1x11"] }),
    ]) {
      expect(result).toEqual({ ok: false, code: "UNAUTHORIZED" });
    }
    expect(fakeDb.calls).toHaveLength(0);
  });
});
