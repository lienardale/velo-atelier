/**
 * The lazy 3D chunk (three + fiber + the drei subset + parts). Loaded by
 * `BikeViewer` with `next/dynamic({ ssr: false })` only after hydration, once
 * the viewer is visible and the browser is idle. WebGL-only: covered by
 * Playwright e2e + perf, excluded from unit coverage.
 *
 *   <Canvas frameloop="demand" dpr={tier} gl={{antialias, alpha, powerPreference}}
 *           performance={{min: 0.5, debounce: 200}}>
 *     lights · <BikeModel> · <CameraRig> · <PartLabel> · <QualityGovernor>
 *     ReadyGate (gl.compile before `ready`) · FrameRecorder · ThemeWatcher
 *
 * A spec change never remounts the `<Canvas>`: the plan changes, parts
 * rebuild their geometry, the WebGL context stays (`contextCreations === 1`).
 * `webglcontextlost` is `preventDefault`-ed and reported to the store; the
 * viewer swaps back to the SVG.
 */
"use client";

import { Canvas, useFrame, useThree, type RootState } from "@react-three/fiber";
import { useEffect, useRef, useState } from "react";

import { CAMERA_FOV } from "@/lib/bike3d/focus";
import { applyPalette, readPalette } from "@/lib/bike3d/materials";
import { dprFor } from "@/lib/bike3d/quality";
import type { QualityTier, ScenePlan } from "@/lib/bike3d/types";

import { BikeModel } from "./BikeModel";
import { CameraRig } from "./CameraRig";
import { PartLabel } from "./PartLabel";
import { QualityGovernor } from "./QualityGovernor";
import { useViewerStore, useViewerStoreApi } from "./store";

export interface BikeSceneProps {
  plan: ScenePlan;
  labels: Readonly<Record<string, string>>;
  coarsePointer: boolean;
  reducedMotion: boolean;
  initialTier: QualityTier;
  devicePixelRatio: number;
}

const MAX_FRAME_SAMPLES = 1200;

function ReadyGate(): null {
  const { api } = useViewerStoreApi();
  const gl = useThree((state) => state.gl);
  const scene = useThree((state) => state.scene);
  const camera = useThree((state) => state.camera);
  const invalidate = useThree((state) => state.invalidate);
  const compiled = useRef(false);

  useEffect(() => {
    // Compile every program before the first visible frame: no shader hitch on
    // the first interaction, and a shader error surfaces here, not mid-orbit.
    gl.compile(scene, camera);
    compiled.current = true;
    invalidate();
  }, [gl, scene, camera, invalidate]);

  useFrame(() => {
    if (compiled.current && !api.getState().ready) {
      // Mark ready after this frame has been drawn.
      requestAnimationFrame(() => api.getState().setReady(true));
    }
  });
  return null;
}

function FrameRecorder(): null {
  const { getBridge } = useViewerStoreApi();
  useFrame((_, delta) => {
    const times = getBridge()?.frameTimes;
    if (!times) return;
    times.push(delta * 1000);
    if (times.length > MAX_FRAME_SAMPLES) times.splice(0, times.length - MAX_FRAME_SAMPLES);
  });
  return null;
}

function ThemeWatcher(): null {
  const invalidate = useThree((state) => state.invalidate);
  useEffect(() => {
    const apply = () => {
      applyPalette(readPalette(getComputedStyle(document.documentElement)));
      invalidate();
    };
    apply();
    const list = window.matchMedia("(prefers-color-scheme: dark)");
    list.addEventListener("change", apply);
    return () => list.removeEventListener("change", apply);
  }, [invalidate]);
  return null;
}

export default function BikeScene({
  plan,
  labels,
  coarsePointer,
  reducedMotion,
  initialTier,
  devicePixelRatio,
}: BikeSceneProps): React.JSX.Element {
  const { api, setBridge } = useViewerStoreApi();
  const quality = useViewerStore((state) => state.quality);
  // Antialiasing is a context attribute: fixed for the life of the canvas.
  const [antialias] = useState(initialTier !== "low");

  useEffect(() => {
    api.getState().noteMount();
    return () => {
      setBridge(null);
      api.getState().setReady(false);
    };
  }, [api, setBridge]);

  const onCreated = (state: RootState) => {
    const canvas = state.gl.domElement;
    canvas.setAttribute("data-testid", "bike3d-canvas");
    setBridge({
      gl: state.gl,
      scene: state.scene,
      camera: state.camera,
      controls: state.controls,
      invalidate: state.invalidate,
      frameTimes: [],
      canvas,
    });
    canvas.addEventListener("webglcontextlost", (event) => {
      event.preventDefault();
      api.getState().setContextLost(true);
    });
    api.getState().noteContextCreated();
  };

  return (
    <Canvas
      frameloop="demand"
      dpr={dprFor(quality, devicePixelRatio)}
      gl={{ antialias, alpha: true, powerPreference: "high-performance" }}
      performance={{ min: 0.5, debounce: 200 }}
      camera={{ fov: CAMERA_FOV, near: 0.02, far: 40, position: [0.4, 0.5, -3] }}
      onCreated={onCreated}
      onPointerMissed={() => api.getState().hover(null)}
      className="h-full w-full"
    >
      <hemisphereLight args={["#ffffff", "#8a8173", 1.4]} />
      <directionalLight position={[2, 4, -3]} intensity={2.2} />
      <directionalLight position={[-3, 2, 3]} intensity={0.8} />
      <BikeModel plan={plan} />
      <CameraRig plan={plan} coarsePointer={coarsePointer} reducedMotion={reducedMotion} />
      <PartLabel plan={plan} labels={labels} />
      <QualityGovernor enabled={!reducedMotion} coarsePointer={coarsePointer} />
      <ReadyGate />
      <FrameRecorder />
      <ThemeWatcher />
    </Canvas>
  );
}
