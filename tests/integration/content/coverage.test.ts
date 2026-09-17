/**
 * Guide coverage on disk (§5.7, §5.8 AC2/AC8) — the checkup backbone is complete.
 *
 *   1. Every slug of `EXPECTED_SLUGS` exists in `content/guides/<slug>/{fr,en}.mdx`.
 *      The `check-*` and `replace-*` guides (W2-T4a) are required now; a
 *      `clean-*` / `adjust-*` / `measure-*` guide that has not been written yet
 *      (W2-T4b) is a visible `todo` — never a silent pass — and its assertion
 *      runs, with no edit to this file, as soon as its folder exists.
 *   2. Every `FULL_SLUGS` guide on disk has `status: full` in both locales.
 *   3. For each of the 7 presets (`BIKE_PRESETS`), a full checkup
 *      (`{ kind: 'full' }`) plans at least one step for every rendered part of
 *      that bike, and every planned step comes from a `status: full` check guide.
 *      FR and EN plan exactly the same steps.
 *   4. The step ids the seed data and the checkup rely on (§4.5) are fixed.
 *   5. `content-check --strict` reports nothing for the check and replace
 *      guides or `content/brands.yaml`, except links to guides not written yet.
 *
 * The planner below is the §5.4 selection rule, restated so this test does not
 * depend on `lib/checkup` (W3-T1): a step is planned when its guide is a
 * `check` guide, the guide's and the step's `appliesTo` match the bike, and the
 * step's parts (or the guide's, when the step names none) meet the bike's
 * parts — a hosted part (pads, tube, headset…) counts for its host. A self-test
 * proves the gap detector fails when a guide is missing.
 */
/* eslint-disable security/detect-non-literal-fs-filename -- paths are content/guides joined with slugs from the manifest */
import { existsSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { matchesSpec } from "@/lib/content/applies-to";
import { runContentCheck } from "@/lib/content/check";
import { GUIDE_LOCALES, type GuideDocument } from "@/lib/content/types";
import { partDefinition, RENDERED_PART_IDS } from "@/lib/domain/data/parts";
import { BIKE_PRESETS, PRESET_IDS } from "@/lib/domain/data/presets";
import { buildBikeSpec } from "@/lib/domain/engine/build-bike-spec";
import { answerWithDefaults } from "@/lib/domain/engine/decision";
import { buildForSpec } from "@/lib/domain/engine/parts-for-spec";
import type { BikeBuild } from "@/lib/domain/schema/part";
import {
  EXPECTED_SLUGS,
  FULL_SLUGS,
  kindOfSlug,
  type GuideSlug,
} from "@/tests/fixtures/content-manifest";
import { GUIDES_DIR, readGuide, slugsOnDisk } from "@/tests/_helpers/guides";

type Locale = (typeof GUIDE_LOCALES)[number];
type Guide = GuideDocument & { body: string };

/** The kinds this task authors; the others are written in parallel (W2-T4b). */
const REQUIRED_KINDS = new Set(["check", "replace"]);
const full = new Set<string>(FULL_SLUGS);
const onDisk = new Set(slugsOnDisk());

const guidesIn = (locale: Locale): Guide[] =>
  [...onDisk].sort().map((slug) => readGuide(slug, locale));

// ── The §5.4 selection rule, for a full-scope checkup ────────────────────────

interface PlannedStep {
  key: string;
  guide: Guide;
  partIds: readonly string[];
}

function planFullCheckup(build: BikeBuild, guides: readonly Guide[]): PlannedStep[] {
  const onBike = new Set(build.parts.map((part) => part.partId));
  return guides
    .filter((guide) => guide.kind === "check" && matchesSpec(guide.appliesTo, build.spec))
    .flatMap((guide) =>
      guide.steps
        .filter((step) => matchesSpec(step.appliesTo, build.spec))
        .map((step) => ({
          key: `${guide.slug}#${step.id}`,
          guide,
          partIds: step.partIds ?? guide.partIds,
        }))
        .filter((step) => step.partIds.some((id) => onBike.has(id))),
    );
}

/** The rendered parts of `build` that no planned step checks, directly or through a hosted part. */
function uncoveredRenderedParts(build: BikeBuild, steps: readonly PlannedStep[]): string[] {
  const covered = new Set<string>();
  for (const step of steps) {
    for (const id of step.partIds) {
      covered.add(id);
      const host = partDefinition(id)?.hostPartId;
      if (host) covered.add(host);
    }
  }
  const rendered = new Set<string>(RENDERED_PART_IDS);
  return build.parts
    .map((part) => part.partId)
    .filter((id) => rendered.has(id) && !covered.has(id));
}

const presetBuild = (answers: (typeof BIKE_PRESETS)[keyof typeof BIKE_PRESETS]): BikeBuild =>
  buildForSpec(buildBikeSpec(answerWithDefaults(answers)));

// ── 1–2. The slug contract on disk ───────────────────────────────────────────

describe("guide slugs on disk", () => {
  for (const slug of EXPECTED_SLUGS) {
    const required = REQUIRED_KINDS.has(kindOfSlug(slug));
    if (!required && !existsSync(join(GUIDES_DIR, slug))) {
      it.todo(`${slug}: fr.mdx and en.mdx (content/guides/${slug} not written yet — W2-T4b)`);
      continue;
    }
    it(`${slug}: fr.mdx and en.mdx exist${full.has(slug) ? ", status full in both" : ""}`, () => {
      for (const locale of GUIDE_LOCALES) {
        expect(existsSync(join(GUIDES_DIR, slug, `${locale}.mdx`)), `${slug}/${locale}.mdx`).toBe(
          true,
        );
        const guide = readGuide(slug, locale);
        expect(guide.slug).toBe(slug);
        expect(guide.kind).toBe(kindOfSlug(slug as GuideSlug));
        if (full.has(slug)) expect(guide.status, `${slug}/${locale}.mdx`).toBe("full");
      }
    });
  }

  it("every check guide on disk is full (check guides are never stubs)", () => {
    for (const locale of GUIDE_LOCALES) {
      for (const guide of guidesIn(locale).filter((g) => g.kind === "check")) {
        expect(guide.status, `${guide.slug}/${locale}.mdx`).toBe("full");
      }
    }
  });
});

// ── 3. Every rendered part of every preset is checked by a full guide ────────

describe("a full checkup covers every rendered part", () => {
  const guides = { fr: guidesIn("fr"), en: guidesIn("en") };

  for (const presetId of PRESET_IDS) {
    // eslint-disable-next-line security/detect-object-injection -- presetId comes from PRESET_IDS
    const build = presetBuild(BIKE_PRESETS[presetId]);

    it(`${presetId}: every rendered part has ≥ 1 planned step, all from full check guides`, () => {
      const rendered = build.parts.filter((part) =>
        (RENDERED_PART_IDS as readonly string[]).includes(part.partId),
      );
      expect(rendered.length).toBeGreaterThan(10);

      for (const locale of GUIDE_LOCALES) {
        // eslint-disable-next-line security/detect-object-injection -- locale from GUIDE_LOCALES
        const steps = planFullCheckup(build, guides[locale]);
        expect(steps.length, locale).toBeGreaterThan(0);
        expect(uncoveredRenderedParts(build, steps), `${presetId} (${locale})`).toEqual([]);
        for (const step of steps) expect(step.guide.status, step.key).toBe("full");
      }

      const keys = (locale: Locale) =>
        // eslint-disable-next-line security/detect-object-injection -- locale from GUIDE_LOCALES
        planFullCheckup(build, guides[locale]).map((step) => step.key);
      expect(keys("en")).toEqual(keys("fr"));
    });
  }

  it("the gap detector fails when a check guide is missing (self-test)", () => {
    const build = presetBuild(BIKE_PRESETS["road-rim-2x11"]);
    const withoutPedals = guides.fr.filter((guide) => guide.slug !== "check-pedals");
    expect(uncoveredRenderedParts(build, planFullCheckup(build, withoutPedals))).toEqual([
      "pedal-left",
      "pedal-right",
    ]);
  });

  it("a guide that does not apply to the bike is not planned (road rim bike: no disc, no e-system)", () => {
    const build = presetBuild(BIKE_PRESETS["road-rim-2x11"]);
    const slugs = new Set(planFullCheckup(build, guides.fr).map((step) => step.guide.slug));
    expect(slugs.has("check-brakes-rim")).toBe(true);
    expect(slugs.has("check-brakes-disc")).toBe(false);
    expect(slugs.has("check-e-system")).toBe(false);
    expect(slugs.has("check-hub-gear")).toBe(false);
  });
});

// ── 4. Step ids other modules rely on ────────────────────────────────────────

describe("step id contract (§4.5 seed data)", () => {
  const CONTRACT: Record<string, string[]> = {
    "check-drivetrain": [
      "chain-wear",
      "cassette-teeth",
      "chainring-teeth",
      "derailleur-hanger",
      "shifting-index",
    ],
    "check-brakes-disc": ["pad-wear", "rotor-true", "lever-feel", "caliper-alignment", "hose-leak"],
  };

  for (const [slug, stepIds] of Object.entries(CONTRACT)) {
    it(`${slug} steps are exactly ${stepIds.join(", ")}`, () => {
      for (const locale of GUIDE_LOCALES) {
        expect(readGuide(slug, locale).steps.map((step) => step.id)).toEqual(stepIds);
      }
    });
  }

  it("the seeded KO consequences exist: chain-wear → chain-elongation, pad-wear → pad-worn (rear)", () => {
    const koOf = (slug: string, stepId: string) =>
      readGuide(slug, "fr").steps.find((step) => step.id === stepId)?.checkQuestion?.ko ?? [];
    expect(koOf("check-drivetrain", "chain-wear")).toContainEqual({
      action: "replace",
      partId: "chain",
      reasonKey: "chain-elongation",
      guideSlug: "replace-chain",
    });
    expect(koOf("check-brakes-disc", "pad-wear")).toContainEqual({
      action: "replace",
      partId: "brake-pads-rear",
      reasonKey: "pad-worn",
      guideSlug: "replace-brake-pads-disc",
    });
  });
});

// ── 5. Strict content check for this corpus ──────────────────────────────────

describe("content-check --strict (check, replace, brands.yaml)", () => {
  it("reports nothing but links to guides that are not written yet", () => {
    const { errors } = runContentCheck(process.cwd(), { strict: true });
    const pending = /guide "((?:clean|adjust|measure)-[a-z0-9-]+)" does not exist$/;
    const blocking = errors.filter((error) => {
      const target = pending.exec(error.message)?.[1];
      return !(target && !onDisk.has(target));
    });
    expect(blocking.map((e) => `${e.file}:${e.line}: ${e.message}`)).toEqual([]);
  });
});
