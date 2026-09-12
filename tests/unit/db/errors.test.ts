/**
 * `lib/db/errors.ts` — structural narrowing of Prisma errors.
 *
 * Plain objects stand in for `PrismaClientKnownRequestError`: the helpers are
 * deliberately structural (see the module header), so the fake is exactly
 * what they must accept — and the integration suite exercises a real P2002
 * against Postgres (tests/integration/schema.test.ts).
 */

import { describe, expect, it } from "vitest";

import {
  isKnownPrismaError,
  isNotFoundError,
  isUniqueViolation,
  uniqueViolationTargets,
} from "@/lib/db/errors";

const p2002 = (target?: unknown) =>
  Object.assign(new Error("Unique"), { code: "P2002", meta: { target } });

describe("isKnownPrismaError", () => {
  it("recognises a P-code error", () => {
    expect(isKnownPrismaError({ code: "P2002" })).toBe(true);
    expect(isKnownPrismaError(p2002())).toBe(true);
  });

  it.each([
    ["null", null],
    ["a string", "P2002"],
    ["an error without a code", new Error("boom")],
    ["a non-string code", { code: 2002 }],
    ["a Node system error code", { code: "ECONNREFUSED" }],
    ["a Postgres SQLSTATE", { code: "23505" }],
  ])("rejects %s", (_label, value) => {
    expect(isKnownPrismaError(value)).toBe(false);
  });
});

describe("isUniqueViolation", () => {
  it("is true for any P2002 without a field", () => {
    expect(isUniqueViolation(p2002(["email"]))).toBe(true);
  });

  it("matches the constraint's column when a field is given", () => {
    expect(isUniqueViolation(p2002(["email"]), "email")).toBe(true);
    expect(isUniqueViolation(p2002(["userId", "guestLocalId"]), "guestLocalId")).toBe(true);
  });

  it("accepts a constraint name as target (driver adapters report it that way)", () => {
    expect(isUniqueViolation(p2002("User_email_key"), "email")).toBe(true);
  });

  it("does not confuse two unique indexes", () => {
    expect(isUniqueViolation(p2002(["guestKey"]), "email")).toBe(false);
  });

  it("is false when the target is unknown and a field is required", () => {
    expect(isUniqueViolation(p2002(undefined), "email")).toBe(false);
  });

  it("is false for other codes and non-errors", () => {
    expect(isUniqueViolation({ code: "P2025" })).toBe(false);
    expect(isUniqueViolation(new Error("P2002"))).toBe(false);
    expect(isUniqueViolation(undefined)).toBe(false);
  });
});

describe("uniqueViolationTargets", () => {
  it("lowercases and keeps only strings", () => {
    expect(uniqueViolationTargets(p2002(["userId", 3, "guestLocalId"]))).toEqual([
      "userid",
      "guestlocalid",
    ]);
  });

  it("is empty for anything but P2002", () => {
    expect(uniqueViolationTargets({ code: "P2025", meta: { target: ["email"] } })).toEqual([]);
    expect(uniqueViolationTargets(p2002({ unexpected: true }))).toEqual([]);
  });
});

describe("isNotFoundError", () => {
  it("is true only for P2025", () => {
    expect(isNotFoundError({ code: "P2025" })).toBe(true);
    expect(isNotFoundError({ code: "P2002" })).toBe(false);
    expect(isNotFoundError(new Error("not found"))).toBe(false);
  });
});
