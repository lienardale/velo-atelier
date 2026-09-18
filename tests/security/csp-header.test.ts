/**
 * THREAT — a development convenience reaching production.
 *
 * `script-src` gains `'unsafe-eval'` outside production so React's dev build can
 * use its debugging features (`lib/security/csp.ts`). That is the only
 * difference, and it is exactly the kind of difference that quietly ships: the
 * whole reason MDX is compiled at build time is that no guide body should ever
 * be evaluated in a browser, and `next.config.ts` serves a static CSP because a
 * nonce would force every route dynamic.
 *
 * So the production policy is pinned here character for character, and the two
 * variants are asserted to differ in nothing else. `tests/e2e/guides.spec.ts`
 * checks the same absence on the real header of a real production build; this
 * one fails in milliseconds, before anyone waits for a browser.
 */
import { describe, expect, it } from "vitest";

import { contentSecurityPolicy, isProductionBuild } from "@/lib/security/csp";

const PRODUCTION =
  "default-src 'self'; " +
  "script-src 'self' 'unsafe-inline'; " +
  "style-src 'self' 'unsafe-inline'; " +
  "img-src 'self' data: https://lh3.googleusercontent.com; " +
  "font-src 'self'; " +
  "connect-src 'self'; " +
  "frame-ancestors 'none'; " +
  "object-src 'none'; " +
  "base-uri 'self'; " +
  "form-action 'self'";

describe("Content-Security-Policy", () => {
  it("is exactly this in production", () => {
    expect(contentSecurityPolicy("production")).toBe(PRODUCTION);
  });

  it("never allows eval in production", () => {
    expect(contentSecurityPolicy("production")).not.toContain("unsafe-eval");
  });

  for (const nodeEnv of ["development", "test", undefined]) {
    it(`allows eval outside production (NODE_ENV=${String(nodeEnv)})`, () => {
      const policy = contentSecurityPolicy(nodeEnv);
      expect(policy).toContain("script-src 'self' 'unsafe-inline' 'unsafe-eval'");
      // …and differs from production in NOTHING else.
      expect(policy.replace(" 'unsafe-eval'", "")).toBe(PRODUCTION);
    });
  }

  it('treats only the exact string "production" as production', () => {
    // A typo or a "Production" from some host must fail CLOSED for the app's
    // behaviour, but this switch fails OPEN (it would add unsafe-eval), so the
    // comparison has to stay exact rather than fuzzy.
    expect(isProductionBuild("production")).toBe(true);
    expect(isProductionBuild("Production")).toBe(false);
    expect(isProductionBuild("prod")).toBe(false);
  });
});
