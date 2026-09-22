/**
 * The soft tier's ladder (`scripts/perf/ladder.ts`, applied by
 * `scripts/perf/compare.ts`) — and the one exception the W4 ruling made to it:
 * long frames never fail on a software renderer (`.debug/012` §12).
 */
import { describe, expect, it } from "vitest";

import budgets from "../../../perf.budgets.json";
import { isSoftwareRenderer, ratioPct, verdictOf } from "../../../scripts/perf/ladder";

const LADDER = budgets.timingLadder;

/** What CI's Playwright container reports (a W4 baseline's `renderer`). */
const CI_RENDERER =
  "ANGLE (Google, Vulkan 1.3.0 (SwiftShader Device (Subzero) (0x0000C0DE)), SwiftShader driver)";
/** What `RUN_LOCAL_PERF=1` reported on the M2 (`.perf/local-2026-09-21.json`). */
const GPU_RENDERER = "ANGLE (Apple, ANGLE Metal Renderer: Apple M2, Unspecified Version)";

describe("the ladder", () => {
  it("is §7.3's: warn above 150 %, fail above 300 %", () => {
    expect(LADDER).toEqual({ warnPct: 150, failPct: 300 });
  });

  it("smooths the long-frame count: a zero baseline warns at 1 and fails at 3", () => {
    expect(verdictOf("longFrames", 0, 0, LADDER, false).verdict).toBe("ok");
    expect(verdictOf("longFrames", 1, 0, LADDER, false).verdict).toBe("warn");
    expect(verdictOf("longFrames", 2, 0, LADDER, false).verdict).toBe("warn"); // exactly 300 %
    expect(verdictOf("longFrames", 3, 0, LADDER, false).verdict).toBe("FAIL");
  });

  it("puts the fail line two frames past a plain ratio's: baseline 10 fails from 33", () => {
    expect(verdictOf("longFrames", 32, 10, LADDER, false).verdict).toBe("warn");
    expect(verdictOf("longFrames", 33, 10, LADDER, false).verdict).toBe("FAIL");
  });

  it("uses a plain ratio for durations, infinite over a zero baseline", () => {
    expect(ratioPct("p50FrameMs", 90, 30)).toBe(300);
    expect(verdictOf("p50FrameMs", 90, 30, LADDER, false).verdict).toBe("warn");
    expect(verdictOf("p50FrameMs", 91, 30, LADDER, false).verdict).toBe("FAIL");
    expect(ratioPct("buildMs", 0, 0)).toBe(100);
    expect(ratioPct("buildMs", 1, 0)).toBe(Number.POSITIVE_INFINITY);
  });
});

describe("long frames on a software renderer (the W4 ruling)", () => {
  // The first comparison against the W4 baselines (PR #6, perf-mobile /
  // mtb-full-dropper-1x12): 6 long frames against a median of 1, with the code
  // byte-identical to the nightly that recorded it.
  it("reports the PR #6 case as a warning, not a failure", () => {
    expect(verdictOf("longFrames", 6, 1, LADDER, isSoftwareRenderer(CI_RENDERER))).toEqual({
      pct: 350,
      verdict: "warn",
      capped: true,
    });
  });

  it("still fails the same count on a GPU", () => {
    expect(verdictOf("longFrames", 6, 1, LADDER, isSoftwareRenderer(GPU_RENDERER))).toEqual({
      pct: 350,
      verdict: "FAIL",
      capped: false,
    });
  });

  it("keeps every duration's failure, in software too", () => {
    for (const metric of ["p50FrameMs", "p95FrameMs", "buildMs", "tapLatencyMs"]) {
      expect(verdictOf(metric, 400, 100, LADDER, true), metric).toEqual({
        pct: 400,
        verdict: "FAIL",
        capped: false,
      });
    }
  });

  it("caps nothing below the fail line", () => {
    expect(verdictOf("longFrames", 5, 1, LADDER, true)).toEqual({
      pct: 300,
      verdict: "warn",
      capped: false,
    });
  });
});

describe("isSoftwareRenderer", () => {
  it("names every software rasteriser the local GPU gate refuses", () => {
    for (const renderer of [
      CI_RENDERER,
      "llvmpipe (LLVM 17.0.6, 256 bits)",
      "softpipe",
      "Microsoft Basic Render Driver",
      "Apple Software Renderer",
    ]) {
      expect(isSoftwareRenderer(renderer), renderer).toBe(true);
    }
  });

  it("does not take a GPU, or a missing renderer, for software", () => {
    expect(isSoftwareRenderer(GPU_RENDERER)).toBe(false);
    expect(isSoftwareRenderer(undefined)).toBe(false);
    expect(isSoftwareRenderer(42)).toBe(false);
  });
});
