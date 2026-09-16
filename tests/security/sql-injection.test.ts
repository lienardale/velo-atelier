/**
 * THREAT — SQL injection.
 *
 * Prisma's query builder parameterises everything, so the only way to reach a
 * string-concatenated statement in this codebase is to call one of the four
 * escape hatches. The primary control is therefore a **grep over the tree**:
 * `$queryRawUnsafe`, `$executeRawUnsafe` and a template-free `$queryRaw(` /
 * `$executeRaw(` call must not exist at all (§7.6 AC3).
 *
 * The second control is behavioural: the values that reach a `where` clause on
 * the auth surface — the e-mail address above all — are passed as values, so a
 * classic payload matches nothing rather than matching everything. That is
 * asserted against the schema-driven fake, which fails loudly on anything it
 * cannot model instead of quietly returning a plausible row.
 *
 * CONTROLS PINNED
 *
 *   1. no `*Unsafe` raw helper anywhere in `app/`, `lib/`, `components/`,
 *      `prisma/` or `scripts/`;
 *   2. a raw call, if one is ever added, must be a tagged template (the
 *      parameterised form), never a function call on a built string;
 *   3. `' OR 1=1 --` as an e-mail signs nobody in and returns no row;
 *   4. an injected payload is stored and compared as a literal — a user whose
 *      address really contains a quote is found, and only that user;
 *   5. the fake records the payload as an argument, not as SQL: the recorded
 *      `where` still has the payload in a value position.
 */
/* eslint-disable security/detect-non-literal-fs-filename -- every path read here is derived from `import.meta.url`, never from input */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

import { beforeEach, describe, expect, it, vi } from "vitest";

import { authorizeCredentials } from "@/lib/auth/authorize";
import { hashPassword } from "@/lib/auth/password";
import { allowAllRateLimiter } from "@/lib/security/rate-limit";
import { fakeDb } from "@/tests/_fakes/prisma";
import { sameOriginHeaders, setRequestHeaders, setSession } from "@/tests/_fakes/session";

vi.mock("@/auth", async () => (await import("@/tests/_fakes/session")).authModule());

const { signUpAction } = await import("@/app/[locale]/(auth)/inscription/actions");
const { IDLE } = await import("@/lib/actions/result");

const PASSWORD = "Guidon-Tandem-47!";

const PAYLOADS = [
  "' OR 1=1 --",
  "admin'--",
  '\'; DROP TABLE "User"; --',
  '\' UNION SELECT * FROM "User" --',
  '" OR ""="',
  '\\\'; DELETE FROM "Bike"; --',
  "camille@velo-atelier.test' --",
] as const;

const ROOT = new URL("../../", import.meta.url).pathname;

function sourceFiles(roots: readonly string[]): string[] {
  const files: string[] = [];
  const walk = (dir: string) => {
    for (const entry of readdirSync(dir)) {
      if (entry === "node_modules" || entry === "generated" || entry.startsWith(".")) continue;
      const full = join(dir, entry);
      if (statSync(full).isDirectory()) walk(full);
      // Test files are excluded: they *name* the helpers on purpose.
      else if (/\.(ts|tsx)$/.test(entry) && !/\.test\.tsx?$/.test(entry)) files.push(full);
    }
  };
  for (const root of roots) walk(join(ROOT, root));
  return files;
}

/** Source with comments removed, so a docblock naming a helper is not a hit. */
function code(file: string): string {
  return readFileSync(file, "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .split("\n")
    .map((line) => line.replace(/\/\/.*$/, ""))
    .join("\n");
}

const TREE = ["app", "lib", "components", "prisma", "scripts"] as const;

function form(fields: Record<string, string>): FormData {
  const data = new FormData();
  for (const [key, value] of Object.entries(fields)) data.append(key, value);
  return data;
}

beforeEach(() => {
  fakeDb.reset();
  setRequestHeaders(sameOriginHeaders());
  setSession(null);
});

describe("the tree", () => {
  it("contains no $queryRawUnsafe or $executeRawUnsafe", () => {
    const offenders = sourceFiles(TREE)
      .filter((file) => /\$(query|execute)RawUnsafe/.test(code(file)))
      .map((file) => file.slice(ROOT.length));

    expect(offenders).toEqual([]);
  });

  it("contains no raw call built from a string (only tagged templates are safe)", () => {
    // `prisma.$queryRaw\`…\`` is parameterised; `prisma.$queryRaw(sql)` is not.
    const offenders = sourceFiles(TREE)
      .filter((file) => /\$(query|execute)Raw\s*\(/.test(code(file)))
      .map((file) => file.slice(ROOT.length));

    expect(offenders).toEqual([]);
  });

  it("never builds a where clause by string concatenation", () => {
    const offenders = sourceFiles(TREE)
      .filter((file) =>
        // Word-bounded and followed by whitespace, so `querySelector(`\`[x="${id}"]\`)`
        // is not read as a SELECT statement.
        /\b(SELECT\s|INSERT\s+INTO\s|UPDATE\s+"|DELETE\s+FROM\s)[^\n]*\$\{/i.test(code(file)),
      )
      .map((file) => file.slice(ROOT.length));

    expect(offenders).toEqual([]);
  });
});

describe("sign-in", () => {
  beforeEach(async () => {
    await fakeDb.seed("User", {
      email: "camille@velo-atelier.test",
      locale: "fr",
      passwordHash: await hashPassword(PASSWORD, 4),
    });
  });

  it.each(PAYLOADS)("signs nobody in for the address %j", async (payload) => {
    const result = await authorizeCredentials(
      { email: payload, password: PASSWORD },
      {
        prisma: fakeDb.client,
        rateLimiter: allowAllRateLimiter,
        ip: "local",
        isProduction: false,
      },
    );

    expect(result).toBeNull();
    // The row is still there: nothing was dropped, nothing was deleted.
    expect(fakeDb.rows("User")).toHaveLength(1);
  });

  it("passes the payload as a VALUE, not as SQL", async () => {
    fakeDb.resetCalls();
    await authorizeCredentials(
      { email: "' OR 1=1 --", password: PASSWORD },
      { prisma: fakeDb.client, rateLimiter: allowAllRateLimiter, ip: "local", isProduction: false },
    );

    const lookup = fakeDb.calls.find((call) => call.model === "user" && call.op === "findUnique");
    expect(lookup?.args).toMatchObject({ where: { email: "' or 1=1 --" } });
  });
});

describe("sign-up", () => {
  it("treats an injected address as a literal that simply is not a valid e-mail", async () => {
    const result = await signUpAction(
      IDLE,
      form({ email: "' OR 1=1 --", password: PASSWORD, locale: "fr" }),
    );

    expect(result).toMatchObject({
      ok: false,
      code: "VALIDATION",
      fieldErrors: { email: "errors.emailInvalid" },
    });
    expect(fakeDb.rows("User")).toHaveLength(0);
  });

  it("stores an address that legitimately contains a quote, and finds only it", async () => {
    // RFC 5321 allows it in a quoted local part; `citext` compares it literally.
    const email = "o'connor@velo-atelier.test";
    await fakeDb.seed("User", {
      email,
      locale: "fr",
      passwordHash: await hashPassword(PASSWORD, 4),
    });
    await fakeDb.seed("User", {
      email: "autre@velo-atelier.test",
      locale: "fr",
      passwordHash: await hashPassword(PASSWORD, 4),
    });

    const found = await authorizeCredentials(
      { email, password: PASSWORD },
      { prisma: fakeDb.client, rateLimiter: allowAllRateLimiter, ip: "local", isProduction: false },
    );

    expect(found).toMatchObject({ email });
    expect(fakeDb.rows("User")).toHaveLength(2);
  });
});
