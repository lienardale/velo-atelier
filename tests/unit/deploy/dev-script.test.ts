/**
 * `npm run dev` on a clean clone.
 *
 * `lib/content/generated/` is gitignored, and the checkup route imports it
 * (`app/[locale]/velo/[id]/controle/{actions,load,page}`, `lib/checkup/**`).
 * `npm run build` and `npm run typecheck` generate it; until W5 `npm run dev`
 * did not. On a checkout that had ever been built the tree was simply there,
 * so nobody saw it — the README's quick start, followed on a fresh clone on
 * 2026-10-07, answered 500 on the first checkup page ("Module not found:
 * Can't resolve '@/lib/content/generated/reason-keys'"), and after that one
 * request the Turbopack dev server answered 500 on EVERY route until the tree
 * was generated (`.debug/017` §5.6).
 *
 * It is the same failure CLAUDE.md records for CI ("every CI job is a fresh
 * checkout, so a job that compiles or runs code which imports one of these
 * must generate it first"), one step earlier: the first thing a contributor
 * runs.
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

const scripts = (
  JSON.parse(readFileSync(join(process.cwd(), "package.json"), "utf8")) as {
    scripts: Record<string, string>;
  }
).scripts;

/** The position of one `&&`-separated command in a script, or -1. */
function at(script: string, command: string): number {
  return script
    .split("&&")
    .map((part) => part.trim())
    .indexOf(command);
}

describe("the scripts that start or compile the app generate lib/content/generated first", () => {
  it.each(["dev", "build"])("`npm run %s` runs content:generate before next", (name) => {
    // eslint-disable-next-line security/detect-object-injection -- `name` is one of the two literals above
    const script = scripts[name] ?? "";
    const generate = at(script, "npm run content:generate");
    const next = at(script, `next ${name}`);

    expect(generate, `${name} does not generate the content tree`).toBeGreaterThanOrEqual(0);
    expect(next, `${name} does not start next`).toBeGreaterThanOrEqual(0);
    expect(generate).toBeLessThan(next);
  });

  it("`content:generate` is the emitting run of the content check", () => {
    expect(scripts["content:generate"]).toBe("tsx scripts/content-check.ts --emit");
  });
});
