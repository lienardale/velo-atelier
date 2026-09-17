/**
 * Guide pages (§6.2, §5.2) — one guide per kind that exists on disk, in FR and
 * EN, against the production build.
 *
 * The guides are read from `content/guides/` with the same frontmatter parser
 * the build uses, so W2-T4's guides join this spec with no edit: the first
 * guide of each kind is tested, and an `adjust` guide must show a
 * `[data-testid=measure-figure]` (§7.2).
 *
 * What a guide page promises:
 *   - 200, `<html lang>`, the frontmatter title as `<h1>`, the kind badge;
 *   - every step, in frontmatter order, with its heading and anchor, and a
 *     table of contents linking to each;
 *   - the tools with their stand-ins, the "which bikes" banner, safety notes;
 *   - step illustrations as `svg[role=img]` named by their alt text;
 *   - canonical + hreflang, the static CSP without `unsafe-eval`, no console
 *     error — the MDX was rendered on the server, not evaluated in the browser;
 *   - a static PNG Open Graph image; an unknown slug is a real 404.
 */
/* eslint-disable security/detect-object-injection, security/detect-non-literal-fs-filename, security/detect-non-literal-regexp -- locale-keyed catalogues, fixed content paths, patterns built from repo slugs */
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { parseFrontmatter } from "../../lib/content/frontmatter";
import { GuideFrontmatterSchema } from "../../lib/content/schema";
import type { GuideFrontmatter } from "../../lib/content/types";
import enGuides from "../../messages/en/guides.json";
import enIllustrations from "../../messages/en/illustrations.json";
import enTools from "../../messages/en/tools.json";
import frGuides from "../../messages/fr/guides.json";
import frIllustrations from "../../messages/fr/illustrations.json";
import frTools from "../../messages/fr/tools.json";

import { expect, forEachLocale, href, test, type Locale } from "./_fixtures";

const GUIDES_DIR = join(process.cwd(), "content", "guides");
const GUIDES_T = { fr: frGuides, en: enGuides };
const TOOLS_T = { fr: frTools, en: enTools } as unknown as Record<
  Locale,
  Record<string, { label: string }>
>;
const ILL_T = { fr: frIllustrations, en: enIllustrations } as unknown as Record<
  Locale,
  Record<string, { alt: string }>
>;

function readGuide(slug: string, locale: Locale): GuideFrontmatter {
  const parsed = parseFrontmatter(readFileSync(join(GUIDES_DIR, slug, `${locale}.mdx`), "utf8"));
  return GuideFrontmatterSchema.parse(parsed?.data);
}

/**
 * The first FULL guide (by slug) of every kind on disk. A stub renders a single
 * step body by design (§5.7), so it cannot stand for "renders every step".
 */
const onePerKind = new Map<string, string>();
for (const slug of readdirSync(GUIDES_DIR).sort()) {
  const kind = slug.split("-")[0];
  if (!onePerKind.has(kind) && readGuide(slug, "fr").status === "full") {
    onePerKind.set(kind, slug);
  }
}

forEachLocale((locale) => {
  const t = GUIDES_T[locale];

  for (const [kind, slug] of onePerKind) {
    test(`${kind} guide renders every step, tools and aids (${locale}: ${slug})`, async ({
      page,
    }) => {
      const guide = readGuide(slug, locale);
      const errors: string[] = [];
      page.on("console", (message) => {
        if (message.type() === "error") errors.push(message.text());
      });
      page.on("pageerror", (error) => errors.push(error.message));

      const response = await page.goto(href(locale, "/guides/[slug]", { slug }));
      expect(response?.status()).toBe(200);
      const csp = response?.headers()["content-security-policy"] ?? "";
      expect(csp).toContain("script-src 'self' 'unsafe-inline'");
      expect(csp).not.toContain("unsafe-eval");

      await expect(page.locator("html")).toHaveAttribute("lang", locale);
      await expect(page.getByRole("heading", { level: 1 })).toHaveText(guide.title);
      await expect(page.locator("header [data-kind]")).toHaveText(t.kinds[guide.kind]);
      await expect(page).toHaveTitle(
        new RegExp(`^${guide.title.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`),
      );

      // Steps, in order, each with its anchor.
      const steps = page.locator("[data-step-id]");
      await expect(steps).toHaveCount(guide.steps.length);
      expect(
        await steps.evaluateAll((nodes) => nodes.map((n) => n.getAttribute("data-step-id"))),
      ).toEqual(guide.steps.map((step) => step.id));
      for (const step of guide.steps) {
        await expect(page.locator(`#step-${step.id} h2`)).toContainText(step.title);
      }

      // Table of contents: one link per step (open list on desktop, disclosure on mobile).
      const toc = page.getByTestId("guide-toc");
      await expect(toc.locator(`a[href="#step-${guide.steps[0].id}"]`).first()).toBeAttached();
      expect(await toc.locator("a").count()).toBeGreaterThanOrEqual(guide.steps.length);

      // Tools and their stand-ins.
      const tools = page.getByTestId("tools-list");
      for (const tool of guide.tools) {
        const item = tools.locator(`[data-tool-id="${tool.toolId}"]`);
        await expect(item).toContainText(TOOLS_T[locale][tool.toolId].label);
        for (const alternative of tool.alternatives) {
          await expect(item).toContainText(TOOLS_T[locale][alternative].label);
        }
      }

      await expect(page.getByTestId("applies-to")).toContainText(t.appliesTo.title);
      if (guide.safety) {
        await expect(page.getByTestId("safety-notes").locator("li")).toHaveCount(
          guide.safety.length,
        );
      }

      // Step illustrations are named images.
      for (const step of guide.steps.filter((s) => s.illustration)) {
        const svg = page.locator(`#step-${step.id} svg[role=img]`).first();
        await expect(svg.locator("title")).toHaveText(ILL_T[locale][step.illustration!].alt);
      }

      if (guide.kind === "adjust") {
        await expect(page.locator("[data-testid=measure-figure]").first()).toBeVisible();
      }

      // SEO: canonical and alternates point at the same slug in both locales.
      await expect(page.locator('link[rel="canonical"]')).toHaveAttribute(
        "href",
        new RegExp(`/${locale}/guides/${slug}$`),
      );
      await expect(page.locator('link[rel="alternate"][hreflang="en"]')).toHaveAttribute(
        "href",
        new RegExp(`/en/guides/${slug}$`),
      );
      await expect(page.locator('link[rel="alternate"][hreflang="fr"]')).toHaveAttribute(
        "href",
        new RegExp(`/fr/guides/${slug}$`),
      );

      expect(errors, errors.join("\n")).toEqual([]);
    });
  }

  test(`the table of contents jumps to a step (${locale})`, async ({ page }) => {
    const slug = onePerKind.values().next().value!;
    const guide = readGuide(slug, locale);
    await page.goto(href(locale, "/guides/[slug]", { slug }));
    const toc = page.getByTestId("guide-toc");
    // GuideToc is a <details> below md (768 px) and a sidebar from md: a phone in
    // landscape (844 px) is "mobile" yet gets the sidebar, so ask the page.
    const summary = toc.locator("summary");
    if (await summary.isVisible()) await summary.click();
    const last = guide.steps.at(-1)!;
    await toc.locator(`a[href="#step-${last.id}"]:visible`).click();
    await expect(page).toHaveURL(new RegExp(`#step-${last.id}$`));
    await expect(page.locator(`#step-${last.id}`)).toBeInViewport();
  });

  test(`an unknown guide is a 404 (${locale})`, async ({ page }) => {
    const response = await page.goto(
      href(locale, "/guides/[slug]", { slug: "check-flux-capacitor" }),
    );
    expect(response?.status()).toBe(404);
  });

  test(`the Open Graph image is a PNG (${locale})`, async ({ request }) => {
    const slug = onePerKind.values().next().value!;
    const response = await request.get(`/${locale}/guides/${slug}/opengraph-image`);
    expect(response.status()).toBe(200);
    expect(response.headers()["content-type"]).toBe("image/png");
    expect((await response.body()).subarray(1, 4).toString()).toBe("PNG");
  });
});
