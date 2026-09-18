#!/usr/bin/env tsx
/**
 * Render the decision tree's drawings to `public/tree-drawings.json`.
 *
 *   npx tsx scripts/gen-tree-drawings.ts            # write the file
 *   npx tsx scripts/gen-tree-drawings.ts --check    # fail if it is stale
 *
 * **Why (`.debug/005`).** The home page asks one question at a time, but the
 * tree moves between questions on the client, so every drawing it can reach has
 * to be in the browser before the visitor asks for it. Handing all 54 to the
 * client tree as rendered nodes put 139 kB of shapes in the page's RSC payload
 * — a 322 kB document, 301 kB of it inline `self.__next_f.push(…)` script, for
 * the sake of the one drawing the first screen shows. It cost the home page
 * LCP 3.6 s, TBT 336 ms and a 0.81 Lighthouse score while every other page of
 * the site scored 0.96.
 *
 * The shapes now travel once, as this file: fetched after hydration, in
 * parallel, cached, and parsed into DOM only for the drawings actually shown.
 * `components/decision-tree/TreeDrawing.tsx` draws the frame, the accessible
 * name and the callout legend around them, in the visitor's locale — geometry
 * carries no words, so one file serves both locales.
 *
 * The drawings are still rendered from `components/illustrations`, by server
 * code: the 72-component barrel reaches no client bundle, which is the contract
 * in `CLAUDE.md`. It has to be a script rather than a route handler because
 * Turbopack refuses `react-dom/server` anywhere under `app/**`.
 *
 * Plain Node (`tsx`): no `server-only` in its import graph
 * (`tests/unit/no-server-only-in-scripts.test.ts`), which is why it reads the
 * message catalogue off disk instead of going through `lib/i18n/request.ts`.
 */
/* eslint-disable security/detect-non-literal-fs-filename -- every path is the repo root plus a literal from NAMESPACES */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { existsSync } from "node:fs";
import { join } from "node:path";

import { renderTreeGeometry } from "@/components/illustrations/tree-geometry";
import { NAMESPACES } from "@/lib/i18n/namespaces";

/** Where the browser fetches it from; `components/decision-tree/tree-drawings.ts` agrees. */
const OUTPUT = join(process.cwd(), "public", "tree-drawings.json");

/** The merged French catalogue, read straight off disk. */
function messages(): Record<string, unknown> {
  const merged: Record<string, unknown> = {};
  for (const namespace of NAMESPACES) {
    const file = join(process.cwd(), "messages", "fr", `${namespace}.json`);
    merged[namespace] = JSON.parse(readFileSync(file, "utf8")) as unknown;
  }
  return merged;
}

function main(): void {
  const check = process.argv.includes("--check");
  const json = `${JSON.stringify(renderTreeGeometry(messages()), null, 0)}\n`;
  const drawings = Object.keys(JSON.parse(json) as Record<string, string>).length;

  if (check) {
    const current = existsSync(OUTPUT) ? readFileSync(OUTPUT, "utf8") : "";
    if (current !== json) {
      console.error(
        "gen-tree-drawings: public/tree-drawings.json is stale — run `npx tsx scripts/gen-tree-drawings.ts`",
      );
      process.exit(1);
    }
    console.log(`gen-tree-drawings: up to date (${drawings} drawings).`);
    return;
  }

  mkdirSync(join(process.cwd(), "public"), { recursive: true });
  writeFileSync(OUTPUT, json, "utf8");
  console.log(
    `gen-tree-drawings: ${drawings} drawings, ${json.length} B → public/tree-drawings.json`,
  );
}

main();
