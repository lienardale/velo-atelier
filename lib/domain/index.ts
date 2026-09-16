/**
 * The domain, as the rest of the app sees it — **and the one import that is
 * safe from a client component**.
 *
 * Two rules make that true, and `tests/unit/domain/no-zod-in-barrel.test.ts`
 * enforces the second by walking this file's import graph:
 *
 *   1. only data and engine modules are re-exported as values;
 *   2. everything from `schema/**` is re-exported with `export type *`, which
 *      erases completely — so no parser, and no copy of zod, reaches the
 *      browser bundle.
 *
 * Server code, tests and scripts that need to *validate* something import
 * `@/lib/domain/schema` instead.
 */

// ── Data ─────────────────────────────────────────────────────────────────────
export * from "./data/conventions";
export * from "./data/decision-tree";
export * from "./data/illustrations";
export * from "./data/presets";

// ── Engine ───────────────────────────────────────────────────────────────────
export * from "./engine/build-bike-spec";
export * from "./engine/condition";
export * from "./engine/decision";
export * from "./engine/paths";

// ── Types ────────────────────────────────────────────────────────────────────
export type * from "./schema/bike-spec";
export type * from "./schema/condition";
export type * from "./schema/decision";
export type * from "./schema/illustration";
export type * from "./schema/part";
export type * from "./schema/procedure";
export type * from "./schema/retailer";
export type * from "./schema/rule";
