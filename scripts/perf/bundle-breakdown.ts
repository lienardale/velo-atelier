#!/usr/bin/env tsx
/**
 * What a route's first-load JavaScript is MADE of — per chunk and per package.
 *
 * `scripts/perf/bundle-budget.ts` says how big a route's first load is; this
 * says why. It is a diagnostic, not a gate (nothing fails on its numbers), and
 * it exists because "home is 56 KiB above its target" had no breakdown behind
 * it for three waves.
 *
 *   ENABLE_TEST_PAGES=1 NEXT_PUBLIC_TEST_HOOKS=1 bash scripts/ci/build.sh
 *   npx next experimental-analyze --output         # writes .next/diagnostics/analyze
 *   npx tsx scripts/perf/bundle-breakdown.ts '/[locale]' [--files] [--json]
 *
 * How it attributes bytes (verified on Next 16.3.4, 2026-09-21):
 *
 *  - The route's first-load chunk list is Next's own,
 *    `.next/diagnostics/route-bundle-stats.json` — the same set bundle-budget.ts
 *    measures (their gzip totals agree to the byte).
 *  - What each chunk contains comes from `next experimental-analyze --output`
 *    (`.next/diagnostics/analyze/data/<route>/analyze.data`: a 4-byte length,
 *    then JSON with the module tree and per-chunk module sizes). The analyzer
 *    runs its OWN Turbopack build, so its chunks carry other names; each real
 *    chunk is matched to the analyzer chunk of the nearest raw size (they
 *    differ by the chunk wrapper, tens of bytes), and a match more than 5 %
 *    off is reported.
 *  - Each chunk's REAL gzip size is split between the modules in it in
 *    proportion to their raw size — gzip is not additive, so a per-package
 *    number is an attribution, accurate to a few hundred bytes, not a
 *    measurement. `next` includes react and react-dom (Next vendors them).
 *
 * The analyzer's format is experimental and undocumented: if a Next upgrade
 * changes it, this script exits 1 saying so rather than printing nonsense.
 */
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { gzipSync } from "node:zlib";

const ROOT = process.cwd();
const NEXT_DIR = path.join(ROOT, ".next");

interface AnalyzeData {
  sources: Array<{ parent_source_index: number | null; path: string }>;
  chunk_parts: Array<{ source_index: number; output_file_index: number; size: number }>;
  output_files: Array<{ filename: string }>;
}

/* eslint-disable security/detect-non-literal-fs-filename, security/detect-object-injection --
   Paths are built from the route argument and the build's own diagnostics
   under `.next/`; indexes come from the analyzer's own arrays. */

function fail(message: string): never {
  console.error(`bundle-breakdown: ${message}`);
  process.exit(1);
}

function readAnalyze(route: string): AnalyzeData {
  const file = path.join(
    NEXT_DIR,
    "diagnostics",
    "analyze",
    "data",
    route.replace(/^\/+/, ""),
    "analyze.data",
  );
  if (!existsSync(file)) {
    fail(
      `${path.relative(ROOT, file)} is missing — run \`npx next experimental-analyze --output\` first`,
    );
  }
  const buffer = readFileSync(file);
  const length = buffer.readUInt32BE(0);
  let data: AnalyzeData;
  try {
    data = JSON.parse(buffer.subarray(4, 4 + length).toString("utf8")) as AnalyzeData;
  } catch {
    fail("analyze.data is not <u32 length><json> any more — the analyzer's format changed");
  }
  if (
    !Array.isArray(data.sources) ||
    !Array.isArray(data.chunk_parts) ||
    !Array.isArray(data.output_files)
  ) {
    fail(
      "analyze.data has no sources / chunk_parts / output_files — the analyzer's format changed",
    );
  }
  return data;
}

function firstLoadChunks(route: string): string[] {
  const file = path.join(NEXT_DIR, "diagnostics", "route-bundle-stats.json");
  if (!existsSync(file)) fail("no .next/diagnostics/route-bundle-stats.json — build first");
  const stats = JSON.parse(readFileSync(file, "utf8")) as Array<{
    route: string;
    firstLoadChunkPaths: string[];
  }>;
  const entry = stats.find((candidate) => candidate.route === route);
  if (!entry)
    fail(`${route} is not in route-bundle-stats.json (${stats.map((s) => s.route).join(", ")})`);
  return entry.firstLoadChunkPaths.map((chunk) => chunk.replace(/^\.next\//, ""));
}

/** The innermost package a module belongs to, or `app: <top two directories>`. */
function packageOf(source: string): string {
  const marker = "node_modules/";
  const at = source.lastIndexOf(marker);
  if (at !== -1) {
    const [scopeOrName = "", name = ""] = source.slice(at + marker.length).split("/");
    return scopeOrName.startsWith("@") ? `${scopeOrName}/${name}` : scopeOrName;
  }
  const local = source.replace(/^\[project\]\//, "");
  return `app: ${local.split("/").slice(0, 2).join("/")}`;
}

function main(): void {
  const route = process.argv.slice(2).find((arg) => !arg.startsWith("--")) ?? "/[locale]";
  const withFiles = process.argv.includes("--files");
  const asJson = process.argv.includes("--json");
  const data = readAnalyze(route);

  const fullPath = (index: number): string => {
    const parts: string[] = [];
    const seen = new Set<number>();
    for (let at: number | null = index; at !== null && !seen.has(at);) {
      seen.add(at);
      const source: AnalyzeData["sources"][number] | undefined = data.sources[at];
      if (!source) break;
      parts.unshift(source.path);
      at = source.parent_source_index;
    }
    return parts.join("");
  };

  // Raw size of every client JS chunk the analyzer built.
  const analyzerSize = new Map<number, number>();
  for (const part of data.chunk_parts) {
    const name = data.output_files[part.output_file_index]?.filename ?? "";
    if (!name.includes("/static/chunks/") || !name.endsWith(".js")) continue;
    analyzerSize.set(
      part.output_file_index,
      (analyzerSize.get(part.output_file_index) ?? 0) + part.size,
    );
  }

  const real = firstLoadChunks(route)
    .map((chunk) => ({ chunk, raw: readFileSync(path.join(NEXT_DIR, chunk)) }))
    .sort((a, b) => b.raw.length - a.raw.length);
  const matchOf = new Map<string, number>();
  const taken = new Set<number>();
  for (const { chunk, raw } of real) {
    let best: { index: number; delta: number } | null = null;
    for (const [index, size] of analyzerSize) {
      if (taken.has(index)) continue;
      const delta = Math.abs(size - raw.length);
      if (best === null || delta < best.delta) best = { index, delta };
    }
    if (best === null) fail(`no analyzer chunk left to match ${chunk}`);
    taken.add(best.index);
    matchOf.set(chunk, best.index);
    if (best.delta > 0.05 * raw.length && raw.length > 1024) {
      console.warn(`weak match: ${chunk} (${raw.length} B) ~ ${analyzerSize.get(best.index)} B`);
    }
  }

  const byPackage = new Map<string, number>();
  const byFile = new Map<string, number>();
  const chunkRows: Array<{ chunk: string; gzipBytes: number; top: string }> = [];
  for (const { chunk, raw } of real) {
    const gzipBytes = gzipSync(raw).length;
    const index = matchOf.get(chunk)!;
    const parts = data.chunk_parts.filter((part) => part.output_file_index === index);
    const total = parts.reduce((sum, part) => sum + part.size, 0) || 1;
    const packages = new Map<string, number>();
    for (const part of parts) {
      const source = fullPath(part.source_index);
      const share = (gzipBytes * part.size) / total;
      const name = packageOf(source);
      packages.set(name, (packages.get(name) ?? 0) + part.size);
      byPackage.set(name, (byPackage.get(name) ?? 0) + share);
      if (source.startsWith("[project]/") && !source.includes("node_modules")) {
        byFile.set(
          source.replace("[project]/", ""),
          (byFile.get(source.replace("[project]/", "")) ?? 0) + share,
        );
      }
    }
    const top = [...packages.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 4)
      .map(([name, size]) => `${name} ${((100 * size) / total).toFixed(0)}%`)
      .join(", ");
    chunkRows.push({ chunk: path.basename(chunk), gzipBytes, top });
  }

  const totalGzip = chunkRows.reduce((sum, row) => sum + row.gzipBytes, 0);
  const packageRows = [...byPackage.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([name, bytes]) => ({
      package: name,
      gzipBytes: Math.round(bytes),
      KiB: (bytes / 1024).toFixed(1),
      share: `${((100 * bytes) / totalGzip).toFixed(1)}%`,
    }));
  const fileRows = [...byFile.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([file, bytes]) => ({ file, gzipBytes: Math.round(bytes) }));

  if (asJson) {
    console.log(
      JSON.stringify(
        { route, totalGzip, chunks: chunkRows, packages: packageRows, files: fileRows },
        null,
        2,
      ),
    );
    return;
  }
  console.log(
    `\n${route}: ${chunkRows.length} first-load chunks, ${totalGzip} B gzip (${(totalGzip / 1024).toFixed(1)} KiB)\n`,
  );
  console.table(chunkRows);
  console.table(packageRows);
  if (withFiles) console.table(fileRows);
}

/* eslint-enable security/detect-non-literal-fs-filename, security/detect-object-injection */

main();
