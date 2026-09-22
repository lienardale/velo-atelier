#!/usr/bin/env tsx
/**
 * Compare a perf run against the recorded baselines.
 *
 * The hard WebGL counters (draw calls, triangles, programs, materials, DPR,
 * drawing-buffer size, one context, geometry freed) are asserted inside the
 * Playwright perf specs — they are deterministic, so they belong where they
 * fail loudly. THIS script owns the part that is not deterministic: timings.
 * CI renders through SwiftShader (a software rasteriser), so an absolute
 * millisecond there is meaningless and only the ratio to a baseline recorded
 * on the same runner says anything.
 *
 * One ladder everywhere (PR and nightly), per §7.3 — `scripts/perf/ladder.ts`
 * holds it as pure functions, with the reasons:
 *     ≤ 150 % of baseline   ok
 *     > 150 %               warning in the job summary
 *     > 300 %               hard failure (exit 1)
 * `longFrames` is laddered on (run + 1) / (baseline + 1), and never fails on a
 * software renderer — which is every run this script compares, since CI draws
 * through SwiftShader (the W4 ruling, `.debug/012` §12). The durations are
 * plain ratios and keep their failure.
 *
 * Baselines are refreshed only from a workflow run: `UPDATE_PERF_BASELINE=1`
 * outside GitHub Actions exits 1 — whatever `.perf/` holds, including nothing —
 * so a laptop's numbers (a real GPU, 10× faster) can never become the CI
 * baseline. perf.yml's `update_baseline=true` sets it and opens the bot PR.
 *
 * Contract with the perf specs (tests/perf/_record.ts writes the run files):
 *   .perf/<project>.json                  the run
 *   .perf/local-<date>.json               the local GPU run — committed, never
 *                                         compared, never a baseline
 *   tests/perf/baselines/<project>.json   the baseline
 *   { "runner": "…", "three": "0.185.1", "presets": { "<preset>": {
 *       "p50FrameMs": 21.4, "p95FrameMs": 30.2, "longFrames": 2, "buildMs": 950,
 *       "tapLatencyMs": 61.3, "drawCalls": 63, … } } }
 */
import {
  appendFileSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";

import { isSoftwareRenderer, TIMING_METRICS, verdictOf, type Ladder } from "./ladder";

const ROOT = process.cwd();
const RUN_DIR = path.join(ROOT, ".perf");
const BASELINE_DIR = path.join(ROOT, "tests", "perf", "baselines");
const BUDGETS_FILE = path.join(ROOT, "perf.budgets.json");

interface PresetMetrics {
  [metric: string]: number;
}

interface PerfFile {
  runner?: string;
  three?: string;
  repetitions?: number;
  presets: Record<string, PresetMetrics>;
  samples?: unknown;
  [field: string]: unknown;
}

/** The committed local GPU run (`RUN_LOCAL_PERF=1`): a real GPU is not this runner. */
const LOCAL_RUN = /^local-.*\.json$/;

/* eslint-disable security/detect-non-literal-fs-filename --
   Paths come from `.perf/` and `tests/perf/baselines/` — directories this repo
   writes itself. This script runs in CI or from a developer's shell. */

function readJson<T>(file: string): T {
  return JSON.parse(readFileSync(file, "utf8")) as T;
}

function ladder(): Ladder {
  if (!existsSync(BUDGETS_FILE)) return { warnPct: 150, failPct: 300 };
  const budgets = readJson<{ timingLadder?: Ladder }>(BUDGETS_FILE);
  return budgets.timingLadder ?? { warnPct: 150, failPct: 300 };
}

/** Everything that goes to the job summary, written once under one heading. */
const summary: string[] = [];

function say(line: string): void {
  console.log(line);
  summary.push(line);
}

function warn(line: string): void {
  console.warn(`WARNING: ${line}`);
  summary.push(`> **Warning:** ${line}`);
}

function flushSummary(): void {
  const file = process.env.GITHUB_STEP_SUMMARY;
  if (file && summary.length > 0) {
    appendFileSync(file, `\n### Perf vs baseline\n\n${summary.join("\n")}\n`);
  }
}

function fail(message: string): never {
  console.error(message);
  summary.push(`> **Error:** ${message.split("\n")[0]}`);
  flushSummary();
  process.exit(1);
}

/** Run files of this run: `.perf/*.json`, minus the committed local GPU run. */
function runFiles(): string[] {
  if (!existsSync(RUN_DIR)) return [];
  return readdirSync(RUN_DIR)
    .filter((name) => name.endsWith(".json") && !LOCAL_RUN.test(name))
    .map((name) => path.join(RUN_DIR, name));
}

/**
 * A baseline as it is committed: the run's medians and provenance, without the
 * per-repetition samples. Plain objects only, so `JSON.stringify(…, null, 2)` is
 * exactly what Prettier writes and `prettier --check .` passes on the bot PR.
 */
function baselineOf(run: PerfFile): PerfFile {
  const baseline = { ...run };
  delete baseline.samples;
  return baseline;
}

function updateBaselines(runs: string[]): void {
  if (runs.length === 0) {
    fail(
      "UPDATE_PERF_BASELINE=1 but .perf/ holds no run file: the perf specs did not write one,\n" +
        "so there is nothing to record — and an empty baseline PR would hide that.",
    );
  }
  mkdirSync(BASELINE_DIR, { recursive: true });
  for (const file of runs) {
    const target = path.join(BASELINE_DIR, path.basename(file));
    writeFileSync(target, `${JSON.stringify(baselineOf(readJson<PerfFile>(file)), null, 2)}\n`);
    say(`- baseline updated: \`${path.relative(ROOT, target)}\``);
  }
  flushSummary();
}

function main(): void {
  const wantsUpdate = process.env.UPDATE_PERF_BASELINE === "1";

  // First, before looking at anything: a baseline is only ever recorded by CI.
  if (wantsUpdate && process.env.GITHUB_ACTIONS !== "true") {
    console.error(
      "UPDATE_PERF_BASELINE=1 is only allowed inside GitHub Actions: a baseline recorded on a\n" +
        "real GPU would make the SwiftShader CI numbers look like a 10x regression forever.\n" +
        "Use the perf.yml workflow_dispatch with update_baseline=true.",
    );
    process.exit(1);
  }

  const runs = runFiles();
  if (wantsUpdate) {
    updateBaselines(runs);
    return;
  }

  if (runs.length === 0) {
    warn(
      existsSync(RUN_DIR)
        ? ".perf/ contains no run file — the soft tier wrote nothing, nothing to compare."
        : "no .perf/ directory — the perf specs have not run yet, nothing to compare.",
    );
    flushSummary();
    return;
  }

  const { warnPct, failPct } = ladder();
  const rows = [
    "| project | preset | metric | run | baseline | vs baseline | verdict |",
    "|---|---|---|---|---|---|---|",
  ];
  const warnings: string[] = [];
  const failures: string[] = [];

  for (const runFile of runs) {
    const project = path.basename(runFile, ".json");
    const baselineFile = path.join(BASELINE_DIR, `${project}.json`);
    if (!existsSync(baselineFile)) {
      warn(`no baseline for '${project}' — run perf.yml with update_baseline=true.`);
      continue;
    }

    const run = readJson<PerfFile>(runFile);
    const baseline = readJson<PerfFile>(baselineFile);
    const software = isSoftwareRenderer(run.renderer);

    if (baseline.three && run.three && baseline.three !== run.three) {
      warnings.push(
        `${project}: baseline was recorded against three ${baseline.three}, this run uses ${run.three}`,
      );
    }
    if (baseline.runner && run.runner && baseline.runner !== run.runner) {
      warnings.push(
        `${project}: baseline was recorded on '${baseline.runner}', this run on '${run.runner}' — the ratios compare two machines`,
      );
    }

    for (const [preset, metrics] of Object.entries(run.presets ?? {})) {
      // eslint-disable-next-line security/detect-object-injection -- `preset` is a key of a JSON file this repo writes (.perf/), not user input.
      const baselinePreset = baseline.presets?.[preset];
      if (!baselinePreset) {
        warnings.push(`${project}/${preset}: no baseline for this preset`);
        continue;
      }
      for (const [metric, value] of Object.entries(metrics)) {
        // eslint-disable-next-line security/detect-object-injection -- same: `metric` is a key of our own perf JSON.
        const before = baselinePreset[metric];
        if (typeof before !== "number") continue;
        if (!TIMING_METRICS.has(metric)) {
          rows.push(
            `| ${project} | ${preset} | ${metric} | ${value} | ${before} | — | hard gate in spec |`,
          );
          continue;
        }
        const { pct, verdict, capped } = verdictOf(
          metric,
          value,
          before,
          { warnPct, failPct },
          software,
        );
        const shown = Number.isFinite(pct) ? `${pct.toFixed(0)} %` : "∞";
        const line = `${project}/${preset}/${metric}: ${value} vs ${before} (${shown})`;
        if (verdict === "FAIL") failures.push(line);
        else if (capped) {
          warnings.push(
            `${line} — past the fail line, but long frames never fail on a software renderer (.debug/012 §12)`,
          );
        } else if (verdict === "warn") warnings.push(line);
        rows.push(
          `| ${project} | ${preset} | ${metric} | ${value} | ${before} | ${shown} | ${capped ? "warn (software renderer)" : verdict} |`,
        );
      }
    }
  }

  // Header only means no run had a baseline: the warnings above already say so.
  if (rows.length > 2) for (const row of rows) say(row);
  if (warnings.length > 0) {
    say("");
    say(`**Warnings (> ${warnPct} % of baseline, or not comparable)**`);
    for (const line of warnings) say(`- ${line}`);
  }
  if (failures.length > 0) {
    say("");
    say(`**Failures (> ${failPct} % of baseline)**`);
    for (const line of failures) say(`- ${line}`);
    fail("Perf regression beyond the hard ladder.");
  }
  flushSummary();
}

/* eslint-enable security/detect-non-literal-fs-filename */

main();
