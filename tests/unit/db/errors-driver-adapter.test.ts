/**
 * P2002 as Prisma 7 + `@prisma/adapter-pg` actually reports it.
 *
 * `tests/unit/db/errors.test.ts` (W0-T4) covers the documented shape, where the
 * violated columns arrive in `meta.target`. With a **driver adapter** they do
 * not: `meta.target` is absent and the constraint is buried in the adapter's
 * own error. The exact payload below was captured from a real duplicate insert
 * against PostgreSQL 16 while writing `tests/integration/auth.test.ts`:
 *
 *   meta = {
 *     driverAdapterError: { name: 'DriverAdapterError', cause: {
 *       originalCode: '23505', kind: 'UniqueConstraintViolation',
 *       constraint: { index: 'User_email_key' }, table: 'User' } },
 *     modelName: 'User',
 *   }
 *
 * Without this branch `isUniqueViolation(error, 'email')` is false for every
 * real duplicate, and `signUpAction` answers with an unhandled exception
 * instead of `errors.emailTaken`. That is the bug this file exists to prevent
 * from coming back; the integration test proves the live behaviour, and these
 * cases cover the shapes the adapter can produce without needing a database.
 */
import { describe, expect, it } from "vitest";

import { isUniqueViolation, uniqueViolationTargets } from "@/lib/db/errors";

/** A P2002 exactly as the pg driver adapter builds it. */
function adapterP2002(constraint: unknown, table = "User") {
  return Object.assign(new Error("Unique constraint failed"), {
    code: "P2002",
    meta: {
      driverAdapterError: {
        name: "DriverAdapterError",
        cause: {
          originalCode: "23505",
          originalMessage: `duplicate key value violates unique constraint "${String(constraint)}"`,
          kind: "UniqueConstraintViolation",
          constraint,
          table,
        },
      },
      modelName: table,
    },
  });
}

describe("uniqueViolationTargets, driver-adapter shape", () => {
  it("reads the index name out of `constraint.index`", () => {
    expect(uniqueViolationTargets(adapterP2002({ index: "User_email_key" }))).toEqual([
      "user_email_key",
    ]);
  });

  it("reads a column list out of `constraint.fields`", () => {
    expect(uniqueViolationTargets(adapterP2002({ fields: ["userId", "guestLocalId"] }))).toEqual([
      "userid",
      "guestlocalid",
    ]);
  });

  it("accepts a bare string constraint", () => {
    expect(uniqueViolationTargets(adapterP2002("Bike_userId_guestLocalId_key"))).toEqual([
      "bike_userid_guestlocalid_key",
    ]);
  });

  it.each([
    ["no constraint key", adapterP2002(undefined)],
    ["a constraint that is a number", adapterP2002(42)],
    ["fields that are not strings", adapterP2002({ fields: [1, 2] })],
    ["an adapter error with no cause", { code: "P2002", meta: { driverAdapterError: {} } }],
    [
      "a cause that is not an object",
      { code: "P2002", meta: { driverAdapterError: { cause: 1 } } },
    ],
    ["a driverAdapterError that is a string", { code: "P2002", meta: { driverAdapterError: "x" } }],
    ["no meta at all", { code: "P2002" }],
  ])("is empty for %s", (_label, error) => {
    expect(uniqueViolationTargets(error)).toEqual([]);
  });

  it("still prefers `meta.target` when the engine does fill it", () => {
    const both = Object.assign(adapterP2002({ index: "User_email_key" }), {
      meta: { ...adapterP2002({ index: "User_email_key" }).meta, target: ["email"] },
    });
    expect(uniqueViolationTargets(both)).toEqual(["email"]);
  });
});

describe("isUniqueViolation, driver-adapter shape", () => {
  it("matches `email` through the index name — the sign-up conflict path", () => {
    expect(isUniqueViolation(adapterP2002({ index: "User_email_key" }), "email")).toBe(true);
  });

  it("matches a compound index by one of its columns", () => {
    const error = adapterP2002({ index: "Bike_userId_guestLocalId_key" }, "Bike");
    expect(isUniqueViolation(error, "guestLocalId")).toBe(true);
  });

  it("does not confuse two unique indexes on the same table", () => {
    expect(isUniqueViolation(adapterP2002({ index: "Checkup_guestKey_key" }), "email")).toBe(false);
  });

  it("is still true without a field, and still false for another code", () => {
    expect(isUniqueViolation(adapterP2002({ index: "User_email_key" }))).toBe(true);
    expect(isUniqueViolation({ code: "P2003", meta: { driverAdapterError: {} } }, "email")).toBe(
      false,
    );
  });
});
