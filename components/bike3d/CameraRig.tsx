/**
 * Camera controls, focus and reset (§3.3). WebGL-only: covered by Playwright.
 *
 * - `camera-controls` through drei's `<CameraControls>`; `ACTION` comes from
 *   the explicit `camera-controls` dependency.
 * - Touch policy: on a coarse pointer one finger scrolls the PAGE
 *   (`touches.one = NONE`, canvas `touch-action: pan-y`) and two fingers
 *   rotate / dolly; the "Rotate" toggle switches to one-finger rotate with
 *   `touch-action: none`. Mouse / pen keep the desktop mapping.
 * - Focus: `fitToSphere(focusSphereFor(plan, id), !reducedMotion)` on every
 *   `focusNonce` bump. Reset: the visible button, or a double click with a mouse.
 * - `ResizeObserver` + `orientationchange` → refit + `invalidate()`.
 */
"use client";

import { CameraControls } from "@react-three/drei";
import { useThree } from "@react-three/fiber";
import CameraControlsImpl from "camera-controls";
import { useEffect, useRef } from "react";
import { Sphere, Vector3 } from "three";

import { defaultPose, focusSphereFor } from "@/lib/bike3d/focus";
import type { ScenePlan } from "@/lib/bike3d/types";

import { useViewerStore, useViewerStoreApi } from "./store";

const { ACTION } = CameraControlsImpl;

export function CameraRig({
  plan,
  coarsePointer,
  reducedMotion,
}: {
  plan: ScenePlan;
  coarsePointer: boolean;
  reducedMotion: boolean;
}): React.JSX.Element {
  const controls = useRef<CameraControlsImpl>(null);
  const { api, patchBridge } = useViewerStoreApi();
  const gl = useThree((state) => state.gl);
  const size = useThree((state) => state.size);
  const invalidate = useThree((state) => state.invalidate);
  const focusNonce = useViewerStore((state) => state.focusNonce);
  const resetNonce = useViewerStore((state) => state.resetNonce);
  const rotateMode = useViewerStore((state) => state.rotateMode);
  const planRef = useRef(plan);
  useEffect(() => {
    planRef.current = plan;
  }, [plan]);
  const aspect = size.height > 0 ? size.width / size.height : 1;

  const touches = coarsePointer
    ? {
        one: rotateMode ? ACTION.TOUCH_ROTATE : ACTION.NONE,
        two: ACTION.TOUCH_DOLLY_ROTATE,
        three: ACTION.TOUCH_TRUCK,
      }
    : { one: ACTION.TOUCH_ROTATE, two: ACTION.TOUCH_DOLLY_TRUCK, three: ACTION.TOUCH_TRUCK };

  // Initial pose, and a refit whenever the bike or the canvas changes shape.
  useEffect(() => {
    const c = controls.current;
    if (!c) return;
    const pose = defaultPose(plan, aspect);
    void c.setLookAt(...pose.position, ...pose.target, false);
    invalidate();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [plan.hash, aspect]);

  useEffect(() => {
    if (focusNonce === 0) return;
    const c = controls.current;
    const id = api.getState().selectedPartId;
    const sphere = id ? focusSphereFor(planRef.current, id) : null;
    if (!c || !sphere) return;
    void c.fitToSphere(
      new Sphere(new Vector3(...sphere.center), sphere.radius * 1.4),
      !reducedMotion,
    );
    invalidate();
  }, [focusNonce, api, reducedMotion, invalidate]);

  useEffect(() => {
    if (resetNonce === 0) return;
    const c = controls.current;
    if (!c) return;
    const pose = defaultPose(planRef.current, aspect);
    void c.setLookAt(...pose.position, ...pose.target, !reducedMotion);
    invalidate();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [resetNonce, reducedMotion, invalidate]);

  // Canvas touch-action (camera-controls writes `none` when it connects) and
  // the mouse-only double-click reset.
  useEffect(() => {
    const canvas = gl.domElement;
    // camera-controls writes `touch-action: none` on the canvas whenever it
    // connects, reconnects or is re-enabled, which would swallow the page
    // scroll. Keep our value: set it, and set it again whenever the library
    // (or anything else) rewrites the style attribute.
    const wanted = coarsePointer && !rotateMode ? "pan-y" : "none";
    // `touch-action` is resolved along the ancestor chain, and R3F writes
    // `touch-action: none` INLINE on the div it wraps the canvas in — with that
    // ancestor at `none`, `pan-y` on the canvas alone never scrolls the page
    // (verified in Chromium, 2026-09-17). So the value goes on the canvas and on
    // every ancestor that carries an inline touch-action of its own.
    const targets = () => {
      const list: HTMLElement[] = [canvas];
      for (
        let element = canvas.parentElement;
        element && element !== document.body;
        element = element.parentElement
      ) {
        if (element.style.touchAction) list.push(element);
      }
      return list;
    };
    const apply = () => {
      for (const element of targets()) {
        if (element.style.touchAction !== wanted) element.style.setProperty("touch-action", wanted);
      }
    };
    apply();
    const observer = new MutationObserver(apply);
    observer.observe(canvas.parentElement ?? canvas, {
      attributes: true,
      attributeFilter: ["style"],
      subtree: true,
    });
    let lastPointer = "mouse";
    const onPointerDown = (event: PointerEvent) => {
      lastPointer = event.pointerType;
    };
    const onDoubleClick = () => {
      if (lastPointer === "mouse") api.getState().requestReset();
    };
    canvas.addEventListener("pointerdown", onPointerDown);
    canvas.addEventListener("dblclick", onDoubleClick);
    return () => {
      observer.disconnect();
      canvas.removeEventListener("pointerdown", onPointerDown);
      canvas.removeEventListener("dblclick", onDoubleClick);
    };
  }, [gl, coarsePointer, rotateMode, api]);

  useEffect(() => {
    const onOrientation = () => invalidate();
    window.addEventListener("orientationchange", onOrientation);
    return () => window.removeEventListener("orientationchange", onOrientation);
  }, [invalidate]);

  useEffect(() => {
    patchBridge({ controls: controls.current });
  });

  return (
    <CameraControls
      ref={controls}
      makeDefault
      regress
      touches={touches}
      smoothTime={reducedMotion ? 0 : 0.25}
      draggingSmoothTime={reducedMotion ? 0 : 0.08}
      minDistance={0.25}
      maxDistance={8}
    />
  );
}
