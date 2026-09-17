/**
 * The content check (§5.1, §5.8 AC1) — run on a temporary copy of the repo.
 *
 * Every test copies `content/`, `messages/` and `components/illustrations/`
 * into a fresh directory, breaks one thing, and asserts the `file:line:
 * message` the check reports. The eight known-bad documents of
 * `tests/fixtures/content-bad/` are overlaid the same way, and the CLI is run
 * on two of them to prove the exit codes.
 */
/* eslint-disable security/detect-non-literal-fs-filename -- every path is under a mkdtemp directory or a fixed repo folder */
/* eslint-disable security/detect-non-literal-regexp -- patterns built from fixed guide paths */
import {
  cpSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterAll, describe, expect, it } from "vitest";
import { stringify } from "yaml";

import {
  buildContentManifest,
  calloutsInSource,
  countWords,
  formatIssues,
  renderGeneratedModules,
  runContentCheck,
} from "@/lib/content/check";
import { RETAILERS } from "@/lib/domain/data/retailers";

import { runCli } from "../../../scripts/content-check";

const REPO = process.cwd();
const temps: string[] = [];

afterAll(() => {
  for (const dir of temps) rmSync(dir, { recursive: true, force: true });
});

/** A fresh copy of what the check reads. */
function makeRoot({ content = true }: { content?: boolean } = {}): string {
  const root = mkdtempSync(join(tmpdir(), "va-content-check-"));
  temps.push(root);
  cpSync(join(REPO, "messages"), join(root, "messages"), { recursive: true });
  cpSync(join(REPO, "components", "illustrations"), join(root, "components", "illustrations"), {
    recursive: true,
  });
  if (content) cpSync(join(REPO, "content"), join(root, "content"), { recursive: true });
  return root;
}

const WORDS =
  "Regardez attentivement chaque maillon, chaque rouleau et chaque plaque de la chaîne, puis notez la rouille, les maillons raides, la saleté et tout ce qui vous semble anormal avant de passer à la suite du guide, sans vous presser et avec une bonne lumière.";

interface Doc {
  frontmatter: Record<string, unknown>;
  body: string;
}

function baseDoc(slug = "clean-test-guide", overrides: Record<string, unknown> = {}): Doc {
  const kind = slug.split("-")[0];
  return {
    frontmatter: {
      slug,
      kind,
      title: "Titre",
      summary: "Résumé.",
      status: "full",
      order: 1,
      difficulty: 1,
      minutes: 5,
      partIds: ["chain"],
      tools: [{ toolId: "rags", alternatives: [] }],
      related: [],
      steps: [{ id: "one", title: "Un" }],
      ...overrides,
    },
    body: `<Step id="one">\n\n${WORDS}\n\n</Step>\n`,
  };
}

function source(doc: Doc): string {
  return `---\n${stringify(doc.frontmatter)}---\n\n${doc.body}`;
}

/** Write a guide in both locales (the same document unless `en` differs). */
function writeGuide(root: string, doc: Doc, en: Doc = doc): string {
  const slug = String(doc.frontmatter.slug);
  const dir = join(root, "content", "guides", slug);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "fr.mdx"), source(doc));
  writeFileSync(join(dir, "en.mdx"), source(en));
  return `content/guides/${slug}`;
}

function messagesFor(root: string, locale: string, namespace: string) {
  const file = join(root, "messages", locale, `${namespace}.json`);
  return {
    read: () => JSON.parse(readFileSync(file, "utf8")) as Record<string, Record<string, unknown>>,
    write: (data: unknown) => writeFileSync(file, JSON.stringify(data)),
  };
}

const check = (root: string, strict = false) => runContentCheck(root, { strict }).errors;
const messages = (root: string, strict = false) =>
  check(root, strict).map((e) => `${e.file}:${e.line}: ${e.message}`);

// ── The repository itself ────────────────────────────────────────────────────

describe("the committed content", () => {
  it("passes the default check", () => {
    expect(formatIssues(runContentCheck(REPO).errors)).toBe("");
  });

  it("an empty repository has nothing to report", () => {
    const root = makeRoot({ content: false });
    expect(check(root)).toEqual([]);
    expect(buildContentManifest(root)).toMatchObject({ slugs: [], stepKeys: [] });
  });
});

// ── §5.8 AC1: the eight known-bad documents ─────────────────────────────────

const FIXTURES: Array<{ name: string; strict: boolean; file: RegExp; message: RegExp }> = [
  {
    name: "bad-partId",
    strict: false,
    file: /clean-fixture-bad-part\/(fr|en)\.mdx$/,
    message: /unknown part id "chian"/,
  },
  {
    name: "bad-illustration",
    strict: false,
    file: /clean-fixture-bad-illustration\/(fr|en)\.mdx$/,
    message: /unknown illustration id "chain-wear-checkr"/,
  },
  {
    name: "bad-tool",
    strict: false,
    file: /clean-fixture-bad-tool\/(fr|en)\.mdx$/,
    message: /unknown tool id "chain-cleaner"/,
  },
  {
    name: "step-mismatch",
    strict: false,
    file: /clean-fixture-step-mismatch\/(fr|en)\.mdx$/,
    message: /<Step> ids \[wipe, inspect\] must equal frontmatter steps \[inspect, wipe\]/,
  },
  {
    name: "ko-without-guide",
    strict: false,
    file: /check-fixture-ko-without-guide\/(fr|en)\.mdx$/,
    message: /needs a guideSlug/,
  },
  {
    name: "ko-kind-mismatch",
    strict: false,
    file: /check-fixture-ko-kind-mismatch\/(fr|en)\.mdx$/,
    message: /"replace" needs a replace guide, but "clean-chain" is a clean guide/,
  },
  {
    name: "missing-safety-ebike",
    strict: true,
    file: /check-fixture-ebike\/(fr|en)\.mdx$/,
    message: /safety note about the battery/,
  },
  {
    name: "short-check-step",
    strict: true,
    file: /check-fixture-short-step\/(fr|en)\.mdx$/,
    message: /check step "inspect" needs ≥ 40 words/,
  },
];

describe("known-bad fixtures (tests/fixtures/content-bad)", () => {
  for (const fixture of FIXTURES) {
    it(`${fixture.name}: reported as file:line: message${fixture.strict ? " (--strict)" : ""}`, () => {
      const root = makeRoot();
      cpSync(join(REPO, "tests", "fixtures", "content-bad", fixture.name), root, {
        recursive: true,
      });
      const errors = check(root, fixture.strict);
      const hits = errors.filter(
        (e) => fixture.file.test(e.file) && fixture.message.test(e.message),
      );
      expect(hits.length, formatIssues(errors)).toBeGreaterThan(0);
      for (const hit of hits) expect(hit.line).toBeGreaterThan(1);
      // In default mode the fixture is the only thing wrong.
      if (!fixture.strict)
        expect(
          errors.every((e) => fixture.file.test(e.file)),
          formatIssues(errors),
        ).toBe(true);
      // And without the fixture the same mode is clean (strict: for this rule).
      expect(check(makeRoot(), fixture.strict).some((e) => fixture.message.test(e.message))).toBe(
        false,
      );
    });
  }

  it("the CLI prints file:line: message and exits 1; exits 0 and emits on a clean corpus", () => {
    const root = makeRoot();
    cpSync(join(REPO, "tests", "fixtures", "content-bad", "bad-tool"), root, { recursive: true });
    const bad = runCli(["--root", root]);
    expect(bad.code).toBe(1);
    expect(bad.stdout).toBe("");
    expect(bad.stderr).toMatch(
      /^content\/guides\/clean-fixture-bad-tool\/(fr|en)\.mdx:\d+: unknown tool id "chain-cleaner"$/m,
    );
    expect(bad.stderr).toMatch(/content-check: \d+ problem\(s\)/);

    const emitRoot = makeRoot();
    expect(runCli(["--root", emitRoot, "--strict"]).code).toBe(1);
    const ok = runCli(["--root", emitRoot, "--emit"]);
    expect(ok.code, ok.stderr).toBe(0);
    expect(ok.stdout).toMatch(
      /\d+ guide\(s\), \d+ step\(s\), no problem\. lib\/content\/generated\/ written\./,
    );
    expect(
      readFileSync(join(emitRoot, "lib", "content", "generated", "version.ts"), "utf8"),
    ).toMatch(/CONTENT_VERSION = "[0-9a-f]{40}"/);
    expect(runCli([], emitRoot).stdout).not.toContain("written");
  });
});

// ── Structure of content/guides ─────────────────────────────────────────────

describe("folders and files", () => {
  it("rejects stray files, badly named folders, extra files and a missing locale", () => {
    const root = makeRoot();
    const guides = join(root, "content", "guides");
    writeFileSync(join(guides, "notes.txt"), "x");
    mkdirSync(join(guides, "Brakes"));
    writeFileSync(join(guides, "clean-chain", "de.mdx"), "x");
    unlinkSync(join(guides, "check-brakes-disc", "en.mdx"));
    expect(messages(root)).toEqual(
      expect.arrayContaining([
        "content/guides/notes.txt:1: unexpected file in content/guides — every guide is a folder <slug>/{fr,en}.mdx",
        'content/guides/Brakes:1: folder name "Brakes" is not a guide slug (<kind>-<kebab-case>)',
        "content/guides/clean-chain/de.mdx:1: unexpected file — a guide folder holds only fr.mdx and en.mdx",
        "content/guides/check-brakes-disc/fr.mdx:1: missing en.mdx — every guide exists in both locales",
      ]),
    );
  });

  it("reports a missing frontmatter, a YAML error and schema errors on their line", () => {
    const root = makeRoot();
    const dir = writeGuide(root, baseDoc());
    writeFileSync(join(root, dir, "fr.mdx"), "# no frontmatter");
    writeFileSync(join(root, dir, "en.mdx"), "---\nslug: clean-test-guide\ntitle: a: b\n---\n");
    const other = baseDoc("clean-other", { minutes: -3 });
    writeGuide(root, other);
    const out = messages(root);
    expect(out).toContain(
      `${dir}/fr.mdx:1: missing frontmatter: the file must start with a --- fenced YAML block`,
    );
    expect(out.some((line) => line.startsWith(`${dir}/en.mdx:3: invalid YAML`))).toBe(true);
    expect(out.some((line) => /clean-other\/fr\.mdx:\d+: frontmatter minutes: /.test(line))).toBe(
      true,
    );
  });

  it("reports an unparseable MDX body", () => {
    const root = makeRoot();
    const doc = baseDoc();
    doc.body = '<Step id="one">\n\nText <Tool\n';
    const dir = writeGuide(root, doc);
    expect(
      messages(root).some(
        (line) => line.startsWith(`${dir}/fr.mdx:`) && line.includes("MDX does not parse"),
      ),
    ).toBe(true);
  });
});

describe("frontmatter semantics", () => {
  it("slug, parts, tools, related", () => {
    const root = makeRoot();
    const doc = baseDoc("clean-test-guide", {
      slug: "clean-other-name",
      partIds: ["chain", "nope"],
      tools: [
        { toolId: "rags", alternatives: ["rags", "nope-tool"] },
        { toolId: "mystery", alternatives: [] },
      ],
      related: ["clean-other-name"],
    });
    const dir = join("content", "guides", "clean-test-guide");
    mkdirSync(join(root, dir), { recursive: true });
    writeFileSync(join(root, dir, "fr.mdx"), source(doc));
    writeFileSync(join(root, dir, "en.mdx"), source(doc));
    const out = check(root)
      .filter((e) => e.file.endsWith("fr.mdx"))
      .map((e) => e.message);
    expect(out).toEqual(
      expect.arrayContaining([
        'slug "clean-other-name" must equal its folder name "clean-test-guide"',
        'unknown part id "nope"',
        '"rags" cannot be its own alternative',
        'unknown tool id "nope-tool"',
        'unknown tool id "mystery"',
        "a guide cannot be related to itself",
      ]),
    );
  });

  it("stub rules (§5.7)", () => {
    const root = makeRoot();
    const twoSteps = {
      steps: [
        { id: "one", title: "Un" },
        { id: "two", title: "Deux" },
      ],
    };
    const checkStub = baseDoc("check-stub-guide", { status: "stub" });
    writeGuide(root, checkStub);
    writeGuide(root, baseDoc("adjust-suspension-sag", { status: "stub", partIds: ["fork"] }));
    const tooMany = baseDoc("clean-stub-many", { status: "stub", ...twoSteps });
    tooMany.body = `<Step id="one">\n\n${WORDS}\n\n</Step>\n\n<Step id="two">\n\n${WORDS}\n\n</Step>\n`;
    writeGuide(root, tooMany);
    const unknownStep = baseDoc("clean-stub-unknown", { status: "stub" });
    unknownStep.body = `<Step id="zzz">\n\n${WORDS}\n\n</Step>\n`;
    writeGuide(root, unknownStep);
    const short = baseDoc("clean-stub-short", { status: "stub", ...twoSteps });
    short.body = '<Step id="two">\n\nToo short.\n\n</Step>\n';
    writeGuide(root, short);
    const fine = baseDoc("clean-stub-fine", { status: "stub", ...twoSteps });
    writeGuide(root, fine);

    const out = messages(root);
    const has = (fragment: string) =>
      expect(
        out.some((line) => line.includes(fragment)),
        fragment,
      ).toBe(true);
    has("a check guide is never a stub");
    has('a geometry measure points at "adjust-suspension-sag", so it cannot be a stub');
    has("a stub has exactly one <Step> body (found 2)");
    has('<Step id="zzz"> is not a frontmatter step');
    has("a stub's <Step> needs ≥ 40 words (has 2)");
    expect(out.filter((line) => line.includes("clean-stub-fine"))).toEqual([]);
  });

  it("conditions: impossible paths and values, missing labels", () => {
    const root = makeRoot();
    writeGuide(
      root,
      baseDoc("clean-test-guide", {
        appliesTo: {
          any: [
            { path: "brakes.isDsic", in: [true] },
            { path: "brakes.type", in: ["disk"] },
          ],
        },
        steps: [{ id: "one", title: "Un", appliesTo: { path: "pedals", in: ["flat"] } }],
      }),
    );
    const guides = messagesFor(root, "en", "guides");
    const data = guides.read();
    delete (data.appliesTo.values as Record<string, Record<string, string>>).pedals.flat;
    guides.write(data);
    const out = check(root).map((e) => e.message);
    expect(out).toEqual(
      expect.arrayContaining([
        'appliesTo: "brakes.isDsic" is not a BikeSpec path',
        'appliesTo: "disk" is not a possible value of "brakes.type"',
        "missing message guides.appliesTo.values.pedals.flat in messages/en/guides.json",
      ]),
    );
  });

  it("steps and consequences", () => {
    const root = makeRoot();
    writeGuide(
      root,
      baseDoc("check-test-guide", {
        partIds: ["chain", "rear-derailleur"],
        steps: [
          {
            id: "one",
            title: "Un",
            partIds: ["chain"],
            checkQuestion: {
              prompt: "Ok ?",
              skippable: false,
              ko: [
                {
                  action: "replace",
                  partId: "chainz",
                  reasonKey: "not-a-reason",
                  guideSlug: "replace-chain",
                },
                {
                  action: "inspect-shop",
                  partId: "chain",
                  reasonKey: "chain-elongation",
                  guideSlug: "replace-chain",
                },
                {
                  action: "fix",
                  partId: "rear-derailleur",
                  reasonKey: "shifting-imprecise",
                  guideSlug: "clean-chain",
                },
                {
                  action: "clean",
                  partId: "chain",
                  reasonKey: "chain-dirty",
                  guideSlug: "clean-not-written",
                },
              ],
            },
          },
        ],
      }),
    );
    const defaults = check(root).map((e) => e.message);
    expect(defaults).toEqual(
      expect.arrayContaining([
        'unknown part id "chainz"',
        "missing message guides.reasons.not-a-reason in messages/fr/guides.json",
        'an "inspect-shop" consequence has no guide',
        '"fix" needs an adjust guide, but "clean-chain" is a clean guide',
      ]),
    );
    expect(defaults.some((m) => m.includes("clean-not-written"))).toBe(false);
    expect(check(root, true).map((e) => e.message)).toContain(
      'guide "clean-not-written" does not exist',
    );
  });

  it("reports a step's unknown part", () => {
    const root = makeRoot();
    writeGuide(
      root,
      baseDoc("clean-test-guide", {
        partIds: ["chain", "ghost"],
        steps: [{ id: "one", title: "Un", partIds: ["ghost"] }],
      }),
    );
    const out = check(root).map((e) => `${e.line}: ${e.message}`);
    // Once in partIds, once in the step (both locales).
    expect(out.filter((line) => line.endsWith('unknown part id "ghost"'))).toHaveLength(4);
  });
});

describe("MDX body", () => {
  it("allows only literal, known components and no code", () => {
    const root = makeRoot();
    const doc = baseDoc("clean-test-guide", {
      steps: [{ id: "one", title: "Un", illustration: "pad-wear-disc" }],
    });
    doc.body = [
      'import x from "y"',
      "",
      '<Step id="one">',
      "",
      `${WORDS} {1 + 1}`,
      "",
      '<Tool id="nope" alt="nope2" /> <Tool id={"rags"} /> <Tool id="rags" colour="red" /> <Tool />',
      "",
      '<Warning level="loud">Hey</Warning>',
      "",
      '<Measure id="inseam" unit="inch" />',
      "",
      '<Illustration id="pad-wear-disc" /> <Illustration id="ghost-drawing" />',
      "",
      "<Banner />",
      "",
      '<Step id="nested">x</Step>',
      "",
      "</Step>",
      "",
    ].join("\n");
    const dir = writeGuide(root, doc);
    const out = check(root)
      .filter((e) => e.file === `${dir}/fr.mdx`)
      .map((e) => `${e.line}: ${e.message}`);
    expect(out).toEqual(
      expect.arrayContaining([
        expect.stringMatching(/^\d+: import\/export is not allowed in guide MDX$/),
        expect.stringMatching(/JavaScript expressions \(\{…\}\) are not allowed/),
        expect.stringMatching(/<Tool id="nope">: unknown tool/),
        expect.stringMatching(/<Tool alt="nope2">: unknown tool/),
        expect.stringMatching(/<Tool>: attributes must be literal strings/),
        expect.stringMatching(/<Tool>: unknown attribute "colour"/),
        expect.stringMatching(/<Tool>: missing required attribute "id"/),
        expect.stringMatching(/<Warning level="loud">: use one of info, caution, danger/),
        expect.stringMatching(/<Measure id="inseam">: not a geometry measure id/),
        expect.stringMatching(/<Measure unit="inch">: use one of mm, cm, bar, percent/),
        expect.stringMatching(
          /<Illustration id="pad-wear-disc"> repeats a step's frontmatter illustration/,
        ),
        expect.stringMatching(/unknown illustration id "ghost-drawing"/),
        expect.stringMatching(/<Banner> is not a guide component/),
        expect.stringMatching(/<Step> cannot be nested inside another <Step>/),
      ]),
    );
  });

  it("accepts every component used correctly", () => {
    const root = makeRoot();
    const doc = baseDoc("measure-test-guide", { partIds: ["saddle"] });
    doc.body = [
      '<Step id="one">',
      "",
      WORDS,
      "",
      '<Tool id="tape-measure" alt="steel-ruler" />',
      "",
      '<Warning level="caution">',
      "",
      "Careful.",
      "",
      "</Warning>",
      "",
      '<Measure id="saddle-height" unit="mm" target="74 cm" />',
      "",
      '<Illustration id="saddle-height-heel-method" caption="Heel on the pedal" />',
      "",
      "</Step>",
      "",
    ].join("\n");
    const dir = writeGuide(root, doc);
    expect(messages(root).filter((line) => line.startsWith(dir))).toEqual([]);
  });

  it("rejects insecure links", () => {
    const root = makeRoot();
    const doc = baseDoc();
    doc.body = `<Step id="one">\n\n${WORDS} http://example.com\n\n</Step>\n`;
    const dir = writeGuide(root, doc);
    expect(messages(root)).toContainEqual(
      expect.stringMatching(new RegExp(`^${dir}/fr\\.mdx:\\d+: insecure link: use https://$`)),
    );
  });
});

describe("registry, messages and parity", () => {
  it("an illustration without a component, and without alt text", () => {
    const root = makeRoot();
    writeGuide(
      root,
      baseDoc("clean-test-guide", {
        steps: [{ id: "one", title: "Un", illustration: "presta-valve-core" }],
      }),
    );
    unlinkSync(join(root, "components", "illustrations", "IllPrestaValveCore.tsx"));
    const catalogue = messagesFor(root, "fr", "illustrations");
    const data = catalogue.read();
    delete data["presta-valve-core"].alt;
    catalogue.write(data);
    expect(check(root).map((e) => e.message)).toEqual(
      expect.arrayContaining([
        'illustration "presta-valve-core" has no component components/illustrations/IllPrestaValveCore.tsx',
        "missing message illustrations.presta-valve-core.alt in messages/fr/illustrations.json",
      ]),
    );
  });

  it("callout counts must match the message keys", () => {
    const root = makeRoot();
    const catalogue = messagesFor(root, "en", "illustrations");
    const data = catalogue.read();
    delete (data["pad-wear-disc"].callouts as Record<string, string>)["3"];
    catalogue.write(data);
    expect(messages(root)).toContain(
      'components/illustrations/IllPadWearDisc.tsx:1: illustration "pad-wear-disc" draws 3 callout(s) but messages/en/illustrations.json has 2',
    );
  });

  it("a tool label missing from a catalogue, a missing catalogue, an invalid one", () => {
    const root = makeRoot();
    const tools = messagesFor(root, "en", "tools");
    const data = tools.read();
    delete data.rags;
    tools.write(data);
    expect(check(root).map((e) => e.message)).toContain(
      "missing message tools.rags.label in messages/en/tools.json",
    );

    unlinkSync(join(root, "messages", "fr", "tools.json"));
    writeFileSync(join(root, "messages", "fr", "guides.json"), "{ nope");
    const out = messages(root);
    expect(out).toContain(
      "messages/fr/tools.json:1: missing message catalogue messages/fr/tools.json",
    );
    expect(out.some((line) => line.startsWith("messages/fr/guides.json:1: invalid JSON"))).toBe(
      true,
    );
  });

  it("FR and EN must agree on structure", () => {
    const root = makeRoot();
    const fr = baseDoc("clean-test-guide", { steps: [{ id: "one", title: "Un" }] });
    const en = baseDoc("clean-test-guide", {
      minutes: 9,
      steps: [{ id: "one", title: "One", partIds: ["chain"] }],
    });
    const dir = writeGuide(root, fr, en);
    expect(messages(root)).toEqual(
      expect.arrayContaining([
        `${dir}/en.mdx:9: "minutes" differs from fr.mdx`,
        expect.stringMatching(/en\.mdx:\d+: steps\[0\] differs from fr\.mdx/),
      ]),
    );
  });

  it("retailer templates are https with {q} exactly once", () => {
    const original = RETAILERS.rosebikes.byLocale.fr;
    const mutable = RETAILERS.rosebikes.byLocale as Record<string, unknown>;
    try {
      mutable.fr = { kind: "search", template: "http://www.rosebikes.fr/search?q={q}&again={q}" };
      const out = check(makeRoot({ content: false })).map((e) => e.message);
      expect(out).toEqual(
        expect.arrayContaining([
          'rosebikes (fr): "http://www.rosebikes.fr/search?q={q}&again={q}" is not https',
          "rosebikes (fr): the search template needs {q} exactly once",
        ]),
      );
    } finally {
      mutable.fr = original;
    }
  });
});

describe("strict mode", () => {
  it("brake and battery guides need safety notes", () => {
    const root = makeRoot();
    writeGuide(root, baseDoc("check-rotor-guide", { partIds: ["rotor-front"] }));
    writeGuide(
      root,
      baseDoc("check-battery-guide", {
        partIds: ["e-battery"],
        safety: ["Ne court-circuitez pas la batterie."],
      }),
    );
    const out = check(root, true).map((e) => `${e.file}: ${e.message}`);
    expect(out).toContain(
      "content/guides/check-rotor-guide/fr.mdx: a guide touching a brake line or a rotor needs at least one safety note",
    );
    expect(out.some((line) => line.includes("check-battery-guide"))).toBe(false);
  });

  it("every rendered part is checked, directly or through a hosted part", () => {
    const root = makeRoot();
    // The real corpus checks every rendered part; take away the two guides whose
    // steps check the chain to open a gap.
    for (const slug of ["check-drivetrain", "check-hub-gear"]) {
      rmSync(join(root, "content", "guides", slug), { recursive: true, force: true });
    }
    const out = check(root, true).map((e) => e.message);
    expect(out).toContain('rendered part "chain" is not covered by any check step');
    // brake-caliper-front is covered by check-brakes-disc (directly), rotor-front too.
    expect(out).not.toContain(
      'rendered part "brake-caliper-front" is not covered by any check step',
    );
    // A step listing only a hosted part covers its host.
    writeGuide(
      root,
      baseDoc("check-tube-guide", {
        partIds: ["tube-front"],
        steps: [{ id: "one", title: "Un", partIds: ["tube-front"] }],
      }),
    );
    expect(check(root, true).map((e) => e.message)).not.toContain(
      'rendered part "tire-front" is not covered by any check step',
    );
  });

  it("brands.yaml: missing, invalid, and well-formed but wrong", () => {
    const root = makeRoot();
    rmSync(join(root, "content", "brands.yaml"), { force: true });
    expect(messages(root, true)).toContain("content/brands.yaml:1: missing content/brands.yaml");
    writeFileSync(join(root, "content", "brands.yaml"), "a: [");
    expect(
      messages(root, true).some((line) => line.startsWith("content/brands.yaml:1: invalid YAML")),
    ).toBe(true);
    writeFileSync(join(root, "content", "brands.yaml"), "");
    expect(messages(root, true)).toContain("content/brands.yaml:1: brands.yaml lists no part");
    writeFileSync(
      join(root, "content", "brands.yaml"),
      stringify({ chain: { entry: ["KMC"], mid: ["Shimano"], high: [] }, sprocket: "x" }),
    );
    const out = messages(root, true);
    expect(out).toEqual(
      expect.arrayContaining([
        'content/brands.yaml:1: brands.yaml: "chain" needs a non-empty "high" tier',
        'content/brands.yaml:1: brands.yaml: unknown part id "sprocket"',
        'content/brands.yaml:1: brands.yaml: "sprocket" needs a non-empty "entry" tier',
      ]),
    );
    expect(out.some((line) => line.includes('"chain" needs a non-empty "entry"'))).toBe(false);
  });
});

describe("helpers and the generated manifest", () => {
  it("counts words and callouts", () => {
    expect(countWords("Un vélo, 2 roues — et… ?")).toBe(5);
    expect(
      calloutsInSource(
        '<circle data-callout="1" /><circle data-callout="2" /><circle data-callout="2" />',
      ),
    ).toBe(2);
    expect(calloutsInSource("<rect />")).toBe(0);
  });

  it("builds the manifest from the frontmatter and renders the three modules", () => {
    const manifest = buildContentManifest(REPO);
    expect(manifest.slugs).toEqual(
      expect.arrayContaining(["check-brakes-disc", "clean-chain", "replace-brake-pads-disc"]),
    );
    expect(manifest.slugs).toEqual([...manifest.slugs].sort());
    expect(manifest.stepKeys).toContain("check-brakes-disc#pad-wear");
    expect(manifest.reasonKeys).toEqual(expect.arrayContaining(["chain-elongation", "pad-worn"]));
    expect(manifest.version).toMatch(/^[0-9a-f]{40}$/);

    const modules = renderGeneratedModules(manifest);
    expect(Object.keys(modules).sort()).toEqual(["reason-keys.ts", "slugs.ts", "version.ts"]);
    expect(modules["version.ts"]).toContain(`CONTENT_VERSION = "${manifest.version}"`);
    expect(modules["slugs.ts"]).toContain('"check-brakes-disc#pad-wear",');
    expect(modules["reason-keys.ts"]).toContain('"pad-worn",');
  });

  it("skips invalid guides and a missing catalogue when building the manifest", () => {
    const root = makeRoot();
    writeFileSync(join(root, "content", "guides", "clean-chain", "fr.mdx"), "---\nslug: 3\n---\n");
    unlinkSync(join(root, "messages", "fr", "guides.json"));
    const manifest = buildContentManifest(root);
    expect(manifest.slugs).toContain("clean-chain");
    expect(manifest.stepKeys.some((key) => key.startsWith("clean-chain#"))).toBe(false);
    expect(manifest.reasonKeys).toEqual([]);
  });
});
