#!/usr/bin/env tsx
/**
 * Lighthouse, run by run — and the pins the runs support.
 *
 * `lhci autorun` asserts on the MEDIAN of its runs and prints only what
 * failed. That is the right gate and the wrong record: `.debug/010` §11 found
 * home "passing at 297.8–357.4 across three runs of one CI job" against a
 * 300 ms bar, and the only way to see that was to open the artifact. This
 * script reads every run lhci collected (`.lighthouseci/lhr-*.json`) and prints,
 * per URL, each run and the median, to the log and to `$GITHUB_STEP_SUMMARY`,
 * then writes `.lighthouseci/summary.json`. That table — the nightly's five
 * runs — is the single measured source every Lighthouse pin is taken from.
 *
 * THE PINNING RULE (bike pages only; the content bar is §7.3's and frozen):
 *
 *   performance (minScore)   new = max(current, min(0.70, floor₀.₀₁(median − 0.05)))
 *   LCP, TBT (maxNumeric)    new = min(current, max(target, ceil₅₀(median × 1.15)))
 *
 * where `median` is the WORSE of the two bike URLs' medians, since one
 * assertion holds both, and `target` is §7.3's bike bar (`BIKE_TARGET` in
 * lighthouserc.cjs: 0.70 / 3000 ms / 600 ms). A threshold only ever tightens:
 * a median already worse than the current threshold moves nothing and is
 * reported as a finding. It never goes past the target either — at the
 * target the bike page meets the plan, and lighthouserc.cjs's guard refuses a
 * bike threshold tighter than it. The margins are the ones the repo already
 * uses for measured pins: 0.05 is §7.3's own "pinned +0.05 after first
 * measurement", 15 % is the lazy chunk's `ceil(measured × 1.15)`.
 *
 *   npx tsx scripts/perf/lighthouse-report.ts            # after `lhci autorun`
 */
import { appendFileSync, existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";

const ROOT = process.cwd();
const LHCI_DIR = path.join(ROOT, ".lighthouseci");

interface Lhr {
  requestedUrl?: string;
  finalUrl?: string;
  finalDisplayedUrl?: string;
  runtimeError?: { code: string; message: string };
  categories?: Record<string, { score: number | null } | undefined>;
  audits?: Record<
    string,
    | {
        numericValue?: number;
        details?: { items?: Array<{ resourceType?: string; transferSize?: number }> };
      }
    | undefined
  >;
}

/** What one run measured. `null` = the audit did not produce a value. */
interface RunValues {
  performance: number | null;
  accessibility: number | null;
  bestPractices: number | null;
  seo: number | null;
  lcp: number | null;
  tbt: number | null;
  cls: number | null;
  scriptBytes: number | null;
}

type Metric = keyof RunValues;
const METRICS: Metric[] = [
  "performance",
  "lcp",
  "tbt",
  "cls",
  "accessibility",
  "bestPractices",
  "seo",
  "scriptBytes",
];

/* eslint-disable security/detect-non-literal-fs-filename, security/detect-object-injection --
   Every path is under `.lighthouseci/`, written by lhci in this job; every key
   is a metric name from the list above or a category/audit id of a report. */

function valuesOf(lhr: Lhr): RunValues {
  const score = (id: string) => lhr.categories?.[id]?.score ?? null;
  const numeric = (id: string) => lhr.audits?.[id]?.numericValue ?? null;
  const script =
    lhr.audits?.["resource-summary"]?.details?.items?.find((item) => item.resourceType === "script")
      ?.transferSize ?? null;
  return {
    performance: score("performance"),
    accessibility: score("accessibility"),
    bestPractices: score("best-practices"),
    seo: score("seo"),
    lcp: numeric("largest-contentful-paint"),
    tbt: numeric("total-blocking-time"),
    cls: numeric("cumulative-layout-shift"),
    scriptBytes: script,
  };
}

export function median(values: readonly number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1 ? sorted[middle]! : (sorted[middle - 1]! + sorted[middle]!) / 2;
}

function pathOf(url: string): string {
  try {
    return new URL(url).pathname;
  } catch {
    return url;
  }
}

function format(metric: Metric, value: number | null): string {
  if (value === null) return "—";
  switch (metric) {
    case "lcp":
    case "tbt":
      return value.toFixed(0);
    case "cls":
      return value.toFixed(3);
    case "scriptBytes":
      return value.toLocaleString("en-US");
    default:
      return value.toFixed(2);
  }
}

// ── the pin proposal ────────────────────────────────────────────────────────

interface Assertion {
  minScore?: number;
  maxNumericValue?: number;
}

interface LhciConfig {
  ci: {
    assert: {
      assertMatrix: Array<{
        matchingUrlPattern: string;
        assertions: Record<string, [string, Assertion] | string>;
      }>;
    };
  };
}

const BIKE_PATTERN = ".*/(velo|bike)/.*";
/** §7.3's bar for the bike pages, mirrored from lighthouserc.cjs `BIKE_TARGET`. */
const BIKE_TARGET = { performance: 0.7, lcp: 3000, tbt: 600 };

function current(config: LhciConfig, id: string): Assertion | null {
  const entry = config.ci.assert.assertMatrix.find((e) => e.matchingUrlPattern === BIKE_PATTERN);
  const assertion = entry?.assertions[id];
  return Array.isArray(assertion) ? assertion[1] : null;
}

function pinRows(
  medians: Map<string, Partial<Record<Metric, number | null>>>,
  config: LhciConfig,
): string[] {
  const bike = [...medians.entries()].filter(([url]) => new RegExp(BIKE_PATTERN).test(url));
  if (bike.length === 0) return [];
  const worst = (metric: Metric, higherIsWorse: boolean): number | null => {
    const values = bike.map(([, m]) => m[metric]).filter((v): v is number => typeof v === "number");
    if (values.length === 0) return null;
    return higherIsWorse ? Math.max(...values) : Math.min(...values);
  };

  const rows = [
    "| assertion | current | worse bike median | proposal | note |",
    "|---|---|---|---|---|",
  ];
  const perf = worst("performance", false);
  const perfNow = current(config, "categories:performance")?.minScore;
  if (perf !== null && perfNow !== undefined) {
    const candidate = Math.min(BIKE_TARGET.performance, Math.floor((perf - 0.05) * 100) / 100);
    const proposal = Math.max(perfNow, candidate);
    const note =
      perf < perfNow
        ? "FINDING: the median is below the current threshold — nothing to pin"
        : proposal >= BIKE_TARGET.performance
          ? `at §7.3's bike target (${BIKE_TARGET.performance}): the page meets the plan`
          : proposal === perfNow
            ? "unchanged (the margin leaves no room)"
            : "tighten";
    rows.push(
      `| categories:performance (minScore) | ${perfNow} | ${perf.toFixed(2)} | ${proposal.toFixed(2)} | ${note} |`,
    );
  }
  for (const [metric, id, target] of [
    ["lcp", "largest-contentful-paint", BIKE_TARGET.lcp],
    ["tbt", "total-blocking-time", BIKE_TARGET.tbt],
  ] as const) {
    const value = worst(metric, true);
    const now = current(config, id)?.maxNumericValue;
    if (value === null || now === undefined) continue;
    const candidate = Math.max(target, Math.ceil((value * 1.15) / 50) * 50);
    const proposal = Math.min(now, candidate);
    const note =
      value > now
        ? "FINDING: the median is above the current threshold — nothing to pin"
        : proposal <= target
          ? `at §7.3's bike target (${target}): the page meets the plan`
          : proposal === now
            ? "unchanged (the margin leaves no room)"
            : "tighten";
    rows.push(`| ${id} (maxNumericValue) | ${now} | ${value.toFixed(0)} | ${proposal} | ${note} |`);
  }
  return rows;
}

// ── main ────────────────────────────────────────────────────────────────────

function main(): void {
  if (!existsSync(LHCI_DIR)) {
    console.warn("lighthouse-report: no .lighthouseci/ — lhci collected nothing.");
    return;
  }
  const files = readdirSync(LHCI_DIR)
    .filter((name) => /^lhr-.*\.json$/.test(name))
    .sort();
  if (files.length === 0) {
    console.warn("lighthouse-report: .lighthouseci/ holds no lhr-*.json — nothing to report.");
    return;
  }

  const runs = new Map<string, RunValues[]>();
  const errors: string[] = [];
  for (const name of files) {
    const lhr = JSON.parse(readFileSync(path.join(LHCI_DIR, name), "utf8")) as Lhr;
    const url = pathOf(lhr.requestedUrl ?? lhr.finalDisplayedUrl ?? lhr.finalUrl ?? name);
    if (lhr.runtimeError)
      errors.push(`${url}: ${lhr.runtimeError.code} ${lhr.runtimeError.message}`);
    const list = runs.get(url) ?? [];
    list.push(valuesOf(lhr));
    runs.set(url, list);
  }

  const header = "| URL | run | perf | LCP ms | TBT ms | CLS | a11y | bp | seo | script B |";
  const lines = [header, "|---|---|---|---|---|---|---|---|---|---|"];
  const medians = new Map<string, Partial<Record<Metric, number | null>>>();
  for (const [url, values] of runs) {
    values.forEach((value, index) => {
      lines.push(
        `| \`${url}\` | ${index + 1} | ${METRICS.map((m) => format(m, value[m])).join(" | ")} |`,
      );
    });
    const med: Partial<Record<Metric, number | null>> = {};
    for (const metric of METRICS) {
      med[metric] = median(values.map((v) => v[metric]).filter((v): v is number => v !== null));
    }
    medians.set(url, med);
    lines.push(
      `| \`${url}\` | **median** | ${METRICS.map((m) => `**${format(m, med[m] ?? null)}**`).join(" | ")} |`,
    );
  }

  // lighthouserc.cjs is CommonJS (lhci's own loader); read it the same way.
  const load = createRequire(path.join(ROOT, "package.json"));
  const config = load(path.join(ROOT, "lighthouserc.cjs")) as LhciConfig;
  const pins = pinRows(medians, config);

  const runCount = Math.max(...[...runs.values()].map((v) => v.length));
  const text = [
    `### Lighthouse — every run and the median (${runs.size} URLs × ${runCount} runs)`,
    "",
    ...lines,
    ...(errors.length > 0 ? ["", "**Runtime errors**", ...errors.map((e) => `- ${e}`)] : []),
    ...(pins.length > 0
      ? [
          "",
          "#### Bike-page pin proposal (tighten only; rule in scripts/perf/lighthouse-report.ts)",
          "",
          ...pins,
        ]
      : []),
  ].join("\n");
  console.log(`\n${text}\n`);
  const summaryFile = process.env.GITHUB_STEP_SUMMARY;
  if (summaryFile) appendFileSync(summaryFile, `\n${text}\n`);

  writeFileSync(
    path.join(LHCI_DIR, "summary.json"),
    `${JSON.stringify(
      {
        runs: Object.fromEntries(runs),
        medians: Object.fromEntries(medians),
        pinProposal: pins,
      },
      null,
      2,
    )}\n`,
  );
}

/* eslint-enable security/detect-non-literal-fs-filename, security/detect-object-injection */

main();
