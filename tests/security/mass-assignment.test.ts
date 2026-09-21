/**
 * THREAT — Mass assignment: a form posting a field the UI never drew, and the
 * server writing it because the payload was spread into the query.
 *
 * The dangerous fields on the auth surface are the ones that decide identity
 * and trust: `id`, `passwordHash`, `emailVerified`, `sessionVersion`, and
 * `email` itself (the account key, and not editable in the MVP).
 *
 * CONTROLS PINNED
 *
 *   1. **Every input schema is `.strict()`.** An unknown key is a rejected
 *      submission (`VALIDATION`), not a silently ignored one — so the defence
 *      does not depend on anybody remembering to pick fields afterwards.
 *   2. **Nothing is written on a rejection.** The Prisma call log has no write
 *      in it, so a rejected payload cannot be a half-applied one.
 *   3. **`email` cannot be changed at all.** The profile form renders it
 *      read-only and the schema has no `email` key; posting one is refused.
 *   4. **Privilege-shaped fields never reach the data.** After every attempt,
 *      `passwordHash`, `emailVerified` and `sessionVersion` are exactly what
 *      they were.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

import { formFields } from "@/lib/actions/form-data";
import { hashPassword } from "@/lib/auth/password";
import { fakeDb } from "@/tests/_fakes/prisma";
import {
  sameOriginHeaders,
  sessionFor,
  setRequestHeaders,
  setSession,
} from "@/tests/_fakes/session";

vi.mock("@/auth", async () => (await import("@/tests/_fakes/session")).authModule());

const { updateProfileAction } = await import("@/app/[locale]/(protected)/compte/actions");
const { signUpAction } = await import("@/app/[locale]/(auth)/inscription/actions");
const { createBikeAction, updateBikeAction } =
  await import("@/app/[locale]/(protected)/mes-velos/actions");
const { IDLE } = await import("@/lib/actions/result");
const { deriveBike } = await import("@/lib/bike/rules");
const { BIKE_PRESETS } = await import("@/lib/domain/data/presets");

const PASSWORD = "Guidon-Tandem-47!";

/** The fields an attacker would most like to set. */
const FORBIDDEN_FIELDS = [
  ["id", "00000000-0000-4000-8000-0000000000ff"],
  ["userId", "00000000-0000-4000-8000-0000000000ff"],
  ["passwordHash", "$2b$04$0000000000000000000000000000000000000000000000000000"],
  ["emailVerified", new Date(0).toISOString()],
  ["sessionVersion", "99"],
  ["createdAt", new Date(0).toISOString()],
  ["email", "attacker@velo-atelier.test"],
] as const;

function form(fields: Record<string, string>): FormData {
  const data = new FormData();
  for (const [key, value] of Object.entries(fields)) data.append(key, value);
  return data;
}

let me: { id: string; email: string; name: string | null; locale: "fr" | "en" };

beforeEach(async () => {
  fakeDb.reset();
  setRequestHeaders(sameOriginHeaders());
  const row = await fakeDb.seed("User", {
    email: "camille@velo-atelier.test",
    name: "Camille",
    locale: "fr",
    passwordHash: await hashPassword(PASSWORD, 4),
  });
  me = row as unknown as typeof me;
  setSession(sessionFor(me));
  fakeDb.resetCalls();
});

describe("updateProfileAction", () => {
  it.each(FORBIDDEN_FIELDS)(
    "refuses a payload carrying %s and writes nothing",
    async (key, value) => {
      const before = fakeDb.rows("User").find((row) => row.id === me.id);

      const result = await updateProfileAction(
        IDLE,
        form({ name: "Camille", locale: "fr", [key]: value }),
      );

      expect(result).toMatchObject({ ok: false, code: "VALIDATION" });
      expect(
        fakeDb.calls.filter((call) => ["update", "upsert", "create"].includes(call.op)),
      ).toEqual([]);
      expect(fakeDb.rows("User").find((row) => row.id === me.id)).toEqual(before);
    },
  );

  it("accepts exactly the two fields the form draws", async () => {
    const result = await updateProfileAction(IDLE, form({ name: "Camille B.", locale: "en" }));

    expect(result).toEqual({ ok: true, data: true });
    const row = fakeDb.rows("User").find((entry) => entry.id === me.id);
    expect(row).toMatchObject({ name: "Camille B.", locale: "en" });
    // Untouched by a successful, legitimate update.
    expect(row?.email).toBe("camille@velo-atelier.test");
    expect(row?.sessionVersion).toBe(0);
    expect(row?.emailVerified).toBeNull();
  });

  it("refuses an unknown field even when every legitimate field is valid", async () => {
    const result = await updateProfileAction(
      IDLE,
      form({ name: "Camille", locale: "fr", isAdmin: "true" }),
    );

    expect(result).toMatchObject({ ok: false, code: "VALIDATION" });
  });
});

describe("signUpAction", () => {
  it.each(["id", "passwordHash", "emailVerified", "sessionVersion"] as const)(
    "refuses a sign-up payload carrying %s and creates no account",
    async (key) => {
      const result = await signUpAction(
        IDLE,
        form({ email: "nouveau@velo-atelier.test", password: PASSWORD, [key]: "x" }),
      );

      expect(result).toMatchObject({ ok: false, code: "VALIDATION" });
      expect(fakeDb.rows("User").map((row) => row.email)).toEqual(["camille@velo-atelier.test"]);
    },
  );

  it("reports a tampered payload with message keys only, never zod's own prose", async () => {
    const result = await signUpAction(
      IDLE,
      form({ email: "nouveau@velo-atelier.test", password: PASSWORD, locale: "de", extra: "x" }),
    );

    expect(result).toMatchObject({ ok: false, code: "VALIDATION" });
    const messages = Object.values(
      (result as { fieldErrors?: Record<string, string> }).fieldErrors ?? {},
    );
    expect(messages.length).toBeGreaterThan(0);
    for (const message of messages) expect(message).toMatch(/^errors\./);
  });

  it("never trusts a client-supplied hash: the stored one is bcrypt of the plaintext", async () => {
    // The action signs the new account in, which the session fake turns into a
    // redirect — the account still exists, which is what matters here.
    await signUpAction(
      IDLE,
      form({ email: "nouveau@velo-atelier.test", password: PASSWORD, locale: "fr" }),
    ).catch(() => undefined);

    const created = fakeDb.rows("User").find((row) => row.email === "nouveau@velo-atelier.test");
    expect(created?.passwordHash).toEqual(expect.stringMatching(/^\$2b\$\d{2}\$/));
    expect(created?.emailVerified).toBeNull();
    expect(created?.sessionVersion).toBe(0);
  });
});

/**
 * The one exception to "an unknown key is a rejection", and the reason it is
 * safe.
 *
 * React puts its own bookkeeping into the FormData of every `useActionState`
 * form (`$ACTION_REF_2`, `$ACTION_2:0`, `$ACTION_2:1`, `$ACTION_KEY`, and
 * `$ACTION_ID_<hash>` without JavaScript). A strict schema that sees them
 * rejects every real submission — which is exactly what happened before
 * `formFields()` existed: the tiers above build their FormData by hand, so
 * only a real browser against a real build caught it.
 *
 * `formFields()` drops that prefix and nothing else. These two tests are the
 * pair that keeps the exception narrow: a genuine submission carrying React's
 * fields must succeed, and a payload carrying anything else must still be
 * refused.
 */
describe("React's own action fields", () => {
  /** What a browser actually posts for `<form action={formAction}>`. */
  const REACT_FIELDS = {
    $ACTION_REF_2: "",
    "$ACTION_2:0": '{"id":"60bf3bfc2ccf47e413f9fd9a5a04673095d059eb17","bound":"$@1"}',
    "$ACTION_2:1": '[{"ok":true,"data":false}]',
    $ACTION_KEY: "k633219618129704ac9f52375340a517d",
    $ACTION_ID_60bf3bfc2ccf47e413f9fd9a5a04673095d059eb17: "",
  };

  it("does not turn a legitimate submission into a VALIDATION failure", async () => {
    const result = await updateProfileAction(
      IDLE,
      form({ ...REACT_FIELDS, name: "Camille B.", locale: "en" }),
    );

    expect(result).toEqual({ ok: true, data: true });
    expect(fakeDb.rows("User").find((row) => row.id === me.id)).toMatchObject({
      name: "Camille B.",
      locale: "en",
    });
  });

  it("still refuses a privileged field posted alongside them", async () => {
    const result = await updateProfileAction(
      IDLE,
      form({ ...REACT_FIELDS, name: "Camille", locale: "fr", sessionVersion: "99" }),
    );

    expect(result).toMatchObject({ ok: false, code: "VALIDATION" });
    expect(fakeDb.rows("User").find((row) => row.id === me.id)?.sessionVersion).toBe(0);
  });

  it("keeps a field named `__proto__` as data instead of a prototype write", () => {
    const data = new FormData();
    data.append("__proto__", '{"isAdmin":true}');
    data.append("name", "Camille");

    const fields = formFields(data);

    expect(Object.hasOwn(fields, "__proto__")).toBe(true);
    expect(({} as Record<string, unknown>).isAdmin).toBeUndefined();
  });
});

/**
 * The bike's own dangerous fields: `spec` (§4.2 a — it is DERIVED from the
 * answers on every write and never taken from a caller), the row's `id`, its
 * `createdAt`, and its owner. `mes-velos/actions.ts` says `.strict()` refuses
 * them; until W4 only `userId` was ever posted to prove it.
 */
describe("bike create and update", () => {
  const GRAVEL = BIKE_PRESETS["gravel-1x11"];
  const FORGED = {
    spec: { discipline: "road", brakeType: "rim-caliper", wheelSize: "700c" },
    id: "00000000-0000-4000-8000-00000000dead",
    createdAt: "2001-01-01T00:00:00.000Z",
    userId: "00000000-0000-4000-8000-0000000000b2",
    parts: [],
  } as const;

  beforeEach(async () => {
    fakeDb.reset();
    setRequestHeaders(sameOriginHeaders());
    const me = (await fakeDb.seed("User", {
      email: "camille@velo-atelier.test",
      name: "Camille",
      locale: "fr",
    })) as { id: string; email: string; name: string; locale: "fr" };
    setSession(sessionFor(me));
    fakeDb.resetCalls();
  });

  it.each(Object.entries(FORGED))("refuses `%s` posted with a new bike", async (key, value) => {
    const result = await createBikeAction({ name: "Gravel", answers: GRAVEL, [key]: value });

    expect(result).toMatchObject({ ok: false, code: "VALIDATION" });
    expect(fakeDb.rows("Bike")).toHaveLength(0);
    expect(fakeDb.calls.filter((call) => call.op === "create")).toEqual([]);
  });

  it.each(Object.entries(FORGED))("refuses `%s` posted with an update", async (key, value) => {
    const created = await createBikeAction({ name: "Gravel", answers: GRAVEL });
    if (!created.ok) throw new Error("fixture: could not create the bike");
    const before = fakeDb.rows("Bike");
    fakeDb.resetCalls();

    const result = await updateBikeAction({
      bikeId: created.data.id,
      answers: BIKE_PRESETS["road-rim-2x11"],
      [key]: value,
    });

    expect(result).toMatchObject({ ok: false, code: "VALIDATION" });
    expect(fakeDb.rows("Bike")).toEqual(before);
    expect(fakeDb.calls.filter((call) => call.op.startsWith("update"))).toEqual([]);
  });

  it("stores the spec the answers imply, never one it was handed", async () => {
    // The legitimate keys only — and the stored spec is the derivation.
    const created = await createBikeAction({ name: "Gravel", answers: GRAVEL });
    expect(created.ok).toBe(true);
    expect(fakeDb.rows("Bike")[0]?.spec).toEqual(deriveBike(GRAVEL).spec);
  });
});
