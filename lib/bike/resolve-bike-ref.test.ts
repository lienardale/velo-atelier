import { describe, expect, it } from "vitest";

import { isNotFoundInterrupt } from "@/tests/_fakes/session";

import {
  bikeRefParam,
  isBikeUuid,
  isGuestRef,
  parseBikeRef,
  resolveBikeRef,
} from "./resolve-bike-ref";

const UUID = "3f2504e0-4f89-41d3-9a0c-0305e82c3301";

describe("parseBikeRef", () => {
  it("knows the two reserved words", () => {
    expect(parseBikeRef("demo")).toEqual({ kind: "demo" });
    expect(parseBikeRef("local")).toEqual({ kind: "local" });
  });

  it("accepts a v4 UUID", () => {
    expect(parseBikeRef(UUID)).toEqual({ kind: "db", id: UUID });
  });

  it.each([
    ["not-a-uuid", "a word"],
    ["", "the empty string"],
    ["DEMO", "the reserved word in capitals"],
    [`${UUID}\n`, "a trailing newline"],
    [` ${UUID}`, "a leading space"],
    ["3F2504E0-4F89-41D3-9A0C-0305E82C3301", "an upper-case UUID"],
    ["00000000-0000-0000-0000-000000000000", "the nil UUID"],
    ["3f2504e0-4f89-11d3-9a0c-0305e82c3301", "a v1 UUID"],
    ["3f2504e0-4f89-41d3-ca0c-0305e82c3301", "an invalid variant"],
    ["../../etc/passwd", "a traversal attempt"],
    ["3f2504e0-4f89-41d3-9a0c-0305e82c3301/..", "a UUID with a path suffix"],
  ])("refuses %s (%s)", (input) => {
    expect(parseBikeRef(input)).toBeNull();
  });

  it("refuses anything that is not a string", () => {
    for (const value of [undefined, null, 42, {}, ["demo"]]) {
      expect(parseBikeRef(value)).toBeNull();
    }
  });

  it("agrees with isBikeUuid", () => {
    expect(isBikeUuid(UUID)).toBe(true);
    expect(isBikeUuid("demo")).toBe(false);
  });
});

describe("resolveBikeRef", () => {
  it("returns the ref when there is one", () => {
    expect(resolveBikeRef("demo")).toEqual({ kind: "demo" });
    expect(resolveBikeRef(UUID)).toEqual({ kind: "db", id: UUID });
  });

  it("is a 404 when there is not", () => {
    // `tests/setup.ts` turns `notFound()` into a tagged throw.
    let thrown: unknown;
    try {
      resolveBikeRef("nope");
    } catch (error) {
      thrown = error;
    }
    expect(isNotFoundInterrupt(thrown)).toBe(true);
  });
});

describe("bikeRefParam", () => {
  it("round-trips every ref", () => {
    for (const id of ["demo", "local", UUID]) {
      expect(bikeRefParam(parseBikeRef(id)!)).toBe(id);
    }
  });

  it("tells guest bikes from saved ones", () => {
    expect(isGuestRef({ kind: "demo" })).toBe(true);
    expect(isGuestRef({ kind: "local" })).toBe(true);
    expect(isGuestRef({ kind: "db", id: UUID })).toBe(false);
  });
});
