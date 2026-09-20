/**
 * `siteUrl()` — the origin `app/sitemap.ts`, `app/robots.ts` and the guide's
 * `TechArticle` node concatenate paths onto (§6.6).
 *
 * Every caller writes `${siteUrl()}${path}`, and every `path` already starts
 * with `/`. So a trailing slash on `NEXT_PUBLIC_SITE_URL` — which is how the
 * variable is spelled about half the time, and which Vercel accepts — would
 * put `https://host//fr` in a `<loc>`, a canonical and a `Sitemap:` line. The
 * e2e suites cannot see it: they run with a value that has no trailing slash.
 */
import { afterEach, describe, expect, it } from "vitest";

import { siteUrl } from "@/lib/seo/metadata";

const ORIGINAL = process.env.NEXT_PUBLIC_SITE_URL;

afterEach(() => {
  if (ORIGINAL === undefined) delete process.env.NEXT_PUBLIC_SITE_URL;
  else process.env.NEXT_PUBLIC_SITE_URL = ORIGINAL;
});

describe("siteUrl", () => {
  it("is NEXT_PUBLIC_SITE_URL, without a trailing slash", () => {
    process.env.NEXT_PUBLIC_SITE_URL = "https://velo-atelier.fr";
    expect(siteUrl()).toBe("https://velo-atelier.fr");

    process.env.NEXT_PUBLIC_SITE_URL = "https://velo-atelier.fr/";
    expect(siteUrl()).toBe("https://velo-atelier.fr");

    process.env.NEXT_PUBLIC_SITE_URL = "https://velo-atelier.fr///";
    expect(siteUrl()).toBe("https://velo-atelier.fr");
  });

  it("falls back to the dev origin, so a local build is not half-absolute", () => {
    delete process.env.NEXT_PUBLIC_SITE_URL;
    expect(siteUrl()).toBe("http://localhost:3000");
  });

  it("concatenates with a path the way its callers do", () => {
    process.env.NEXT_PUBLIC_SITE_URL = "https://velo-atelier.fr/";
    expect(`${siteUrl()}/fr/guides`).toBe("https://velo-atelier.fr/fr/guides");
  });
});
