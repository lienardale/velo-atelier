/**
 * Environment resolution — `lib/db/env.ts` and `lib/env.ts`.
 *
 * These two modules are the only places that read raw environment variables,
 * so they are the only places a typo can turn into a silent wrong answer:
 * a missing URL that resolves to `undefined` and connects to a default, a
 * pooled URL used for a migration, a production deploy shipping the dev-only
 * test pages. Every one of those has a case below.
 */

import { afterEach, describe, expect, it, vi } from "vitest";

import { MissingDatabaseUrlError, getDatabaseUrls, readDatabaseUrls } from "@/lib/db/env";
import { EnvValidationError, type EnvSource, getEnv, parseEnv, resetEnvCache } from "@/lib/env";

const POOLED = "postgresql://velo:velo@localhost:5432/velo_atelier";
const DIRECT = "postgresql://velo:velo@localhost:5433/velo_atelier";

/** A minimal environment that parses, so each case changes exactly one thing. */
function validEnv(overrides: EnvSource = {}): EnvSource {
  return {
    NODE_ENV: "development",
    POSTGRES_URL: POOLED,
    POSTGRES_URL_NON_POOLING: DIRECT,
    AUTH_SECRET: "x".repeat(32),
    NEXT_PUBLIC_SITE_URL: "http://localhost:3000",
    ...overrides,
  };
}

describe("getDatabaseUrls", () => {
  it("prefers the POSTGRES_* names", () => {
    expect(
      getDatabaseUrls({
        POSTGRES_URL: POOLED,
        POSTGRES_URL_NON_POOLING: DIRECT,
        DATABASE_URL: "postgresql://neon/pooled",
        DATABASE_URL_UNPOOLED: "postgresql://neon/direct",
      }),
    ).toEqual({ pooled: POOLED, direct: DIRECT });
  });

  it("falls back to Neon's own DATABASE_URL names", () => {
    expect(getDatabaseUrls({ DATABASE_URL: POOLED, DATABASE_URL_UNPOOLED: DIRECT })).toEqual({
      pooled: POOLED,
      direct: DIRECT,
    });
  });

  it("treats a blank value as unset", () => {
    expect(() =>
      getDatabaseUrls({ POSTGRES_URL: "   ", POSTGRES_URL_NON_POOLING: DIRECT }),
    ).toThrow(MissingDatabaseUrlError);
  });

  it("names the missing variable", () => {
    expect(() => getDatabaseUrls({ POSTGRES_URL_NON_POOLING: DIRECT })).toThrow(/POSTGRES_URL/);
    expect(() => getDatabaseUrls({ POSTGRES_URL: POOLED })).toThrow(/POSTGRES_URL_NON_POOLING/);
  });

  it("never falls back from the direct URL to the pooled one", () => {
    // A migration run through a transaction pooler fails in ways that only
    // show up in production, so the two URLs stay strictly independent.
    let error: unknown;
    try {
      getDatabaseUrls({ POSTGRES_URL: POOLED });
    } catch (caught) {
      error = caught;
    }
    expect(error).toBeInstanceOf(MissingDatabaseUrlError);
    expect((error as MissingDatabaseUrlError).variable).toBe("POSTGRES_URL_NON_POOLING");
  });

  it("trims surrounding whitespace", () => {
    expect(
      getDatabaseUrls({ POSTGRES_URL: ` ${POOLED} `, POSTGRES_URL_NON_POOLING: DIRECT }),
    ).toEqual({ pooled: POOLED, direct: DIRECT });
  });
});

describe("readDatabaseUrls", () => {
  it("returns undefined instead of throwing", () => {
    // `prisma generate` runs as a postinstall hook with no environment at all;
    // prisma.config.ts must survive that.
    expect(readDatabaseUrls({})).toEqual({ pooled: undefined, direct: undefined });
  });

  it("returns whichever URL is configured", () => {
    expect(readDatabaseUrls({ POSTGRES_URL_NON_POOLING: DIRECT })).toEqual({
      pooled: undefined,
      direct: DIRECT,
    });
  });
});

describe("parseEnv", () => {
  it("accepts a complete development environment", () => {
    const env = parseEnv(validEnv());
    expect(env.isProduction).toBe(false);
    expect(env.BCRYPT_COST).toBe(12);
    expect(env.AUTH_TRUST_HOST).toBe(false);
  });

  it("rejects a short AUTH_SECRET", () => {
    expect(() => parseEnv(validEnv({ AUTH_SECRET: "too-short" }))).toThrow(EnvValidationError);
  });

  it("rejects a non-postgres database URL", () => {
    expect(() => parseEnv(validEnv({ POSTGRES_URL: "mysql://host/db" }))).toThrow(/POSTGRES_URL/);
  });

  it("rejects a NEXT_PUBLIC_SITE_URL that is not a URL", () => {
    expect(() => parseEnv(validEnv({ NEXT_PUBLIC_SITE_URL: "localhost:3000" }))).toThrow(
      EnvValidationError,
    );
  });

  it("coerces BCRYPT_COST and clamps it to a usable range", () => {
    expect(parseEnv(validEnv({ BCRYPT_COST: "4" })).BCRYPT_COST).toBe(4);
    expect(() => parseEnv(validEnv({ BCRYPT_COST: "2" }))).toThrow(EnvValidationError);
    expect(() => parseEnv(validEnv({ BCRYPT_COST: "20" }))).toThrow(EnvValidationError);
  });

  it("reads 1 / true / yes as an enabled flag and everything else as off", () => {
    expect(parseEnv(validEnv({ AUTH_TRUST_HOST: "true" })).AUTH_TRUST_HOST).toBe(true);
    expect(parseEnv(validEnv({ AUTH_TRUST_HOST: "1" })).AUTH_TRUST_HOST).toBe(true);
    // The title named `yes` long before a case tried it (found in review,
    // 2026-10-06: dropping it from `flag` left every test green).
    expect(parseEnv(validEnv({ AUTH_TRUST_HOST: "yes" })).AUTH_TRUST_HOST).toBe(true);
    expect(parseEnv(validEnv({ AUTH_TRUST_HOST: "YES" })).AUTH_TRUST_HOST).toBe(true);
    expect(parseEnv(validEnv({ AUTH_TRUST_HOST: "0" })).AUTH_TRUST_HOST).toBe(false);
    expect(parseEnv(validEnv({ AUTH_TRUST_HOST: "" })).AUTH_TRUST_HOST).toBe(false);
  });

  it("treats an empty optional string as unset", () => {
    // `.env.example` ships `AUTH_GOOGLE_ID=` — that is "not configured",
    // not "configured as the empty string".
    expect(parseEnv(validEnv({ AUTH_GOOGLE_ID: "" })).AUTH_GOOGLE_ID).toBeUndefined();
  });

  describe("production", () => {
    const prod = (overrides: EnvSource = {}) =>
      validEnv({
        NODE_ENV: "production",
        VERCEL_ENV: "production",
        AUTH_URL: "https://velo-atelier.example",
        AUTH_GOOGLE_ID: "google-id",
        AUTH_GOOGLE_SECRET: "google-secret",
        ...overrides,
      });

    it("accepts a complete production environment", () => {
      expect(parseEnv(prod()).isProduction).toBe(true);
    });

    it("requires the Google credentials and AUTH_URL", () => {
      expect(() => parseEnv(prod({ AUTH_GOOGLE_ID: undefined }))).toThrow(/AUTH_GOOGLE_ID/);
      expect(() => parseEnv(prod({ AUTH_GOOGLE_SECRET: undefined }))).toThrow(/AUTH_GOOGLE_SECRET/);
      expect(() => parseEnv(prod({ AUTH_URL: undefined }))).toThrow(/AUTH_URL/);
    });

    it("refuses to boot with the dev-only switches on", () => {
      // ENABLE_TEST_PAGES would expose /dev/bike3d publicly; the test hooks
      // would ship window.__va to every visitor.
      expect(() => parseEnv(prod({ ENABLE_TEST_PAGES: "1" }))).toThrow(/ENABLE_TEST_PAGES/);
      expect(() => parseEnv(prod({ NEXT_PUBLIC_TEST_HOOKS: "1" }))).toThrow(
        /NEXT_PUBLIC_TEST_HOOKS/,
      );
      expect(() => parseEnv(prod({ NEXT_PUBLIC_DEMO_LOGIN: "1" }))).toThrow(
        /NEXT_PUBLIC_DEMO_LOGIN/,
      );
    });

    it("treats a Vercel preview as non-production", () => {
      // Preview has no Google credentials by design — credentials login is the
      // preview test path.
      const env = parseEnv(
        validEnv({ NODE_ENV: "production", VERCEL_ENV: "preview", ENABLE_TEST_PAGES: "" }),
      );
      expect(env.isProduction).toBe(false);
    });

    it("reports every VALUE problem at once (a missing variable stops earlier — see scripts/check-env.ts)", () => {
      // Two problems of different kinds, and BOTH have to be listed: a value
      // the schema refuses (a 5-character secret) and a cross-field rule (the
      // Google id, optional in the schema and required in production). The
      // title used to say "every problem" while the test looked for the secret
      // alone, so a schema that stopped at the first one stayed green.
      //
      // "Every" stops at a variable the SCHEMA requires being absent, or of
      // the wrong type: zod then never reaches the cross-field rules, and one
      // refused build does not name the rest. `scripts/check-env.ts` says so
      // in the build log; `vercel-build-guard.test.ts` executes that case.
      let error: unknown;
      try {
        parseEnv(prod({ AUTH_GOOGLE_ID: undefined, AUTH_SECRET: "short" }));
      } catch (caught) {
        error = caught;
      }
      expect(error).toBeInstanceOf(EnvValidationError);
      const paths = (error as EnvValidationError).issues.map((i) => i.path);
      expect(paths).toContain("AUTH_SECRET");
      expect(paths).toContain("AUTH_GOOGLE_ID");
    });
  });

  /**
   * The three test flags are refused on `VERCEL_ENV` being set, not on
   * `isProduction` (W5).
   *
   * `instrumentation.ts` runs this on every boot, and the `next` CLI defaults
   * NODE_ENV to `production` for `next start`. Keyed off `isProduction`, the
   * contract would refuse to start CI's boot check, Playwright's web server,
   * Lighthouse and perf — all of which start a production build ON PURPOSE
   * with `ENABLE_TEST_PAGES=1`. `VERCEL_ENV` is set by Vercel and by nothing
   * else, so it is the only signal that separates a deployment from a local
   * production server. Both directions are pinned here, in every scope
   * `VERCEL_ENV` can name, because a rule with one untested direction is half
   * a rule.
   */
  describe("the test flags are scoped to a deployment", () => {
    const FLAGS = [
      "ENABLE_TEST_PAGES",
      "NEXT_PUBLIC_TEST_HOOKS",
      "NEXT_PUBLIC_DEMO_LOGIN",
    ] as const;

    const deployed = (scope: string, overrides: EnvSource = {}) =>
      validEnv({
        NODE_ENV: "production",
        VERCEL_ENV: scope,
        AUTH_URL: "https://velo-atelier.example",
        AUTH_GOOGLE_ID: "google-id",
        AUTH_GOOGLE_SECRET: "google-secret",
        ...overrides,
      });

    /** The issue this environment raises for `flag`, or undefined if it parses. */
    const issueFor = (flag: string, source: EnvSource) => {
      try {
        parseEnv(source);
        return undefined;
      } catch (error) {
        return (error as EnvValidationError).issues.find((issue) => issue.path === flag);
      }
    };

    it.each(FLAGS)("refuses %s on a production deployment", (flag) => {
      expect(issueFor(flag, deployed("production", { [flag]: "1" }))?.message).toMatch(
        /deployment/,
      );
    });

    it.each(FLAGS)("refuses %s on a PREVIEW deployment too", (flag) => {
      // A preview URL is public. `isProduction` is false there, so this case
      // only holds because the rule keys off VERCEL_ENV.
      expect(issueFor(flag, deployed("preview", { [flag]: "1" }))?.message).toMatch(/deployment/);
    });

    it.each(FLAGS)("refuses %s on a DEVELOPMENT deployment too", (flag) => {
      // The third value VERCEL_ENV can hold. The rule is "on a deployment",
      // whichever one: an exemption for this scope left every other test green
      // (found in review, 2026-10-06).
      expect(issueFor(flag, deployed("development", { [flag]: "1" }))?.message).toMatch(
        /deployment/,
      );
    });

    it.each(["yes", "YES", "true", "True"])(
      "refuses a flag spelled %s on a deployment, not only 1",
      (spelling) => {
        // `scripts/vercel-build.sh` refuses these spellings of the hooks flag at
        // build time; the contract must not be the more lenient of the two.
        for (const flag of FLAGS) {
          expect(issueFor(flag, deployed("preview", { [flag]: spelling }))).toBeDefined();
        }
      },
    );

    it.each(FLAGS)("allows %s on a local `next start` (NODE_ENV=production, no VERCEL_ENV)", () => {
      // The combination nothing pinned before W5, and the one every browser
      // tier actually runs in.
      const env = parseEnv(
        validEnv({
          NODE_ENV: "production",
          AUTH_URL: "http://localhost:3100",
          AUTH_GOOGLE_ID: "ci-dummy",
          AUTH_GOOGLE_SECRET: "ci-dummy",
          ENABLE_TEST_PAGES: "1",
          NEXT_PUBLIC_TEST_HOOKS: "1",
          NEXT_PUBLIC_DEMO_LOGIN: "1",
        }),
      );
      expect(env.isProduction).toBe(true);
      expect(env.ENABLE_TEST_PAGES).toBe(true);
      expect(env.NEXT_PUBLIC_TEST_HOOKS).toBe(true);
      expect(env.NEXT_PUBLIC_DEMO_LOGIN).toBe(true);
    });

    it("still requires AUTH_URL and the Google pair on that local production server", () => {
      // Scoping the FLAGS to VERCEL_ENV moved nothing else: `isProduction` is
      // still NODE_ENV-driven when Vercel is not in the picture.
      const bare = validEnv({ NODE_ENV: "production" });
      expect(() => parseEnv(bare)).toThrow(/AUTH_URL/);
      expect(() => parseEnv(bare)).toThrow(/AUTH_GOOGLE_ID/);
      expect(() => parseEnv(bare)).toThrow(/AUTH_GOOGLE_SECRET/);
    });

    it("requires AUTH_SECRET and both database URLs on a preview deployment", () => {
      // Preview is non-production, so it is exempt from AUTH_URL and Google —
      // and from nothing else.
      expect(parseEnv(deployed("preview", { AUTH_URL: undefined })).isProduction).toBe(false);
      expect(() => parseEnv(deployed("preview", { AUTH_SECRET: "short" }))).toThrow(/AUTH_SECRET/);
      expect(() => parseEnv(deployed("preview", { POSTGRES_URL_NON_POOLING: undefined }))).toThrow(
        /POSTGRES_URL_NON_POOLING/,
      );
    });

    /**
     * Required means required — in every scope, by exactly these names.
     *
     * Since W5 this schema decides whether a deployment builds and boots, and
     * `docs/deploy.md` calls these four load-bearing. Until this case, the
     * test above was the whole proof: a SHORT secret and one missing URL.
     * Making `POSTGRES_URL`, `AUTH_SECRET` or `NEXT_PUBLIC_SITE_URL` optional
     * left every test green (found in review, 2026-10-06).
     *
     * Asserted on the issue's PATH, not on a pattern over the message:
     * `/POSTGRES_URL/` also matches `POSTGRES_URL_NON_POOLING`.
     */
    it.each(["POSTGRES_URL", "POSTGRES_URL_NON_POOLING", "AUTH_SECRET", "NEXT_PUBLIC_SITE_URL"])(
      "requires %s on a preview and on a production deployment",
      (key) => {
        for (const scope of ["preview", "production"]) {
          // Control: the complete environment raises nothing for this key, so
          // the issue below is about its absence and nothing else.
          expect(issueFor(key, deployed(scope)), `${key}, complete ${scope}`).toBeUndefined();
          expect(
            issueFor(key, deployed(scope, { [key]: undefined })),
            `${key} missing on ${scope}`,
          ).toBeDefined();
        }
      },
    );

    /**
     * The 32-character floor, AT 32.
     *
     * Every "short secret" case in this file uses 5 to 9 characters and the
     * valid fixture is exactly 32, so nothing stood between them: with the
     * floor in `lib/env.ts` lowered to 31, or to 17, the unit and security
     * tiers stayed green (found in review, 2026-10-06). And a 31-character
     * `AUTH_SECRET` is the first example `scripts/vercel-build.sh` gives of
     * what its preflight exists to catch.
     *
     * On the issue's PATH, like the case above, and in both scopes a real
     * deployment builds: the floor is not a production-only rule.
     */
    it.each(["preview", "production"])(
      "holds AUTH_SECRET's floor at exactly 32 characters on a %s deployment",
      (scope) => {
        expect(
          issueFor("AUTH_SECRET", deployed(scope, { AUTH_SECRET: "x".repeat(31) })),
          `31 characters on ${scope}`,
        ).toBeDefined();
        // 32 raises nothing at all — not "nothing for AUTH_SECRET": the rest
        // of `deployed()` is complete, so the whole environment has to parse.
        expect(
          () => parseEnv(deployed(scope, { AUTH_SECRET: "x".repeat(32) })),
          `32 characters on ${scope}`,
        ).not.toThrow();
      },
    );

    it("refuses a VERCEL_ENV it does not know: the enum fails closed", () => {
      // A decision, not an accident (see the comment on VERCEL_ENV in
      // lib/env.ts). Read as "any non-empty string", an unknown value would
      // count as "not production" and silently drop the AUTH_URL and Google
      // requirements — so it is refused instead, by name.
      expect(issueFor("VERCEL_ENV", deployed("staging"))).toBeDefined();

      // Vercel documents a custom environment's name as living in
      // VERCEL_TARGET_ENV, with VERCEL_ENV still one of the three. That shape
      // parses, as the scope VERCEL_ENV names; nothing reads the other one.
      // (The documented shape, not one observed on a deployment.)
      const env = parseEnv(deployed("preview", { VERCEL_TARGET_ENV: "staging" }));
      expect(env.isProduction).toBe(false);
    });

    it("accepts the live Preview scope exactly as docs/deploy.md describes it", () => {
      // Both database URLs, AUTH_SECRET, NEXT_PUBLIC_SITE_URL, AUTH_TRUST_HOST
      // — no AUTH_URL and no Google pair, which Production alone carries.
      // Nothing about this branch may make that deployment refuse to boot.
      const env = parseEnv(
        validEnv({ NODE_ENV: "production", VERCEL_ENV: "preview", AUTH_TRUST_HOST: "true" }),
      );
      expect(env.isProduction).toBe(false);
      expect(env.AUTH_URL).toBeUndefined();
      expect(env.AUTH_GOOGLE_ID).toBeUndefined();
    });

    it("ignores the variables a platform injects", () => {
      // The schema is `z.object`, not `.strict()`, and it must stay that way:
      // a deployment's environment holds dozens of VERCEL_*, CI and runtime
      // variables this file knows nothing about. Strict, `getEnv()` would
      // refuse every deployment there is — and, before W5, nothing called it,
      // so nothing would have noticed.
      expect(() =>
        parseEnv(
          validEnv({
            VERCEL: "1",
            VERCEL_URL: "velo-atelier-abc123.vercel.app",
            VERCEL_GIT_COMMIT_SHA: "0123456789abcdef",
            AWS_LAMBDA_FUNCTION_NAME: "whatever",
          }),
        ),
      ).not.toThrow();
    });
  });
});

describe("getEnv", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    resetEnvCache();
  });

  function stubValidEnv(): void {
    for (const [key, value] of Object.entries(validEnv())) {
      if (value !== undefined) vi.stubEnv(key, value);
    }
  }

  it("validates process.env once and memoises the result", () => {
    stubValidEnv();
    const first = getEnv();

    // A later change is not observed until the cache is reset: the contract
    // is "validated at boot", not "re-read on every call".
    vi.stubEnv("BCRYPT_COST", "5");
    expect(getEnv()).toBe(first);

    resetEnvCache();
    expect(getEnv().BCRYPT_COST).toBe(5);
  });

  it("throws on first use when process.env is invalid", () => {
    stubValidEnv();
    vi.stubEnv("AUTH_SECRET", "short");
    expect(() => getEnv()).toThrow(EnvValidationError);
  });
});
