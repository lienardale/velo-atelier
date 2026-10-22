/**
 * What a checkup is about, and which scope a run is (`./scope.ts`; `.debug/017`
 * §5.10, §5.11).
 */
import { describe, expect, it, vi } from "vitest";

import type { PartId } from "@/lib/domain/data/parts";

import {
  effectiveScope,
  FULL_SCOPE,
  namesParts,
  partsInScope,
  resumeScope,
  type ResumedRun,
} from "./scope";
import type { CheckupScope } from "./types";

const parts = (...partIds: string[]): CheckupScope => ({
  kind: "parts",
  partIds: partIds as PartId[],
});

const sorted = (set: ReadonlySet<string> | null) => (set === null ? null : [...set].sort());

describe("partsInScope — the one definition of 'inside the scope'", () => {
  it("is null for a full checkup: it is about every part", () => {
    expect(partsInScope(FULL_SCOPE)).toBeNull();
  });

  it("holds a picked host and the parts it carries: the rear caliper and its pads", () => {
    expect(sorted(partsInScope(parts("brake-caliper-rear")))).toEqual([
      "brake-caliper-rear",
      "brake-pads-rear",
    ]);
  });

  it("holds a picked hosted part and the host it is reached through: the rear pads and their caliper", () => {
    expect(sorted(partsInScope(parts("brake-pads-rear")))).toEqual([
      "brake-caliper-rear",
      "brake-pads-rear",
    ]);
  });

  it("holds a tyre and the tube it carries, and not the other tyre's", () => {
    expect(sorted(partsInScope(parts("tire-front")))).toEqual(["tire-front", "tube-front"]);
  });

  it("does NOT hold the other parts an unpicked host carries: the chainring says nothing of the bearings", () => {
    // Both are reached through the crankset, which was not picked.
    expect(sorted(partsInScope(parts("chainring")))).toEqual(["chainring", "crankset"]);
    // Picking the crankset itself does hold both.
    expect(sorted(partsInScope(parts("crankset")))).toEqual([
      "bottom-bracket",
      "chainring",
      "crankset",
    ]);
  });

  it("holds a part with neither host nor carried parts as itself", () => {
    expect(sorted(partsInScope(parts("chain")))).toEqual(["chain"]);
  });

  it("ignores an id that is not a part — a hand-written `?parts=` widens nothing", () => {
    expect(sorted(partsInScope(parts("../etc/passwd", "chain")))).toEqual(["chain"]);
    expect(sorted(partsInScope(parts()))).toEqual([]);
  });
});

describe("namesParts", () => {
  it("is true of a parts scope naming at least one part, and of nothing else", () => {
    expect(namesParts(parts("chain"))).toBe(true);
    expect(namesParts(parts())).toBe(false);
    expect(namesParts(FULL_SCOPE)).toBe(false);
  });
});

describe("effectiveScope — the named scope while the answers bear it out", () => {
  const asks = (...keys: string[]) => vi.fn(() => new Set(keys));

  it("keeps a parts scope every answered question of which it asks", () => {
    const named = parts("chain");
    const asked = asks("check-drivetrain#chain-wear");
    expect(effectiveScope(named, ["check-drivetrain#chain-wear"], asked)).toBe(named);
    expect(asked).toHaveBeenCalledTimes(1);
  });

  it("keeps a parts scope with no answer at all", () => {
    const named = parts("chain");
    expect(effectiveScope(named, [], asks())).toBe(named);
  });

  it("is the full checkup as soon as ONE answered question is not one the scope asks", () => {
    expect(
      effectiveScope(
        parts("chain"),
        ["check-drivetrain#chain-wear", "check-brakes-disc#pad-wear"],
        asks("check-drivetrain#chain-wear"),
      ),
    ).toEqual(FULL_SCOPE);
  });

  it("is the full checkup, never planned, for a parts scope that names no part", () => {
    const asked = asks();
    expect(effectiveScope(parts(), ["check-drivetrain#chain-wear"], asked)).toEqual(FULL_SCOPE);
    expect(effectiveScope(parts(), [], asked)).toEqual(FULL_SCOPE);
    expect(asked).not.toHaveBeenCalled();
  });

  it("is the full checkup for a full checkup, never planned", () => {
    const asked = asks();
    expect(effectiveScope(FULL_SCOPE, ["anything#at-all"], asked)).toEqual(FULL_SCOPE);
    expect(asked).not.toHaveBeenCalled();
  });
});

describe("resumeScope — the unfinished run wins over the page", () => {
  const run = (scope: CheckupScope, ...answered: string[]): ResumedRun => ({ scope, answered });
  const CHAIN = "check-drivetrain#chain-wear";
  const PADS = "check-brakes-disc#pad-wear";

  it("resumes on a full page as the full checkup, whatever the run was", () => {
    const asked = vi.fn(() => new Set<string>());
    expect(resumeScope(run(parts("chain"), CHAIN), FULL_SCOPE, asked)).toEqual(FULL_SCOPE);
    expect(resumeScope(run(FULL_SCOPE, CHAIN), FULL_SCOPE, asked)).toEqual(FULL_SCOPE);
    expect(asked).not.toHaveBeenCalled();
  });

  it("resumes a partial run on the page's scope when that scope asks every question it answered — a reload", () => {
    const page = parts("chain");
    expect(resumeScope(run(parts("chain"), CHAIN), page, () => new Set([CHAIN]))).toBe(page);
    // A saved bike's PARTIAL row reads as a scope naming no part: the page's wins.
    expect(resumeScope(run(parts(), CHAIN), page, () => new Set([CHAIN]))).toBe(page);
  });

  it("resumes a partial run as the full checkup when the page does not ask one of its answers", () => {
    expect(
      resumeScope(run(parts("brake-caliper-rear"), PADS), parts("chain"), () => new Set([CHAIN])),
    ).toEqual(FULL_SCOPE);
  });

  it("never narrows a FULL run that has answers — a partial page neither trims nor narrows it", () => {
    const asked = vi.fn(() => new Set([CHAIN]));
    expect(resumeScope(run(FULL_SCOPE, CHAIN), parts("chain"), asked)).toEqual(FULL_SCOPE);
    expect(asked).not.toHaveBeenCalled();
  });

  it("lets a FULL run with no answer yet take the page's scope: there is nothing to keep", () => {
    const page = parts("chain");
    expect(resumeScope(run(FULL_SCOPE), page, () => new Set([CHAIN]))).toBe(page);
  });
});
