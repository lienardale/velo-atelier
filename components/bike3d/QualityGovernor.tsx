/**
 * Measures fps ONLY while the user drives the camera (`controlstart` →
 * `controlend`), switching the frameloop to `always` for that window, and
 * feeds `governorStep` (lib/bike3d/quality.ts). Disabled under
 * `prefers-reduced-motion`. WebGL-only: covered by Playwright.
 */
"use client";

import { useFrame, useThree } from "@react-three/fiber";
import { useEffect, useRef } from "react";

import { createGovernor, governorStep, persistQuality, windowFps } from "@/lib/bike3d/quality";

import { useViewerStoreApi } from "./store";

interface EventSource {
  addEventListener(type: string, listener: () => void): void;
  removeEventListener(type: string, listener: () => void): void;
}

export function QualityGovernor({
  enabled,
  coarsePointer,
}: {
  enabled: boolean;
  coarsePointer: boolean;
}): null {
  const { api } = useViewerStoreApi();
  const controls = useThree((state) => state.controls) as unknown as EventSource | null;
  const setFrameloop = useThree((state) => state.setFrameloop);
  const frames = useRef(0);
  const measuring = useRef(false);
  const governor = useRef(createGovernor(api.getState().quality, coarsePointer));

  useFrame(() => {
    if (measuring.current) frames.current += 1;
  });

  useEffect(() => {
    if (!enabled || !controls) return;
    let startedAt = 0;
    const onStart = () => {
      measuring.current = true;
      frames.current = 0;
      startedAt = performance.now();
      setFrameloop("always");
    };
    const onEnd = () => {
      if (!measuring.current) return;
      measuring.current = false;
      setFrameloop("demand");
      const state = governorStep(
        governor.current,
        windowFps(frames.current, performance.now() - startedAt),
      );
      governor.current = state;
      if (state.tier !== api.getState().quality) {
        api.getState().setQuality(state.tier);
        try {
          persistQuality(window.localStorage, state.tier);
        } catch {
          // Storage blocked: the tier is simply not remembered.
        }
      }
    };
    controls.addEventListener("controlstart", onStart);
    controls.addEventListener("controlend", onEnd);
    return () => {
      controls.removeEventListener("controlstart", onStart);
      controls.removeEventListener("controlend", onEnd);
      if (measuring.current) setFrameloop("demand");
      measuring.current = false;
    };
  }, [enabled, controls, api, setFrameloop]);

  return null;
}
