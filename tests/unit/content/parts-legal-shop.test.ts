/**
 * The content that is not a guide (§1.1, §5.5, §6.2): per-part notes
 * (`content/parts/<partId>/{fr,en}.mdx`), the legal pages
 * (`content/legal/{mentions,confidentialite}.{fr,en}.mdx`) and the shop
 * categories (`content/shop/categories.yaml`).
 *
 * Their content-collections declarations belong to the tasks that render them
 * (W2-T3 parts, W3-T4 legal, W3-T2 shop); until then this file is the contract
 * the authored files keep: valid ids, both locales, identical structure, and no
 * insecure link. It reads the files with the same frontmatter splitter as the
 * guides, so it depends on no build output.
 */
/* eslint-disable security/detect-non-literal-fs-filename -- fixed folders under content/, entries validated against PART_IDS */
/* eslint-disable security/detect-object-injection -- lookups keyed by routing.locales and by the fixed keys of PAGES and the category schema */
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";
import { parse as parseYaml } from "yaml";

import { parseFrontmatter } from "@/lib/content/frontmatter";
import { PART_IDS } from "@/lib/domain/data/parts";
import { RETAILER_ORDER } from "@/lib/domain/data/retailers";
import { routing } from "@/lib/i18n/routing";

const CONTENT = join(process.cwd(), "content");
const LOCALES = routing.locales;
const ID = /^[a-z0-9-]+$/;

function read(path: string): { data: Record<string, unknown>; body: string } {
  const parsed = parseFrontmatter(readFileSync(path, "utf8"));
  if (!parsed || parsed.errors.length > 0) throw new Error(`${path}: invalid frontmatter`);
  return { data: parsed.data as Record<string, unknown>, body: parsed.body };
}

const nonEmptyString = (value: unknown) => typeof value === "string" && value.trim().length > 0;

describe("content/parts", () => {
  const dir = join(CONTENT, "parts");
  const folders = existsSync(dir) ? readdirSync(dir).sort() : [];

  it("covers the ten most-clicked parts, each a real PartId", () => {
    expect(folders).toHaveLength(10);
    for (const folder of folders) expect(PART_IDS as readonly string[], folder).toContain(folder);
  });

  for (const partId of folders) {
    describe(partId, () => {
      const files = Object.fromEntries(
        LOCALES.map((locale) => [locale, read(join(dir, partId, `${locale}.mdx`))]),
      );

      it("holds exactly fr.mdx and en.mdx", () => {
        expect(readdirSync(join(dir, partId)).sort()).toEqual(["en.mdx", "fr.mdx"]);
      });

      it("has a valid frontmatter in both locales", () => {
        for (const locale of LOCALES) {
          const { data, body } = files[locale];
          expect(Object.keys(data).sort(), locale).toEqual(
            expect.arrayContaining(["partId", "summary", "wearSigns"]),
          );
          for (const key of Object.keys(data)) {
            expect(["partId", "summary", "wearSigns", "lifespanKm"], key).toContain(key);
          }
          expect(data.partId).toBe(partId);
          expect(nonEmptyString(data.summary)).toBe(true);
          expect(Array.isArray(data.wearSigns) && data.wearSigns.length > 0).toBe(true);
          for (const sign of data.wearSigns as unknown[]) expect(nonEmptyString(sign)).toBe(true);
          if (data.lifespanKm !== undefined) {
            expect(Number.isInteger(data.lifespanKm) && (data.lifespanKm as number) > 0).toBe(true);
          }
          expect(body.trim().length).toBeGreaterThan(0);
          expect(body).not.toMatch(/http:\/\/|[<{]/);
        }
      });

      it("agrees across locales on structure, and is translated", () => {
        const { fr, en } = files;
        expect((en.data.wearSigns as unknown[]).length).toBe(
          (fr.data.wearSigns as unknown[]).length,
        );
        expect(en.data.lifespanKm).toBe(fr.data.lifespanKm);
        expect(en.data.summary).not.toBe(fr.data.summary);
      });
    });
  }
});

describe("content/legal", () => {
  const PAGES = {
    mentions: "/mentions-legales",
    confidentialite: "/confidentialite",
  } as const;

  const localized = (key: (typeof PAGES)[keyof typeof PAGES], locale: (typeof LOCALES)[number]) => {
    const target = routing.pathnames[key];
    return `/${locale}${typeof target === "string" ? target : target[locale]}`;
  };

  for (const page of Object.keys(PAGES) as Array<keyof typeof PAGES>) {
    for (const locale of LOCALES) {
      describe(`${page}.${locale}.mdx`, () => {
        const { data, body } = read(join(CONTENT, "legal", `${page}.${locale}.mdx`));

        it("has a title, a summary and an ISO update date", () => {
          expect(nonEmptyString(data.title)).toBe(true);
          expect(nonEmptyString(data.summary)).toBe(true);
          expect(
            String(data.updatedAt instanceof Date ? data.updatedAt.toISOString() : data.updatedAt),
          ).toMatch(/^\d{4}-\d{2}-\d{2}/);
        });

        it("uses only https links, and internal links point at the localized legal routes", () => {
          expect(body).not.toContain("http://");
          const internal = [...body.matchAll(/\]\((\/[^)]*)\)/g)].map((match) => match[1]);
          const allowed = Object.values(PAGES).map((key) => localized(key, locale));
          expect(internal.length).toBeGreaterThan(0);
          for (const href of internal) expect(allowed, href).toContain(href);
        });

        it("matches the real app: no analytics, only the necessary cookies", () => {
          if (page !== "confidentialite") return;
          expect(body).toContain("NEXT_LOCALE");
          expect(body).toContain("authjs.session-token");
          expect(body).toMatch(/cdg1/);
          expect(body).toMatch(/eu-central-1/);
        });

        it("names the publisher contact through the lienardale GitHub repository", () => {
          if (page !== "mentions") return;
          expect(body).toContain("https://github.com/lienardale/velo-atelier");
        });
      });
    }
  }
});

describe("content/shop/categories.yaml", () => {
  const file = parseYaml(readFileSync(join(CONTENT, "shop", "categories.yaml"), "utf8")) as {
    categories: Array<Record<string, unknown>>;
  };
  const categories = file.categories;

  it("lists at least 8 categories with unique kebab-case ids", () => {
    expect(categories.length).toBeGreaterThanOrEqual(8);
    const ids = categories.map((category) => category.id as string);
    expect(new Set(ids).size).toBe(ids.length);
    for (const id of ids) expect(id).toMatch(ID);
  });

  for (const category of categories) {
    describe(String(category.id), () => {
      it("has only known keys", () => {
        expect(Object.keys(category).sort()).toEqual(
          ["hint", "id", "label", "partIds", "query", "retailers"].sort(),
        );
      });

      it("is written in both locales", () => {
        for (const key of ["label", "hint", "query"] as const) {
          const value = category[key] as Record<string, unknown>;
          expect(Object.keys(value).sort(), key).toEqual([...LOCALES].sort());
          for (const locale of LOCALES)
            expect(nonEmptyString(value[locale]), `${key}.${locale}`).toBe(true);
          expect(value.en, key).not.toBe(value.fr);
        }
      });

      it("sells real parts", () => {
        const partIds = category.partIds as string[];
        expect(partIds.length).toBeGreaterThan(0);
        for (const partId of partIds)
          expect(PART_IDS as readonly string[], partId).toContain(partId);
      });

      it("links to the three retailers", () => {
        expect(category.retailers).toEqual([...RETAILER_ORDER]);
      });
    });
  }
});
