/**
 * The perf RUN FILE (§3.4, §7.3) — what one run of the soft tier measured, in
 * the contract `scripts/perf/compare.ts` reads:
 *
 *   .perf/<project>.json          a run on CI (or any SwiftShader run)
 *   .perf/local-<YYYY-MM-DD>.json the local GPU run (RUN_LOCAL_PERF=1), the
 *                                 one file of this directory that is committed
 *
 *   { project, runner, machine, renderer, three, runId, recordedAt, repetitions,
 *     presets: { "<preset>": { p50FrameMs, p95FrameMs, longFrames, buildMs,
 *                              tapLatencyMs, drawCalls, triangles, programs } },
 *     samples?: { "<preset>": { "<metric>": number[] } } }
 *
 * `presets` holds the MEDIAN of every repetition of this run: the nightly runs
 * the spec five times (`PERF_REPEAT=5` → `--repeat-each=5`) and each repetition
 * merges its sample into the same file, identified by `runId` — `PERF_RUN_ID`
 * when `scripts/ci/perf.sh` sets it, else the Playwright runner's pid (every
 * worker of one invocation is its child). A file left by an earlier run is
 * therefore replaced, never averaged in.
 *
 * `runner` and `three` are what compare.ts checks a baseline against: a
 * baseline is only meaningful on the runner class and the three release it was
 * recorded on. The committed local file carries no `samples` (plain objects
 * only, so `JSON.stringify(…, null, 2)` is exactly what Prettier would write).
 */
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { cpus } from "node:os";
import path from "node:path";

export const TIMING_METRICS = [
  "p50FrameMs",
  "p95FrameMs",
  "longFrames",
  "buildMs",
  "tapLatencyMs",
] as const;
export const COUNTER_METRICS = ["drawCalls", "triangles", "programs"] as const;

export type Metric = (typeof TIMING_METRICS)[number] | (typeof COUNTER_METRICS)[number];
export type PresetSample = Partial<Record<Metric, number>>;

export interface PerfRunFile {
  project: string;
  runner: string;
  machine: string;
  renderer: string;
  three: string;
  runId: string;
  recordedAt: string;
  repetitions: number;
  presets: Record<string, PresetSample>;
  samples?: Record<string, Partial<Record<Metric, number[]>>>;
}

/* eslint-disable security/detect-non-literal-fs-filename, security/detect-object-injection --
   Every path is `<repo>/.perf/…`, built from the project name Playwright gives
   and a date; every key is a preset id or a metric name from the lists above. */

export function median(values: readonly number[]): number {
  if (values.length === 0) return Number.NaN;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1 ? sorted[middle]! : (sorted[middle - 1]! + sorted[middle]!) / 2;
}

/** Nearest-rank percentile: the smallest sample with at least `p` % of the samples at or below it. */
export function percentile(values: readonly number[], p: number): number {
  if (values.length === 0) return Number.NaN;
  const sorted = [...values].sort((a, b) => a - b);
  const rank = Math.max(1, Math.ceil((p / 100) * sorted.length));
  return sorted[rank - 1]!;
}

/** One decimal for durations, whole numbers for counts: the file is read by people too. */
function round(metric: Metric, value: number): number {
  return (TIMING_METRICS as readonly string[]).includes(metric) && metric !== "longFrames"
    ? Math.round(value * 10) / 10
    : Math.round(value);
}

export function runId(): string {
  return process.env.PERF_RUN_ID ?? `pid-${process.ppid}`;
}

export function runnerLabel(): string {
  if (process.env.PERF_RUNNER) return process.env.PERF_RUNNER;
  if (process.env.GITHUB_ACTIONS === "true") {
    return ["github-actions", process.env.RUNNER_OS, process.env.RUNNER_ARCH]
      .filter(Boolean)
      .join(" ");
  }
  return "local";
}

export function machine(): string {
  const all = cpus();
  return `${all[0]?.model.trim() ?? "unknown CPU"} ×${all.length}`;
}

export function threeVersion(root: string): string {
  const file = path.join(root, "node_modules", "three", "package.json");
  return (JSON.parse(readFileSync(file, "utf8")) as { version: string }).version;
}

/**
 * `.perf/<project>.json`, or in local GPU mode `.perf/local-<date>.json` for the
 * desktop project `npm run perf:local` runs (`local-<date>-<project>.json` for
 * any other, so two projects never overwrite each other's day).
 */
export function runFilePath(
  root: string,
  project: string,
  local: boolean,
  date = new Date(),
): string {
  const day = date.toISOString().slice(0, 10);
  const name = !local ? project : project === "perf" ? `local-${day}` : `local-${day}-${project}`;
  return path.join(root, ".perf", `${name}.json`);
}

/**
 * Merge this repetition's per-preset samples into the run file and rewrite
 * the medians. Atomic (tmp + rename), so a crash never leaves half a file for
 * compare.ts to read.
 */
export function recordRun(options: {
  root: string;
  project: string;
  local: boolean;
  renderer: string;
  presets: Record<string, PresetSample>;
}): { file: string; run: PerfRunFile } {
  const file = runFilePath(options.root, options.project, options.local);
  const id = runId();
  let samples: Record<string, Partial<Record<Metric, number[]>>> = {};
  let repetitions = 0;
  if (existsSync(file)) {
    const previous = JSON.parse(readFileSync(file, "utf8")) as PerfRunFile;
    if (previous.runId === id && previous.samples) {
      samples = previous.samples;
      repetitions = previous.repetitions;
    }
  }

  for (const [preset, sample] of Object.entries(options.presets)) {
    const target = (samples[preset] ??= {});
    for (const [metric, value] of Object.entries(sample) as Array<[Metric, number | undefined]>) {
      if (value === undefined || !Number.isFinite(value)) continue;
      (target[metric] ??= []).push(value);
    }
  }
  repetitions += 1;

  const presets: Record<string, PresetSample> = {};
  for (const [preset, metrics] of Object.entries(samples)) {
    const out: PresetSample = {};
    for (const [metric, values] of Object.entries(metrics) as Array<[Metric, number[]]>) {
      out[metric] = round(metric, median(values));
    }
    presets[preset] = out;
  }

  const run: PerfRunFile = {
    project: options.project,
    runner: runnerLabel(),
    machine: machine(),
    renderer: options.renderer,
    three: threeVersion(options.root),
    runId: id,
    recordedAt: new Date().toISOString(),
    repetitions,
    presets,
    // The committed local file stays plain objects; CI keeps the samples so
    // the next repetition can merge into them.
    ...(options.local ? {} : { samples }),
  };

  mkdirSync(path.dirname(file), { recursive: true });
  const temporary = `${file}.${process.pid}.tmp`;
  writeFileSync(temporary, `${JSON.stringify(run, null, 2)}\n`);
  renameSync(temporary, file);
  return { file, run };
}

/* eslint-enable security/detect-non-literal-fs-filename, security/detect-object-injection */
