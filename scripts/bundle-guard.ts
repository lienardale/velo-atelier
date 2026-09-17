#!/usr/bin/env tsx
/**
 * What the browser is allowed to download (§3.6 AC7, §5.8 AC1).
 *
 * Two invariants that only the build output can prove, checked over every file
 * in `.next/static`:
 *
 *   1. NO RUNTIME EVALUATOR. `new Function(…)` / `eval(…)` must not ship. MDX
 *      is compiled to JS at build time by content-collections and rendered in a
 *      server component, so no guide body is ever evaluated in the browser —
 *      that is what lets `next.config.ts` serve a `script-src` without
 *      `unsafe-eval`. `tests/security/xss-form-inputs.test.ts` greps our own
 *      source for the same thing; this catches a *dependency* that bundles one.
 *
 *   2. THE TEST HOOKS FOLLOW THEIR BUILD-TIME FLAG. `window.__va` is a remote
 *      control for the 3D viewer (focus parts, force a context loss, read the
 *      renderer). `components/bike3d/BikeViewer.tsx` references PerfProbe only
 *      when `NEXT_PUBLIC_TEST_HOOKS === "1"` at build time, so the probe must
 *      be in the bundle when the flag is on and absent when it is not. Both
 *      directions are asserted, because "absent" is only meaningful if we know
 *      the marker would have been found had it been there.
 *
 * Run after `next build`, wherever the build happens:
 *   - `scripts/ci/build.sh` (CI build job, `npm run ci:local`) — CI builds with
 *     the flag ON for the e2e artifact, `ci:local` builds with it off;
 *   - `scripts/vercel-build.sh` — the build that actually ships. Production
 *     always has the flag off, so this is the deploy-blocking half.
 */
/* eslint-disable security/detect-non-literal-fs-filename -- fixed paths under .next/static */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

const STATIC_DIR = join(process.cwd(), ".next", "static");

/** Files a browser can execute. `.map` is excluded: it ships source text. */
const EXECUTABLE = /\.(?:js|mjs)$/;

interface Rule {
  readonly name: string;
  readonly pattern: RegExp;
  /** true: the marker must be present. false: it must be absent. */
  readonly expected: boolean;
  readonly why: string;
}

/**
 * `__va` is the object installed on `window`; `installE2EHooks` is the exported
 * function that installs it. Minification renames neither (one is a property
 * name in a string-keyed assignment, the other is matched as a substring of the
 * module's own identifier only when unminified) — so the presence direction
 * matches on either, and the absence direction fails on either.
 */
const HOOK_MARKERS = /__va\b|installE2EHooks/;

function rules(): Rule[] {
  const hooksOn = process.env.NEXT_PUBLIC_TEST_HOOKS === "1";
  return [
    {
      name: "no runtime evaluator",
      pattern: /\bnew Function\s*\(|(?<![.\w$])eval\s*\(/,
      expected: false,
      why: "MDX is compiled at build time; script-src has no 'unsafe-eval' (§5.8 AC1)",
    },
    {
      name: hooksOn ? "test hooks present (NEXT_PUBLIC_TEST_HOOKS=1)" : "no test hooks",
      pattern: HOOK_MARKERS,
      expected: hooksOn,
      why: hooksOn
        ? "the e2e artifact needs window.__va; a missing probe means the gate broke"
        : "window.__va is a remote control for the viewer and must never ship (§3.6 AC7)",
    },
  ];
}

function* walk(dir: string): Generator<string> {
  for (const entry of readdirSync(dir)) {
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) yield* walk(path);
    else if (EXECUTABLE.test(entry)) yield path;
  }
}

function main(): void {
  let files: string[];
  try {
    files = [...walk(STATIC_DIR)];
  } catch {
    console.error(`bundle-guard: ${STATIC_DIR} does not exist — run \`next build\` first`);
    process.exit(1);
  }
  if (files.length === 0) {
    console.error(`bundle-guard: no JavaScript under ${STATIC_DIR}`);
    process.exit(1);
  }

  let failed = false;
  for (const rule of rules()) {
    const hits = files.filter((file) => rule.pattern.test(readFileSync(file, "utf8")));
    const ok = rule.expected ? hits.length > 0 : hits.length === 0;
    const count = rule.expected ? `${hits.length} file(s)` : `${hits.length} hit(s)`;
    console.log(`  ${ok ? "✓" : "✗"} ${rule.name} — ${count}`);
    if (ok) continue;
    failed = true;
    console.error(`bundle-guard: ${rule.name} — ${rule.why}`);
    if (rule.expected) {
      console.error("  expected the marker in .next/static, found none");
    } else {
      for (const hit of hits.slice(0, 10)) {
        console.error(`  ${hit.slice(process.cwd().length + 1)}`);
      }
      if (hits.length > 10) console.error(`  … and ${hits.length - 10} more`);
    }
  }

  if (failed) process.exit(1);
  console.log(`bundle-guard: ${files.length} file(s) checked, no problem.`);
}

main();
