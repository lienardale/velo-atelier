/**
 * The contract of `types.ts` against the two things it has to agree with: the
 * database that stores a checkup and the domain vocabulary that produces one.
 *
 * Read from `prisma/schema.prisma` rather than from the generated client, so
 * the assertion is against the source of truth and holds on a checkout where
 * `prisma generate` has not run. `inspect-shop` ↔ `INSPECT_SHOP` is the only
 * spelling difference: Prisma enum members cannot contain a hyphen.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { KO_ACTIONS } from "@/lib/domain/schema/procedure";

import { CHECKUP_ANSWERS, CHECKUP_STATE_VERSION } from "./types";

/** The members of `enum <name>` in the Prisma schema, in declaration order. */
function prismaEnum(name: string): string[] {
  const schema = readFileSync(join(process.cwd(), "prisma", "schema.prisma"), "utf8");
  // eslint-disable-next-line security/detect-non-literal-regexp -- `name` is a literal at every call site
  const block = new RegExp(`^enum ${name} \\{$([\\s\\S]*?)^\\}$`, "m").exec(schema);
  if (!block) throw new Error(`prisma/schema.prisma has no "enum ${name}"`);
  return block[1]
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0 && !line.startsWith("/"));
}

const toContractSpelling = (member: string) => member.toLowerCase().replace(/_/g, "-");

describe("the checkup contract and the database agree", () => {
  it("answers are Prisma's CheckupResult", () => {
    expect([...CHECKUP_ANSWERS].sort()).toEqual(
      prismaEnum("CheckupResult").map(toContractSpelling).sort(),
    );
  });

  it("build-list actions are Prisma's BuildAction, which is the domain's KO actions", () => {
    const stored = prismaEnum("BuildAction").map(toContractSpelling).sort();
    expect(stored).toEqual([...KO_ACTIONS].sort());
    // The hyphen is the whole reason the mapping exists — pin it.
    expect(prismaEnum("BuildAction")).toContain("INSPECT_SHOP");
    expect(stored).toContain("inspect-shop");
  });

  it("scopes are Prisma's CheckupScope", () => {
    // `CheckupScope` is a discriminated union here and an enum there: the two
    // kinds must still be the same two.
    expect(prismaEnum("CheckupScope").map(toContractSpelling).sort()).toEqual(["full", "partial"]);
  });
});

describe("the stored shape is versioned", () => {
  it("is at version 1, the version lib/bike/storage-keys.ts documents", () => {
    expect(CHECKUP_STATE_VERSION).toBe(1);
    const keys = readFileSync(join(process.cwd(), "lib", "bike", "storage-keys.ts"), "utf8");
    expect(keys).toContain("va:checkup:");
  });
});
