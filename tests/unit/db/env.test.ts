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

    it("reports every problem at once", () => {
      let error: unknown;
      try {
        parseEnv(prod({ AUTH_GOOGLE_ID: undefined, AUTH_SECRET: "short" }));
      } catch (caught) {
        error = caught;
      }
      expect(error).toBeInstanceOf(EnvValidationError);
      expect((error as EnvValidationError).issues.map((i) => i.path)).toContain("AUTH_SECRET");
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
   * production server. Both directions are pinned here, in both scopes,
   * because a rule with one untested direction is half a rule.
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
      // and from nothing else. This is the shape the live Preview scope has.
      expect(parseEnv(deployed("preview", { AUTH_URL: undefined })).isProduction).toBe(false);
      expect(() => parseEnv(deployed("preview", { AUTH_SECRET: "short" }))).toThrow(/AUTH_SECRET/);
      expect(() => parseEnv(deployed("preview", { POSTGRES_URL_NON_POOLING: undefined }))).toThrow(
        /POSTGRES_URL_NON_POOLING/,
      );
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
