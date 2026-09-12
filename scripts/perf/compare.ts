#!/usr/bin/env tsx
/**
 * Compare a perf run against the recorded baselines.
 *
 * The hard WebGL counters (draw calls, triangles, texture memory, DPR,
 * drawing-buffer size) are asserted inside the Playwright perf specs — they are
 * deterministic, so they belong where they fail loudly. THIS script owns the
 * part that is not deterministic: frame times. CI renders through SwiftShader
 * (software rasteriser), so an absolute millisecond number there is meaningless
 * and only the ratio to a baseline recorded on the same runner says anything.
 *
 * One ladder everywhere (PR and nightly), per §7.3:
 *     ≤ 150 % of baseline   ok
 *     > 150 %               warning in the job summary
 *     > 300 %               hard failure
 *
 * Baselines are refreshed only from a workflow run:
 * `UPDATE_PERF_BASELINE=1` outside GitHub Actions exits 1, so a laptop's
 * numbers (a real GPU — 10× faster) can never become the CI baseline.
 *
 * Contract with the perf specs (W4-T2 writes these files):
 *   .perf/<project>.json                  the run
 *   tests/perf/baselines/<project>.json   the baseline
 *   { "runner": "ubuntu-latest", "three": "0.185.1",
 *     "presets": { "<preset>": { "p95FrameMs": 21.4, "drawCalls": 63, ... } } }
 */
import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  writeFileSync,
  appendFileSync,
} from "node:fs";
import path from "node:path";

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
  presets: Record<string, PresetMetrics>;
}

interface Ladder {
  warnPct: number;
  failPct: number;
}

/** Metrics that are a duration and therefore subject to the ladder. */
const TIMING_METRICS = new Set([
  "p50FrameMs",
  "p95FrameMs",
  "longFrames",
  "buildMs",
  "tapLatencyMs",
]);

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

function report(lines: string[]): void {
  const text = lines.join("\n");
  console.log(text);
  const summaryFile = process.env.GITHUB_STEP_SUMMARY;
  if (summaryFile) {
    appendFileSync(summaryFile, `\n### Perf vs baseline\n\n${text}\n`);
  }
}

function updateBaselines(runs: string[]): void {
  if (process.env.GITHUB_ACTIONS !== "true") {
    console.error(
      "UPDATE_PERF_BASELINE=1 is only allowed inside GitHub Actions: a baseline recorded on a\n" +
        "real GPU would make the SwiftShader CI numbers look like a 10x regression forever.\n" +
        "Use the perf.yml workflow_dispatch with update_baseline=true.",
    );
    process.exit(1);
  }
  mkdirSync(BASELINE_DIR, { recursive: true });
  for (const file of runs) {
    const target = path.join(BASELINE_DIR, path.basename(file));
    writeFileSync(target, readFileSync(file));
    console.log(`baseline updated: ${path.relative(ROOT, target)}`);
  }
}

function main(): void {
  const wantsUpdate = process.env.UPDATE_PERF_BASELINE === "1";

  if (!existsSync(RUN_DIR)) {
    if (wantsUpdate) updateBaselines([]);
    console.warn(
      "WARNING: no .perf/ directory — the perf specs have not run yet, nothing to compare.",
    );
    return;
  }

  const runs = readdirSync(RUN_DIR)
    .filter((f) => f.endsWith(".json"))
    .map((f) => path.join(RUN_DIR, f));

  if (runs.length === 0) {
    console.warn("WARNING: .perf/ contains no run files — nothing to compare.");
    return;
  }

  if (wantsUpdate) {
    updateBaselines(runs);
    return;
  }

  const { warnPct, failPct } = ladder();
  const lines = [
    "| project | preset | metric | run | baseline | vs baseline | verdict |",
    "|---|---|---|---|---|---|---|",
  ];
  const warnings: string[] = [];
  const failures: string[] = [];

  for (const runFile of runs) {
    const project = path.basename(runFile, ".json");
    const baselineFile = path.join(BASELINE_DIR, `${project}.json`);
    if (!existsSync(baselineFile)) {
      console.warn(
        `WARNING: no baseline for '${project}' — run perf.yml with update_baseline=true.`,
      );
      continue;
    }

    const run = readJson<PerfFile>(runFile);
    const baseline = readJson<PerfFile>(baselineFile);

    if (baseline.three && run.three && baseline.three !== run.three) {
      warnings.push(
        `${project}: baseline was recorded against three ${baseline.three}, this run uses ${run.three}`,
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
          lines.push(
            `| ${project} | ${preset} | ${metric} | ${value} | ${before} | — | hard gate in spec |`,
          );
          continue;
        }
        const pct =
          before === 0 ? (value === 0 ? 100 : Number.POSITIVE_INFINITY) : (value / before) * 100;
        let verdict = "ok";
        if (pct > failPct) {
          verdict = "FAIL";
          failures.push(
            `${project}/${preset}/${metric}: ${value} vs ${before} (${pct.toFixed(0)} %)`,
          );
        } else if (pct > warnPct) {
          verdict = "warn";
          warnings.push(
            `${project}/${preset}/${metric}: ${value} vs ${before} (${pct.toFixed(0)} %)`,
          );
        }
        lines.push(
          `| ${project} | ${preset} | ${metric} | ${value} | ${before} | ${Number.isFinite(pct) ? `${pct.toFixed(0)} %` : "∞"} | ${verdict} |`,
        );
      }
    }
  }

  report(lines);

  if (warnings.length > 0) {
    report(["", `**Warnings (> ${warnPct} % of baseline)**`, ...warnings.map((w) => `- ${w}`)]);
  }
  if (failures.length > 0) {
    report(["", `**Failures (> ${failPct} % of baseline)**`, ...failures.map((f) => `- ${f}`)]);
    console.error("Perf regression beyond the hard ladder.");
    process.exit(1);
  }
}

/* eslint-enable security/detect-non-literal-fs-filename */

main();
