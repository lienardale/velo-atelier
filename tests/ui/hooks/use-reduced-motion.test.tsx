import { renderHook } from "@testing-library/react";
import { act } from "react";
import { describe, expect, it } from "vitest";

import { MEDIA } from "@/lib/hooks/use-media";
import {
  motionDuration,
  useMotionDuration,
  useReducedMotion,
} from "@/lib/hooks/use-reduced-motion";
import { setMediaQuery } from "@/tests/setup.dom";

describe("motionDuration", () => {
  it("is a literal 0ms when motion is reduced — never a short animation", () => {
    expect(motionDuration(true)).toBe("0ms");
    expect(motionDuration(true, "fast")).toBe("0ms");
    expect(motionDuration(true, "slow")).toBe("0ms");
  });

  it("maps each speed onto its token otherwise", () => {
    expect(motionDuration(false)).toBe("var(--motion-base)");
    expect(motionDuration(false, "base")).toBe("var(--motion-base)");
    expect(motionDuration(false, "fast")).toBe("var(--motion-fast)");
    expect(motionDuration(false, "slow")).toBe("var(--motion-slow)");
  });
});

describe("useReducedMotion", () => {
  it("assumes full motion until the OS says otherwise", () => {
    const { result } = renderHook(() => useReducedMotion());
    expect(result.current).toBe(false);
  });

  it("reacts to the preference changing mid-session", () => {
    const { result } = renderHook(() => useReducedMotion());
    act(() => setMediaQuery(MEDIA.reducedMotion, true));
    expect(result.current).toBe(true);
  });
});

describe("useMotionDuration", () => {
  it("hands back the token, then 0ms once the preference flips", () => {
    const { result } = renderHook(() => useMotionDuration("slow"));
    expect(result.current).toBe("var(--motion-slow)");
    act(() => setMediaQuery(MEDIA.reducedMotion, true));
    expect(result.current).toBe("0ms");
  });

  it("defaults to the base speed", () => {
    const { result } = renderHook(() => useMotionDuration());
    expect(result.current).toBe("var(--motion-base)");
  });
});
