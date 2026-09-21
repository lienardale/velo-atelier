/**
 * W4 AC12 probe — NEVER MERGED. One deliberately failing unit test, to show
 * that CI's `coverage (80%)` job concludes FAILURE (not skipped) when a unit
 * test fails. The branch and its draft PR are deleted once the run is read.
 */
import { expect, it } from "vitest";

it("fails on purpose (W4 coverage-gate probe)", () => {
  expect(1 + 1).toBe(3);
});
