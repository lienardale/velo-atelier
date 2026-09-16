/**
 * Known-bad documents (§5.1): each of the eight fixtures under
 * `tests/fixtures/content-bad/` fails the check with a located message, and
 * the repository's own guides pass the frontmatter schema one by one.
 *
 * The unit tier (`tests/unit/content/check.test.ts`) exercises every rule on a
 * temporary copy; this file is the integration-tier gate over the committed
 * fixtures and content, as §5.1 names it.
 */
/* eslint-disable security/detect-object-injection -- lookups keyed by fixture folder names from the repo */
/* eslint-disable security/detect-non-literal-fs-filename -- fixed repo folders and a mkdtemp directory */
import { cpSync, mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterAll, describe, expect, it } from "vitest";

import { parseFrontmatter } from "@/lib/content/frontmatter";
import { runContentCheck } from "@/lib/content/check";
import { GuideFrontmatterSchema } from "@/lib/content/schema";
import { GUIDES_DIR, slugsOnDisk } from "@/tests/_helpers/guides";

const REPO = process.cwd();
const FIXTURES = join(REPO, "tests", "fixtures", "content-bad");
const roots: string[] = [];

afterAll(() => {
  for (const root of roots) rmSync(root, { recursive: true, force: true });
});

const EXPECTED: Record<string, { strict: boolean; message: RegExp }> = {
  "bad-partId": { strict: false, message: /unknown part id/ },
  "bad-illustration": { strict: false, message: /unknown illustration id/ },
  "bad-tool": { strict: false, message: /unknown tool id/ },
  "step-mismatch": { strict: false, message: /<Step> ids .* must equal frontmatter steps/ },
  "ko-without-guide": { strict: false, message: /needs a guideSlug/ },
  "ko-kind-mismatch": { strict: false, message: /needs a replace guide/ },
  "missing-safety-ebike": { strict: true, message: /safety note about the battery/ },
  "short-check-step": { strict: true, message: /needs ≥ 40 words/ },
};

describe("known-bad documents", () => {
  const cases = readdirSync(FIXTURES, { withFileTypes: true }).filter((entry) =>
    entry.isDirectory(),
  );

  it("are exactly the eight of §5.1", () => {
    expect(cases.map((entry) => entry.name).sort()).toEqual(Object.keys(EXPECTED).sort());
  });

  for (const { name } of cases) {
    it(`${name} is rejected with file:line: message`, () => {
      const root = mkdtempSync(join(tmpdir(), "va-content-schema-"));
      roots.push(root);
      for (const dir of ["content", "messages", join("components", "illustrations")]) {
        cpSync(join(REPO, dir), join(root, dir), { recursive: true });
      }
      cpSync(join(FIXTURES, name), root, { recursive: true });

      const fixtureDir = readdirSync(join(FIXTURES, name, "content", "guides"))[0];
      const { errors } = runContentCheck(root, { strict: EXPECTED[name].strict });
      const hit = errors.find(
        (e) =>
          e.file.startsWith(`content/guides/${fixtureDir}/`) &&
          EXPECTED[name].message.test(e.message),
      );
      expect(hit, JSON.stringify(errors, null, 1)).toBeDefined();
      expect(hit!.line).toBeGreaterThan(1);
    });
  }
});

describe("committed guides", () => {
  for (const slug of slugsOnDisk()) {
    for (const locale of ["fr", "en"] as const) {
      it(`${slug}/${locale}.mdx parses`, () => {
        const parsed = parseFrontmatter(
          readFileSync(join(GUIDES_DIR, slug, `${locale}.mdx`), "utf8"),
        );
        const result = GuideFrontmatterSchema.safeParse(parsed?.data);
        expect(result.success, JSON.stringify(result.error?.issues)).toBe(true);
      });
    }
  }
});
