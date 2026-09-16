/**
 * The content check — the authoritative validator of `content/guides/**` (§5.1).
 *
 *   runContentCheck(rootDir, { strict }) → { errors: [{ file, line, message }] }
 *
 * `scripts/content-check.ts` prints the errors as `file:line: message` and
 * exits 1 when there is any; it runs first in `npm run build`, in
 * `scripts/ci/content.sh` and in lint-staged. content-collections re-runs the
 * `<Step id>` ↔ frontmatter comparison at build time as defence in depth, but
 * this is the check that names the file and the line.
 *
 * Everything is read relative to `rootDir` — `content/guides`, `messages/`,
 * `components/illustrations/` — so the tests run it on a temporary copy of the
 * repo with one bad document dropped in.
 *
 * DEFAULT mode (structural, from W1 on):
 *   - one folder per guide, named like its slug, holding exactly fr.mdx + en.mdx;
 *   - frontmatter parses and satisfies `GuideFrontmatterSchema`; `slug === folder`;
 *   - part ids (guide, steps, consequences) exist; tool ids and their
 *     alternatives exist; illustration ids exist in the registry and have a
 *     component file; `appliesTo` paths and values exist on a BikeSpec;
 *   - a consequence's `guideSlug` targets a guide of the kind its action needs
 *     (`fix` → `adjust`), and `related[]` are slugs;
 *   - check and measure guides are never stubs, nor are the guides a geometry
 *     measure points at (§5.7);
 *   - the MDX body uses only the registered components with literal string
 *     attributes, no `import`/`export`, no `{expressions}`;
 *   - `<Step id>` sequence equals `steps[].id` in order (a stub: exactly one
 *     `<Step>`, ≥ 40 words); `<Illustration id>` exists and does not repeat a
 *     step's own `illustration`;
 *   - FR and EN agree on everything structural;
 *   - every `guides.reasons.<reasonKey>`, `tools.<id>.label`,
 *     `illustrations.<id>.alt` and `guides.appliesTo.*` label exists in both
 *     message files, and each illustration's callout count equals its
 *     `illustrations.<id>.callouts.*` keys;
 *   - retailer templates are https with `{q}` exactly once; no `http://` in content.
 *
 * STRICT mode (`--strict`, from W2-T4 on and always in CI) adds the ★ rules:
 *   - every rendered part is checked by ≥ 1 `check` step, directly or through a
 *     part it hosts;
 *   - every `check` step with a `checkQuestion` has ≥ 40 words in both locales;
 *   - guides touching `e-motor`/`e-battery` carry a safety note matching
 *     /batter/i; guides touching a brake line or a rotor carry ≥ 1 safety note;
 *   - `content/brands.yaml` exists, its part ids are valid, three non-empty tiers;
 *   - every `related[]` and `ko[].guideSlug` target exists on disk.
 *
 * Plain Node: no `server-only`, no React, no content-collections output.
 */
/* eslint-disable security/detect-non-literal-fs-filename -- every path is `rootDir` joined with a fixed segment or a directory entry validated against GUIDE_SLUG_PATTERN / a fixed file name */
/* eslint-disable security/detect-object-injection -- lookups are into parsed JSON catalogues and records keyed by validated ids, always behind Object.hasOwn */
import { createHash } from "node:crypto";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";

import remarkMdx from "remark-mdx";
import remarkParse from "remark-parse";
import { unified } from "unified";
import { parse as parseYaml } from "yaml";

import { ID_PATTERN } from "@/lib/domain/data/conventions";
import { GEOMETRY_MEASURES, GEOMETRY_MEASURE_IDS } from "@/lib/domain/data/geometry-measures";
import { partDefinition, PARTS, RENDERED_PART_IDS } from "@/lib/domain/data/parts";
import { RETAILERS } from "@/lib/domain/data/retailers";
import { isToolId } from "@/lib/domain/data/tools";
import { guideKindFor, type ProcedureKind } from "@/lib/domain/schema/procedure";

import { conditionMessageKeys, conditionProblems } from "./applies-to";
import { parseFrontmatter, type ParsedFrontmatter } from "./frontmatter";
import { illustrationDefinition } from "./illustrations";
import { GUIDE_SLUG_PATTERN, GuideFrontmatterSchema, kindOfGuideSlug } from "./schema";
import {
  GUIDE_LOCALES,
  type ContentCheckResult,
  type ContentIssue,
  type GuideFrontmatter,
} from "./types";

export interface ContentCheckOptions {
  strict?: boolean;
}

/** The components an MDX body may use, and their required attributes. */
export const MDX_COMPONENTS: Readonly<
  Record<string, { required: readonly string[]; optional: readonly string[] }>
> = {
  Step: { required: ["id"], optional: [] },
  Tool: { required: ["id"], optional: ["alt"] },
  Warning: { required: ["level"], optional: [] },
  Illustration: { required: ["id"], optional: ["caption"] },
  Measure: { required: ["id", "unit"], optional: ["target"] },
};

export const WARNING_LEVELS = ["info", "caution", "danger"] as const;
export const MEASURE_UNITS = ["mm", "cm", "bar", "percent"] as const;

/** A stub's single step, and every checked step in strict mode, needs this many words. */
export const MIN_STEP_WORDS = 40;

const GUIDES_DIR = join("content", "guides");
const COMPONENT_DIR = join("components", "illustrations");

type Catalogue = Record<string, unknown>;

interface Messages {
  guides: Catalogue;
  tools: Catalogue;
  illustrations: Catalogue;
}

interface BodyStep {
  id: string;
  line: number;
  words: number;
}

interface BodyScan {
  steps: BodyStep[];
  illustrations: Array<{ id: string; line: number }>;
}

interface GuideFile {
  slug: string;
  locale: (typeof GUIDE_LOCALES)[number];
  file: string;
  source: string;
  parsed: ParsedFrontmatter | null;
  meta: GuideFrontmatter | null;
  body: BodyScan | null;
}

class Reporter {
  readonly errors: ContentIssue[] = [];
  add(file: string, line: number, message: string): void {
    this.errors.push({ file, line, message });
  }
}

export function runContentCheck(
  rootDir: string,
  options: ContentCheckOptions = {},
): ContentCheckResult {
  const strict = options.strict === true;
  const report = new Reporter();
  const rel = (path: string) => relative(rootDir, path).split(sep).join("/");

  const messages = {
    fr: loadMessages(rootDir, "fr", report, rel),
    en: loadMessages(rootDir, "en", report, rel),
  };

  const guides = loadGuides(rootDir, report, rel);
  const bySlug = new Map<string, Partial<Record<(typeof GUIDE_LOCALES)[number], GuideFile>>>();
  for (const guide of guides) {
    bySlug.set(guide.slug, { ...bySlug.get(guide.slug), [guide.locale]: guide });
  }

  const kindOnDisk = (slug: string): ProcedureKind | null => {
    const entry = bySlug.get(slug);
    return entry?.fr?.meta?.kind ?? entry?.en?.meta?.kind ?? null;
  };

  const measureGuides = new Set(GEOMETRY_MEASURES.map((measure) => measure.guideSlug));
  const usedIllustrations = new Set<string>();

  for (const guide of guides) {
    if (!guide.meta || !guide.parsed) continue;
    checkGuide(guide, {
      rootDir,
      report,
      messages,
      kindOnDisk,
      measureGuides,
      usedIllustrations,
      strict,
      exists: (slug) => bySlug.has(slug),
    });
  }

  for (const [, pair] of bySlug) {
    if (pair.fr?.meta && pair.en?.meta && pair.fr.parsed && pair.en.parsed) {
      checkParity(pair.fr, pair.en, report);
    }
  }

  checkIllustrationCallouts(rootDir, usedIllustrations, messages, report, rel);
  checkRetailers(report);

  if (strict) {
    checkRenderedPartCoverage(guides, report);
    checkBrands(rootDir, report, rel);
  }

  report.errors.sort(
    (a, b) => a.file.localeCompare(b.file) || a.line - b.line || a.message.localeCompare(b.message),
  );
  return { errors: report.errors };
}

/** `file:line: message`, one per line — what the CLI prints. */
export function formatIssues(issues: readonly ContentIssue[]): string {
  return issues.map((issue) => `${issue.file}:${issue.line}: ${issue.message}`).join("\n");
}

// ── Loading ──────────────────────────────────────────────────────────────────

function loadMessages(
  rootDir: string,
  locale: string,
  report: Reporter,
  rel: (path: string) => string,
): Messages {
  const read = (namespace: string): Catalogue => {
    const file = join(rootDir, "messages", locale, `${namespace}.json`);
    if (!existsSync(file)) {
      report.add(rel(file), 1, `missing message catalogue messages/${locale}/${namespace}.json`);
      return {};
    }
    try {
      return JSON.parse(readFileSync(file, "utf8")) as Catalogue;
    } catch (error) {
      report.add(rel(file), 1, `invalid JSON: ${(error as Error).message}`);
      return {};
    }
  };
  return { guides: read("guides"), tools: read("tools"), illustrations: read("illustrations") };
}

function loadGuides(rootDir: string, report: Reporter, rel: (path: string) => string): GuideFile[] {
  const dir = join(rootDir, GUIDES_DIR);
  if (!existsSync(dir)) return [];

  const guides: GuideFile[] = [];
  for (const name of readdirSync(dir).sort()) {
    const folder = join(dir, name);
    if (!statSync(folder).isDirectory()) {
      report.add(
        rel(folder),
        1,
        `unexpected file in content/guides — every guide is a folder <slug>/{fr,en}.mdx`,
      );
      continue;
    }
    if (!GUIDE_SLUG_PATTERN.test(name)) {
      report.add(rel(folder), 1, `folder name "${name}" is not a guide slug (<kind>-<kebab-case>)`);
      continue;
    }

    const files = readdirSync(folder).sort();
    for (const file of files) {
      if (
        !(GUIDE_LOCALES as readonly string[]).includes(file.replace(/\.mdx$/, "")) ||
        !file.endsWith(".mdx")
      ) {
        report.add(
          rel(join(folder, file)),
          1,
          `unexpected file — a guide folder holds only fr.mdx and en.mdx`,
        );
      }
    }

    for (const locale of GUIDE_LOCALES) {
      const path = join(folder, `${locale}.mdx`);
      if (!existsSync(path)) {
        const other = GUIDE_LOCALES.find((candidate) => candidate !== locale)!;
        report.add(
          rel(join(folder, `${other}.mdx`)),
          1,
          `missing ${locale}.mdx — every guide exists in both locales`,
        );
        continue;
      }
      guides.push(loadGuide(name, locale, path, report, rel));
    }
  }
  return guides;
}

function loadGuide(
  slug: string,
  locale: (typeof GUIDE_LOCALES)[number],
  path: string,
  report: Reporter,
  rel: (path: string) => string,
): GuideFile {
  const file = rel(path);
  const source = readFileSync(path, "utf8");
  const guide: GuideFile = { slug, locale, file, source, parsed: null, meta: null, body: null };

  source.split(/\r?\n/).forEach((line, index) => {
    if (line.includes("http://")) report.add(file, index + 1, "insecure link: use https://");
  });

  const parsed = parseFrontmatter(source);
  if (!parsed) {
    report.add(file, 1, "missing frontmatter: the file must start with a --- fenced YAML block");
    return guide;
  }
  guide.parsed = parsed;
  for (const error of parsed.errors) report.add(file, error.line, error.message);
  if (parsed.errors.length > 0) return guide;

  const result = GuideFrontmatterSchema.safeParse(parsed.data);
  if (!result.success) {
    for (const issue of result.error.issues) {
      const where = issue.path.length > 0 ? `${issue.path.join(".")}: ` : "";
      report.add(
        file,
        parsed.lineOf(issue.path.length > 0 ? issue.path : ["steps"]),
        `frontmatter ${where}${issue.message}`,
      );
    }
  } else {
    guide.meta = result.data;
  }

  guide.body = scanBody(parsed, file, report);
  return guide;
}

// ── MDX body ─────────────────────────────────────────────────────────────────

interface MdxNode {
  type: string;
  name?: string | null;
  value?: unknown;
  attributes?: Array<{ type: string; name?: string; value?: unknown }>;
  children?: MdxNode[];
  position?: { start: { line: number } };
}

function scanBody(parsed: ParsedFrontmatter, file: string, report: Reporter): BodyScan {
  const scan: BodyScan = { steps: [], illustrations: [] };
  const lineOf = (node: MdxNode) => parsed.bodyStartLine - 1 + (node.position?.start.line ?? 1);

  let tree: MdxNode;
  try {
    tree = unified().use(remarkParse).use(remarkMdx).parse(parsed.body) as unknown as MdxNode;
  } catch (error) {
    const place = (error as { line?: number }).line;
    report.add(
      file,
      parsed.bodyStartLine - 1 + (place ?? 1),
      `MDX does not parse: ${(error as Error).message.split("\n")[0]}`,
    );
    return scan;
  }

  const visit = (node: MdxNode, step: BodyStep | null): void => {
    if (node.type === "mdxjsEsm") {
      report.add(file, lineOf(node), "import/export is not allowed in guide MDX");
      return;
    }
    if (node.type === "mdxFlowExpression" || node.type === "mdxTextExpression") {
      report.add(file, lineOf(node), "JavaScript expressions ({…}) are not allowed in guide MDX");
      return;
    }
    if (step && (node.type === "text" || node.type === "inlineCode")) {
      step.words += countWords(String(node.value));
    }

    let current = step;
    if (node.type === "mdxJsxFlowElement" || node.type === "mdxJsxTextElement") {
      const attributes = readAttributes(node, file, lineOf(node), report);
      const name = node.name ?? "";
      if (name === "Step") {
        if (step) report.add(file, lineOf(node), "<Step> cannot be nested inside another <Step>");
        if (attributes.id) {
          current = { id: attributes.id, line: lineOf(node), words: 0 };
          scan.steps.push(current);
        }
      } else if (name === "Illustration" && attributes.id) {
        scan.illustrations.push({ id: attributes.id, line: lineOf(node) });
      } else if (name === "Tool" && attributes.id) {
        if (!isToolId(attributes.id))
          report.add(file, lineOf(node), `<Tool id="${attributes.id}">: unknown tool`);
        if (attributes.alt !== undefined && !isToolId(attributes.alt)) {
          report.add(file, lineOf(node), `<Tool alt="${attributes.alt}">: unknown tool`);
        }
      } else if (name === "Warning" && attributes.level !== undefined) {
        if (!(WARNING_LEVELS as readonly string[]).includes(attributes.level)) {
          report.add(
            file,
            lineOf(node),
            `<Warning level="${attributes.level}">: use one of ${WARNING_LEVELS.join(", ")}`,
          );
        }
      } else if (name === "Measure" && attributes.id) {
        if (!(GEOMETRY_MEASURE_IDS as readonly string[]).includes(attributes.id)) {
          report.add(
            file,
            lineOf(node),
            `<Measure id="${attributes.id}">: not a geometry measure id`,
          );
        }
        if (
          attributes.unit !== undefined &&
          !(MEASURE_UNITS as readonly string[]).includes(attributes.unit)
        ) {
          report.add(
            file,
            lineOf(node),
            `<Measure unit="${attributes.unit}">: use one of ${MEASURE_UNITS.join(", ")}`,
          );
        }
      }
    }
    for (const child of node.children ?? []) visit(child, current);
  };

  visit(tree, null);
  return scan;
}

function readAttributes(
  node: MdxNode,
  file: string,
  line: number,
  report: Reporter,
): Record<string, string> {
  const name = node.name ?? "";
  const spec = Object.hasOwn(MDX_COMPONENTS, name) ? MDX_COMPONENTS[name] : undefined;
  if (!spec) {
    report.add(
      file,
      line,
      `<${name || "fragment"}> is not a guide component (use ${Object.keys(MDX_COMPONENTS).join(", ")})`,
    );
    return {};
  }

  const values: Record<string, string> = {};
  for (const attribute of node.attributes ?? []) {
    if (attribute.type !== "mdxJsxAttribute" || typeof attribute.value !== "string") {
      report.add(
        file,
        line,
        `<${name}>: attributes must be literal strings (no spreads, no {expressions})`,
      );
      continue;
    }
    const key = attribute.name ?? "";
    if (!spec.required.includes(key) && !spec.optional.includes(key)) {
      report.add(file, line, `<${name}>: unknown attribute "${key}"`);
      continue;
    }
    values[key] = attribute.value;
  }
  for (const key of spec.required) {
    if (!Object.hasOwn(values, key))
      report.add(file, line, `<${name}>: missing required attribute "${key}"`);
  }
  return values;
}

/** Words = whitespace-separated tokens containing a letter or a digit. */
export function countWords(text: string): number {
  return text.split(/\s+/).filter((token) => /[\p{L}\p{N}]/u.test(token)).length;
}

// ── One guide ────────────────────────────────────────────────────────────────

interface GuideContext {
  rootDir: string;
  report: Reporter;
  messages: Record<(typeof GUIDE_LOCALES)[number], Messages>;
  kindOnDisk: (slug: string) => ProcedureKind | null;
  exists: (slug: string) => boolean;
  measureGuides: ReadonlySet<string>;
  usedIllustrations: Set<string>;
  strict: boolean;
}

function checkGuide(guide: GuideFile, context: GuideContext): void {
  const meta = guide.meta!;
  const parsed = guide.parsed!;
  const { report } = context;
  const at = (path: ReadonlyArray<string | number>) => parsed.lineOf(path);
  const error = (path: ReadonlyArray<string | number>, message: string) =>
    report.add(guide.file, at(path), message);

  if (meta.slug !== guide.slug) {
    error(["slug"], `slug "${meta.slug}" must equal its folder name "${guide.slug}"`);
  }

  // Status rules (§5.7).
  if (meta.status === "stub" && (meta.kind === "check" || meta.kind === "measure")) {
    error(["status"], `a ${meta.kind} guide is never a stub`);
  }
  if (meta.status === "stub" && context.measureGuides.has(meta.slug)) {
    error(["status"], `a geometry measure points at "${meta.slug}", so it cannot be a stub`);
  }

  // Parts.
  meta.partIds.forEach((id, index) => {
    if (!partDefinition(id)) error(["partIds", index], `unknown part id "${id}"`);
  });

  // Tools.
  meta.tools.forEach((tool, index) => {
    if (!isToolId(tool.toolId)) {
      error(["tools", index, "toolId"], `unknown tool id "${tool.toolId}"`);
    } else {
      requireMessage(context, guide, at(["tools", index, "toolId"]), "tools", [
        tool.toolId,
        "label",
      ]);
    }
    tool.alternatives.forEach((alternative, altIndex) => {
      if (!isToolId(alternative)) {
        error(["tools", index, "alternatives", altIndex], `unknown tool id "${alternative}"`);
      } else if (alternative === tool.toolId) {
        error(
          ["tools", index, "alternatives", altIndex],
          `"${alternative}" cannot be its own alternative`,
        );
      }
    });
  });

  // Conditions.
  const checkCondition = (
    condition: GuideFrontmatter["appliesTo"],
    base: Array<string | number>,
  ) => {
    if (!condition) return;
    for (const problem of conditionProblems(condition))
      error([...base, ...problem.path], `appliesTo: ${problem.message}`);
    for (const key of conditionMessageKeys(condition)) {
      requireMessage(context, guide, at(base), "guides", key.split("."));
    }
  };
  checkCondition(meta.appliesTo, ["appliesTo"]);

  // Related guides.
  meta.related.forEach((slug, index) => {
    if (slug === meta.slug) error(["related", index], "a guide cannot be related to itself");
    else if (context.strict && !context.exists(slug))
      error(["related", index], `related guide "${slug}" does not exist`);
  });

  // Steps.
  const stepIllustrations = new Set<string>();
  meta.steps.forEach((step, index) => {
    const base = ["steps", index];
    step.partIds?.forEach((id, partIndex) => {
      if (!partDefinition(id)) error([...base, "partIds", partIndex], `unknown part id "${id}"`);
    });
    checkCondition(step.appliesTo, [...base, "appliesTo"]);

    if (step.illustration !== undefined) {
      stepIllustrations.add(step.illustration);
      checkIllustration(context, guide, at([...base, "illustration"]), step.illustration);
    }

    step.checkQuestion?.ko.forEach((consequence, koIndex) => {
      const koBase = [...base, "checkQuestion", "ko", koIndex];
      if (!partDefinition(consequence.partId))
        error([...koBase, "partId"], `unknown part id "${consequence.partId}"`);
      requireMessage(context, guide, at([...koBase, "reasonKey"]), "guides", [
        "reasons",
        consequence.reasonKey,
      ]);

      if (consequence.guideSlug !== undefined) {
        const needed = guideKindFor(consequence.action);
        const target =
          context.kindOnDisk(consequence.guideSlug) ?? kindOfGuideSlug(consequence.guideSlug);
        if (needed === null) {
          error([...koBase, "guideSlug"], `an "inspect-shop" consequence has no guide`);
        } else if (target !== needed) {
          error(
            [...koBase, "guideSlug"],
            `"${consequence.action}" needs a${needed === "adjust" ? "n" : ""} ${needed} guide, but "${consequence.guideSlug}" is a ${target} guide`,
          );
        } else if (context.strict && !context.exists(consequence.guideSlug)) {
          error([...koBase, "guideSlug"], `guide "${consequence.guideSlug}" does not exist`);
        }
      }
    });
  });

  // Body ↔ frontmatter.
  const body = guide.body;
  // The `<Step>` / `<Illustration>` in the messages below name MDX components for the
  // guide author. semgrep's raw-html-format rule reads a template literal starting with
  // `<Tag` as HTML being built; these strings only ever reach stderr, hence the nosemgrep.
  if (body) {
    const expected = meta.steps.map((step) => step.id);
    const actual = body.steps.map((step) => step.id);

    if (meta.status === "full") {
      const mismatch = expected.findIndex((id, index) => actual[index] !== id);
      if (mismatch !== -1 || actual.length !== expected.length) {
        const index = mismatch === -1 ? expected.length : mismatch;
        const line = body.steps[index]?.line ?? at(["steps"]);
        report.add(
          guide.file,
          line,
          // nosemgrep: javascript.express.security.injection.raw-html-format.raw-html-format -- CLI diagnostic written to stderr (scripts/content-check.ts), never HTML
          `<Step> ids [${actual.join(", ")}] must equal frontmatter steps [${expected.join(", ")}], in order`,
        );
      }
    } else if (body.steps.length !== 1) {
      report.add(
        guide.file,
        at(["status"]),
        // nosemgrep: javascript.express.security.injection.raw-html-format.raw-html-format -- CLI diagnostic written to stderr (scripts/content-check.ts), never HTML
        `a stub has exactly one <Step> body (found ${body.steps.length})`,
      );
    } else if (!expected.includes(body.steps[0].id)) {
      report.add(
        guide.file,
        body.steps[0].line,
        // nosemgrep: javascript.express.security.injection.raw-html-format.raw-html-format -- CLI diagnostic written to stderr (scripts/content-check.ts), never HTML
        `<Step id="${body.steps[0].id}"> is not a frontmatter step`,
      );
    } else if (body.steps[0].words < MIN_STEP_WORDS) {
      report.add(
        guide.file,
        body.steps[0].line,
        // nosemgrep: javascript.express.security.injection.raw-html-format.raw-html-format -- CLI diagnostic written to stderr (scripts/content-check.ts), never HTML
        `a stub's <Step> needs ≥ ${MIN_STEP_WORDS} words (has ${body.steps[0].words})`,
      );
    }

    for (const illustration of body.illustrations) {
      checkIllustration(context, guide, illustration.line, illustration.id);
      if (stepIllustrations.has(illustration.id)) {
        report.add(
          guide.file,
          illustration.line,
          // nosemgrep: javascript.express.security.injection.raw-html-format.raw-html-format -- CLI diagnostic written to stderr (scripts/content-check.ts), never HTML
          `<Illustration id="${illustration.id}"> repeats a step's frontmatter illustration`,
        );
      }
    }

    if (context.strict) {
      meta.steps.forEach((step, index) => {
        if (meta.kind !== "check" || !step.checkQuestion) return;
        const bodyStep = body.steps.find((candidate) => candidate.id === step.id);
        if (bodyStep && bodyStep.words < MIN_STEP_WORDS) {
          report.add(
            guide.file,
            bodyStep.line ?? at(["steps", index]),
            `check step "${step.id}" needs ≥ ${MIN_STEP_WORDS} words (has ${bodyStep.words})`,
          );
        }
      });
    }
  }

  if (context.strict) checkSafety(guide, report);
}

function checkIllustration(
  context: GuideContext,
  guide: GuideFile,
  line: number,
  id: string,
): void {
  const definition = illustrationDefinition(id);
  if (!definition) {
    context.report.add(guide.file, line, `unknown illustration id "${id}"`);
    return;
  }
  context.usedIllustrations.add(id);
  if (!existsSync(join(context.rootDir, COMPONENT_DIR, `${definition.component}.tsx`))) {
    context.report.add(
      guide.file,
      line,
      `illustration "${id}" has no component ${COMPONENT_DIR}/${definition.component}.tsx`,
    );
  }
  requireMessage(context, guide, line, "illustrations", [id, "alt"]);
}

function requireMessage(
  context: GuideContext,
  guide: GuideFile,
  line: number,
  namespace: keyof Messages,
  path: readonly string[],
): void {
  for (const locale of GUIDE_LOCALES) {
    const value = path.reduce<unknown>(
      (node, segment) =>
        typeof node === "object" && node !== null && Object.hasOwn(node, segment)
          ? (node as Catalogue)[segment]
          : undefined,
      context.messages[locale][namespace],
    );
    if (typeof value !== "string" || value.trim() === "") {
      context.report.add(
        guide.file,
        line,
        `missing message ${namespace}.${path.join(".")} in messages/${locale}/${namespace}.json`,
      );
    }
  }
}

function checkSafety(guide: GuideFile, report: Reporter): void {
  const meta = guide.meta!;
  const parts = new Set([...meta.partIds, ...meta.steps.flatMap((step) => step.partIds ?? [])]);
  const safety = meta.safety ?? [];
  const line = guide.parsed!.lineOf(meta.safety ? ["safety"] : ["partIds"]);

  if (
    (parts.has("e-motor") || parts.has("e-battery")) &&
    !safety.some((note) => /batter/i.test(note))
  ) {
    report.add(
      guide.file,
      line,
      "a guide touching the motor or the battery needs a safety note about the battery",
    );
  }
  const brakeRisk = [...parts].some(
    (id) => id.startsWith("brake-line-") || id.startsWith("rotor-"),
  );
  if (brakeRisk && safety.length === 0) {
    report.add(
      guide.file,
      line,
      "a guide touching a brake line or a rotor needs at least one safety note",
    );
  }
}

// ── Across locales ───────────────────────────────────────────────────────────

/** What must be identical in FR and EN; titles, summaries, prompts and safety text are translated. */
function structure(meta: GuideFrontmatter) {
  return {
    kind: meta.kind,
    partIds: meta.partIds,
    appliesTo: meta.appliesTo ?? null,
    difficulty: meta.difficulty,
    minutes: meta.minutes,
    tools: meta.tools.map((tool) => ({ toolId: tool.toolId, alternatives: tool.alternatives })),
    status: meta.status,
    order: meta.order,
    related: meta.related,
    safety: meta.safety?.length ?? 0,
    steps: meta.steps.map((step) => ({
      id: step.id,
      partIds: step.partIds ?? null,
      appliesTo: step.appliesTo ?? null,
      illustration: step.illustration ?? null,
      checkQuestion: step.checkQuestion !== undefined,
      skippable: step.checkQuestion?.skippable ?? null,
      ko: (step.checkQuestion?.ko ?? []).map((ko) => ({
        action: ko.action,
        partId: ko.partId,
        reasonKey: ko.reasonKey,
        guideSlug: ko.guideSlug ?? null,
      })),
    })),
  };
}

const PARITY_PATHS: Record<string, (index: number) => Array<string | number>> = {
  steps: (index) => ["steps", index],
};

function checkParity(fr: GuideFile, en: GuideFile, report: Reporter): void {
  const left = structure(fr.meta!);
  const right = structure(en.meta!);
  for (const key of Object.keys(left) as Array<keyof typeof left>) {
    if (key === "steps") {
      const count = Math.max(left.steps.length, right.steps.length);
      for (let index = 0; index < count; index++) {
        if (JSON.stringify(left.steps[index]) !== JSON.stringify(right.steps[index])) {
          report.add(
            en.file,
            en.parsed!.lineOf(PARITY_PATHS.steps(index)),
            `steps[${index}] differs from fr.mdx (ids, parts, appliesTo, illustration and consequences must match)`,
          );
        }
      }
    } else if (JSON.stringify(left[key]) !== JSON.stringify(right[key])) {
      report.add(en.file, en.parsed!.lineOf([key]), `"${key}" differs from fr.mdx`);
    }
  }
}

// ── Registry-wide rules ──────────────────────────────────────────────────────

/** `data-callout="3"` markers in a component file, counted by distinct number. */
export function calloutsInSource(source: string): number {
  return new Set([...source.matchAll(/data-callout=(?:"|\{?["']?)(\d+)/g)].map((match) => match[1]))
    .size;
}

function checkIllustrationCallouts(
  rootDir: string,
  used: ReadonlySet<string>,
  messages: Record<(typeof GUIDE_LOCALES)[number], Messages>,
  report: Reporter,
  rel: (path: string) => string,
): void {
  for (const id of [...used].sort()) {
    const definition = illustrationDefinition(id)!;
    const path = join(rootDir, COMPONENT_DIR, `${definition.component}.tsx`);
    if (!existsSync(path)) continue; // already reported where it is used
    const drawn = calloutsInSource(readFileSync(path, "utf8"));
    for (const locale of GUIDE_LOCALES) {
      const entry = messages[locale].illustrations[id] as Catalogue | undefined;
      const callouts =
        entry && typeof entry.callouts === "object" && entry.callouts !== null
          ? Object.keys(entry.callouts)
          : [];
      if (callouts.length !== drawn) {
        report.add(
          rel(path),
          1,
          `illustration "${id}" draws ${drawn} callout(s) but messages/${locale}/illustrations.json has ${callouts.length}`,
        );
      }
    }
  }
}

function checkRetailers(report: Reporter): void {
  const file = "lib/domain/data/retailers.ts";
  for (const retailer of Object.values(RETAILERS)) {
    for (const [locale, target] of Object.entries(retailer.byLocale)) {
      const urls =
        target.kind === "search"
          ? [target.template]
          : [...Object.values(target.byPartId), target.fallback];
      for (const url of urls) {
        if (typeof url === "string" && !url.startsWith("https://")) {
          report.add(file, 1, `${retailer.id} (${locale}): "${url}" is not https`);
        }
      }
      if (target.kind === "search" && target.template.split("{q}").length !== 2) {
        report.add(
          file,
          1,
          `${retailer.id} (${locale}): the search template needs {q} exactly once`,
        );
      }
    }
  }
}

/** ★ Every rendered part is checked somewhere — directly, or through a part it hosts. */
function checkRenderedPartCoverage(guides: readonly GuideFile[], report: Reporter): void {
  const checked = new Set<string>();
  for (const guide of guides) {
    if (guide.meta?.kind !== "check") continue;
    for (const step of guide.meta.steps) {
      for (const id of step.partIds ?? guide.meta.partIds) {
        checked.add(id);
        const host = partDefinition(id)?.hostPartId;
        if (host) checked.add(host);
      }
    }
  }
  for (const id of RENDERED_PART_IDS) {
    if (!checked.has(id)) {
      report.add(
        GUIDES_DIR.split(sep).join("/"),
        1,
        `rendered part "${id}" is not covered by any check step`,
      );
    }
  }
}

/** ★ `content/brands.yaml`: part ids valid, three non-empty tiers per part. */
function checkBrands(rootDir: string, report: Reporter, rel: (path: string) => string): void {
  const path = join(rootDir, "content", "brands.yaml");
  const file = rel(path);
  if (!existsSync(path)) {
    report.add(file, 1, "missing content/brands.yaml");
    return;
  }
  let data: unknown;
  try {
    data = parseYaml(readFileSync(path, "utf8"));
  } catch (error) {
    report.add(file, 1, `invalid YAML: ${(error as Error).message.split("\n")[0]}`);
    return;
  }
  const entries =
    typeof data === "object" && data !== null ? Object.entries(data as Catalogue) : [];
  if (entries.length === 0) report.add(file, 1, "brands.yaml lists no part");
  for (const [partId, tiers] of entries) {
    if (!ID_PATTERN.test(partId) || !PARTS.some((part) => part.id === partId)) {
      report.add(file, 1, `brands.yaml: unknown part id "${partId}"`);
    }
    for (const tier of ["entry", "mid", "high"]) {
      const list =
        typeof tiers === "object" && tiers !== null ? (tiers as Catalogue)[tier] : undefined;
      if (!Array.isArray(list) || list.length === 0) {
        report.add(file, 1, `brands.yaml: "${partId}" needs a non-empty "${tier}" tier`);
      }
    }
  }
}

// ── Manifest (`--emit`) ──────────────────────────────────────────────────────

export interface ContentManifest {
  /** Guide slugs on disk, sorted. */
  slugs: string[];
  /** `${slug}#${stepId}`, sorted. */
  stepKeys: string[];
  /** sha1 of the sorted step keys, joined by newlines (§5.4 `CONTENT_VERSION`). */
  version: string;
  /** Every `guides.reasons.*` key of the French catalogue, sorted. */
  reasonKeys: string[];
}

/** The data `lib/content/generated/*` is written from. Reads frontmatter only. */
export function buildContentManifest(rootDir: string): ContentManifest {
  const dir = join(rootDir, GUIDES_DIR);
  const slugs = existsSync(dir)
    ? readdirSync(dir)
        .filter((name) => GUIDE_SLUG_PATTERN.test(name) && existsSync(join(dir, name, "fr.mdx")))
        .sort()
    : [];
  const stepKeys = slugs
    .flatMap((slug) => {
      const parsed = parseFrontmatter(readFileSync(join(dir, slug, "fr.mdx"), "utf8"));
      const result = GuideFrontmatterSchema.safeParse(parsed?.data);
      return result.success ? result.data.steps.map((step) => `${slug}#${step.id}`) : [];
    })
    .sort();

  const guidesFile = join(rootDir, "messages", "fr", "guides.json");
  const catalogue = existsSync(guidesFile)
    ? (JSON.parse(readFileSync(guidesFile, "utf8")) as Catalogue)
    : {};
  const reasons = catalogue.reasons;
  const reasonKeys =
    typeof reasons === "object" && reasons !== null ? Object.keys(reasons).sort() : [];

  return {
    slugs,
    stepKeys,
    version: createHash("sha1").update(stepKeys.join("\n")).digest("hex"),
    reasonKeys,
  };
}

/** The three generated modules, as `{ fileName: source }`. */
export function renderGeneratedModules(manifest: ContentManifest): Record<string, string> {
  const header = (what: string) =>
    `// GENERATED by \`npm run content:build\` (scripts/content-check.ts --emit) — do not edit.\n// ${what}\n`;
  const list = (values: readonly string[]) =>
    `[\n${values.map((value) => `  ${JSON.stringify(value)},`).join("\n")}\n]`;

  return {
    "version.ts": `${header("CONTENT_VERSION = sha1 of the sorted `${slug}#${stepId}` keys (§5.4).")}\nexport const CONTENT_VERSION = ${JSON.stringify(manifest.version)};\n`,
    "slugs.ts": `${header("The guides on disk and their step keys.")}\nexport const GUIDE_SLUGS = ${list(manifest.slugs)} as const;\n\nexport const GUIDE_STEP_KEYS = ${list(manifest.stepKeys)} as const;\n`,
    "reason-keys.ts": `${header("Every guides.reasons.* key a KoConsequence may name.")}\nexport const REASON_KEYS = ${list(manifest.reasonKeys)} as const;\n\nexport type ReasonKey = (typeof REASON_KEYS)[number];\n`,
  };
}
