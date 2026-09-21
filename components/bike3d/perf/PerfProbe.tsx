/**
 * Installs `window.__va` (lib/testing/e2e-hooks.ts) for Playwright e2e and
 * perf specs. Compiled in ONLY when `NEXT_PUBLIC_TEST_HOOKS=1` at build time
 * (see `BikeViewer`), and mounted only when the host passes `probe`.
 * WebGL-only: excluded from unit coverage, exercised by tests/e2e/bike3d and
 * tests/perf.
 */
"use client";

import { useEffect, useRef } from "react";
import {
  Mesh,
  Raycaster,
  Vector2,
  Vector3,
  type BufferGeometry,
  type Camera,
  type Object3D,
  type Scene,
  type WebGLRenderer,
} from "three";

import { geometryTierFor } from "@/lib/bike3d/builders/lod";
import { isPoseName, poseFor } from "@/lib/bike3d/focus";
import { materialCount } from "@/lib/bike3d/materials";
import { isQualityTier } from "@/lib/bike3d/quality";
import type { ScenePlan } from "@/lib/bike3d/types";
import { clickTargetOf, isPartId } from "@/lib/domain/data/parts";
import { installE2EHooks, type ScreenPoint, type VaTestHooks } from "@/lib/testing/e2e-hooks";

import { useViewerStoreApi, type SceneBridge } from "../store";

interface Controls {
  setLookAt(...args: [number, number, number, number, number, number, boolean]): Promise<void>;
  update(delta: number): boolean;
  rotate(azimuth: number, polar: number, transition: boolean): Promise<void>;
}

const MAX_SAMPLES_PER_MESH = 48;

function partIdOf(object: Object3D | null): string | null {
  for (let node = object; node; node = node.parent) {
    const id = (node.userData as { partId?: unknown }).partId;
    if (typeof id === "string") return id;
  }
  return null;
}

/** Centroids of up to MAX_SAMPLES triangles of a geometry, in local space. */
function triangleCentroids(geometry: BufferGeometry): Vector3[] {
  const position = geometry.getAttribute("position");
  const index = geometry.index;
  const triangles = Math.floor((index ? index.count : position.count) / 3);
  const step = Math.max(1, Math.floor(triangles / MAX_SAMPLES_PER_MESH));
  const vertex = (i: number) => {
    const at = index ? index.getX(i) : i;
    return new Vector3(position.getX(at), position.getY(at), position.getZ(at));
  };
  const points: Vector3[] = [];
  // Offset the start so the samples do not all fall on the first ring of a tube.
  for (let t = Math.floor(step / 2); t < triangles; t += step) {
    points.push(
      vertex(t * 3)
        .add(vertex(t * 3 + 1))
        .add(vertex(t * 3 + 2))
        .multiplyScalar(1 / 3),
    );
  }
  return points;
}

export default function PerfProbe({ plan }: { plan: ScenePlan }): null {
  const { api, getBridge } = useViewerStoreApi();
  const planRef = useRef(plan);
  useEffect(() => {
    planRef.current = plan;
  }, [plan]);

  useEffect(() => {
    const scene3d = () => {
      const b = getBridge() as
        (SceneBridge & { gl: WebGLRenderer; scene: Scene; camera: Camera }) | null;
      return b;
    };

    const syncWorld = (b: NonNullable<ReturnType<typeof scene3d>>) => {
      const controls = b.controls as Controls | null;
      controls?.update(0);
      b.scene.updateMatrixWorld(true);
      b.camera.updateMatrixWorld(true);
    };

    const screenPositionOf = (id: string): ScreenPoint | null => {
      const b = scene3d();
      if (!b || !isPartId(id)) return null;
      syncWorld(b);
      const target = clickTargetOf(id);
      const meshes: Mesh[] = [];
      b.scene.traverse((object) => {
        if (object instanceof Mesh && object.userData.partId === target && object.visible) {
          meshes.push(object);
        }
      });
      const rect = b.canvas.getBoundingClientRect();
      const raycaster = new Raycaster();
      const ndc = new Vector2();
      const hitsTarget = (clientX: number, clientY: number) => {
        ndc.set(
          ((clientX - rect.left) / rect.width) * 2 - 1,
          -((clientY - rect.top) / rect.height) * 2 + 1,
        );
        raycaster.setFromCamera(ndc, b.camera);
        const hit = raycaster.intersectObject(b.scene, true)[0];
        return hit !== undefined && partIdOf(hit.object) === target;
      };
      for (const mesh of meshes) {
        if ((mesh as Mesh & { isInstancedMesh?: boolean }).isInstancedMesh) continue;
        for (const local of triangleCentroids(mesh.geometry)) {
          const world = local.applyMatrix4(mesh.matrixWorld);
          const projected = world.clone().project(b.camera);
          if (Math.abs(projected.x) > 0.96 || Math.abs(projected.y) > 0.96 || projected.z > 1)
            continue;
          // Whole pixels, like a real pointer event; the point must be robust to
          // ±2 px so a click on a sliver between two parts is never offered.
          const x = Math.round(rect.left + ((projected.x + 1) / 2) * rect.width);
          const y = Math.round(rect.top + ((1 - projected.y) / 2) * rect.height);
          if (x < 4 || y < 4 || x > window.innerWidth - 4 || y > window.innerHeight - 4) continue;
          const robust = [
            [0, 0],
            [2, 0],
            [-2, 0],
            [0, 2],
            [0, -2],
          ].every(([dx, dy]) => hitsTarget(x + dx!, y + dy!));
          if (!robust) continue;
          if (document.elementFromPoint(x, y) !== b.canvas) continue;
          return { x, y };
        }
      }
      return null;
    };

    const hooks: VaTestHooks = {
      bike: {
        get ready() {
          return api.getState().ready;
        },
        get selectedPartId() {
          return api.getState().selectedPartId;
        },
        get pickedPartIds() {
          return [...api.getState().pickedPartIds];
        },
        get partIds() {
          return [...planRef.current.partIds];
        },
        screenPositionOf,
        focus(id) {
          if (isPartId(id)) api.getState().select(id, { focus: true, source: "list" });
        },
        hittable(pose) {
          const b = scene3d();
          if (!b || !isPoseName(pose)) return {};
          const rect = b.canvas.getBoundingClientRect();
          const { position, target } = poseFor(
            planRef.current,
            pose,
            rect.width / Math.max(1, rect.height),
          );
          const controls = b.controls as Controls | null;
          void controls?.setLookAt(...position, ...target, false);
          syncWorld(b);
          b.invalidate();
          const result: Record<string, ScreenPoint> = {};
          for (const id of planRef.current.partIds) {
            const point = screenPositionOf(id);
            if (point) result[id] = point;
          }
          return result;
        },
        materialOf(id) {
          const b = scene3d();
          if (!b || !isPartId(id)) return null;
          const target = clickTargetOf(id);
          let key: string | null = null;
          b.scene.traverse((object) => {
            if (key === null && object instanceof Mesh && object.userData.partId === target) {
              key = String(object.userData.materialKey);
            }
          });
          return key;
        },
        loseContext() {
          const b = scene3d();
          const extension = b?.gl.getContext().getExtension("WEBGL_lose_context");
          if (!extension) return false;
          extension.loseContext();
          return true;
        },
        restoreContext() {
          api.getState().retry3d();
        },
        get mountCount() {
          return api.getState().mountCount;
        },
        get quality() {
          return api.getState().quality;
        },
        setQuality(tier) {
          if (isQualityTier(tier)) api.getState().setQuality(tier);
        },
      },
      perf: {
        snapshot() {
          const b = scene3d();
          if (!b) return null;
          const info = b.gl.info;
          const context = b.gl.getContext();
          const quality = api.getState().quality;
          return {
            calls: info.render.calls,
            triangles: info.render.triangles,
            programs: info.programs?.length ?? 0,
            geometries: info.memory.geometries,
            textures: info.memory.textures,
            frameMs: [...b.frameTimes],
            dpr: b.gl.getPixelRatio(),
            drawingBufferWidth: context.drawingBufferWidth,
            drawingBufferHeight: context.drawingBufferHeight,
            viewportWidth: window.innerWidth,
            lodTier: geometryTierFor(quality),
            quality,
            materials: materialCount(),
          };
        },
        async renderFrames(n) {
          for (let i = 0; i < n; i++) {
            getBridge()?.invalidate();
            await new Promise<void>((resolve) =>
              requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
            );
          }
        },
        async runOrbit(ms) {
          const intervals: number[] = [];
          const started = performance.now();
          let last = started;
          await new Promise<void>((resolve) => {
            const tick = (now: number) => {
              const b = scene3d();
              if (!b || now - started >= ms) {
                resolve();
                return;
              }
              intervals.push(now - last);
              last = now;
              void (b.controls as Controls | null)?.rotate(0.03, 0, false);
              b.invalidate();
              requestAnimationFrame(tick);
            };
            requestAnimationFrame(tick);
          });
          return intervals;
        },
        async frameCost(n) {
          const costs: number[] = [];
          const pixel = new Uint8Array(4);
          for (let i = 0; i < n; i++) {
            const b = scene3d();
            if (!b) break;
            void (b.controls as Controls | null)?.rotate(0.03, 0, false);
            syncWorld(b);
            const context = b.gl.getContext();
            const started = performance.now();
            b.gl.render(b.scene, b.camera);
            // Blocks until the GPU has executed the frame: the cost is the
            // frame's, not the time it took to queue it.
            context.readPixels(0, 0, 1, 1, context.RGBA, context.UNSIGNED_BYTE, pixel);
            costs.push(performance.now() - started);
            // One real frame between samples, so each starts from a composited canvas.
            await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
          }
          getBridge()?.invalidate();
          return costs;
        },
        get renderer() {
          const b = scene3d();
          if (!b) return null;
          const context = b.gl.getContext();
          const debug = context.getExtension("WEBGL_debug_renderer_info");
          return String(
            context.getParameter(debug ? debug.UNMASKED_RENDERER_WEBGL : context.RENDERER),
          );
        },
        get buildMs() {
          return api.getState().buildMs;
        },
        get contextCreations() {
          return api.getState().contextCreations;
        },
      },
    };
    return installE2EHooks(hooks);
  }, [api, getBridge]);

  return null;
}
