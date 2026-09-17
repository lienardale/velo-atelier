/**
 * Side projection of the scene plan for `BikeSilhouetteSvg` (§3.3): the
 * server-rendered first paint (LCP element), the no-WebGL fallback and the
 * context-lost fallback. Built from the SAME recipes as the 3D meshes, so the
 * two views cannot drift apart.
 *
 * Projection: the drive-side view the 3D camera opens on (camera on −Z, so
 * screen-x = −world-x), millimetres, SVG y down. Parts are ordered far → near
 * (+Z first) so nearer parts paint on top, and each part becomes exactly one
 * `<g data-part-id>`.
 */
import type { PartId } from "@/lib/domain/data/parts";

import type { GeometryRecipe, ScenePlan, Vec3 } from "./types";

export type SilhouetteShape =
  | { type: "line"; x1: number; y1: number; x2: number; y2: number; width: number }
  | { type: "circle"; cx: number; cy: number; r: number; width: number; filled: boolean }
  | { type: "polyline"; points: string; width: number; closed: boolean }
  | { type: "polygon"; points: string };

export interface SilhouettePart {
  partId: PartId;
  shapes: SilhouetteShape[];
}

export interface Silhouette {
  viewBox: string;
  width: number;
  height: number;
  parts: SilhouettePart[];
}

/** Thinnest stroke drawn, mm: keeps chains and cables visible and tappable. */
export const MIN_STROKE_MM = 6;

const r1 = (value: number) => Math.round(value * 10) / 10;
const px = (p: Vec3): [number, number] => [r1(-p[0] * 1000), r1(-p[1] * 1000)];
const stroke = (radiusM: number) => r1(Math.max(MIN_STROKE_MM, radiusM * 2000));

export function projectRecipe(recipe: GeometryRecipe): SilhouetteShape {
  switch (recipe.kind) {
    case "tube":
    case "capsule": {
      const [x1, y1] = px(recipe.from);
      const [x2, y2] = px(recipe.to);
      // A tube along Z (an axle, a grip, a bottom-bracket shell) is seen
      // end-on: a line of zero length would draw nothing and be unclickable,
      // so it becomes the disc a side view really shows.
      if (Math.hypot(x2 - x1, y2 - y1) <= 1) {
        return {
          type: "circle",
          cx: x1,
          cy: y1,
          r: stroke(recipe.radius) / 2,
          width: 0,
          filled: true,
        };
      }
      return { type: "line", x1, y1, x2, y2, width: stroke(recipe.radius) };
    }
    case "path": {
      const points = recipe.points.map((p) => px(p).join(",")).join(" ");
      return { type: "polyline", points, width: stroke(recipe.radius), closed: recipe.closed };
    }
    case "torus": {
      const [cx, cy] = px(recipe.center);
      return {
        type: "circle",
        cx,
        cy,
        r: r1(recipe.radius * 1000),
        width: stroke(recipe.tube),
        filled: false,
      };
    }
    case "disc":
    case "gear": {
      const [cx, cy] = px(recipe.center);
      const radius = recipe.kind === "disc" ? recipe.radius : recipe.pitchRadius;
      return { type: "circle", cx, cy, r: r1(radius * 1000), width: 0, filled: true };
    }
    case "box": {
      const [w, h] = [recipe.size[0] / 2, recipe.size[1] / 2];
      const cos = Math.cos(recipe.rotationZ);
      const sin = Math.sin(recipe.rotationZ);
      const corners: Vec3[] = [
        [-w, -h, 0],
        [w, -h, 0],
        [w, h, 0],
        [-w, h, 0],
      ].map(([x, y]) => [
        recipe.center[0] + x! * cos - y! * sin,
        recipe.center[1] + x! * sin + y! * cos,
        0,
      ]);
      return { type: "polygon", points: corners.map((c) => px(c).join(",")).join(" ") };
    }
  }
}

function meanZ(recipes: readonly GeometryRecipe[]): number {
  const zs = recipes.map((recipe) => {
    switch (recipe.kind) {
      case "tube":
      case "capsule":
        return (recipe.from[2] + recipe.to[2]) / 2;
      case "path":
        return recipe.points.reduce((n, p) => n + p[2], 0) / Math.max(1, recipe.points.length);
      default:
        return recipe.center[2];
    }
  });
  return zs.reduce((n, z) => n + z, 0) / Math.max(1, zs.length);
}

export function silhouetteFor(plan: ScenePlan, paddingMm = 40): Silhouette {
  const ordered = plan.parts
    .map((part, index) => ({
      part,
      index,
      z: meanZ(part.meshes.flatMap((mesh) => mesh.recipes)),
    }))
    // Far (+Z) first; the frame stays behind everything that is at its depth.
    .sort((a, b) => b.z - a.z || a.index - b.index);

  const minX = -plan.bounds.max[0] * 1000 - paddingMm;
  const maxX = -plan.bounds.min[0] * 1000 + paddingMm;
  const minY = -plan.bounds.max[1] * 1000 - paddingMm;
  const maxY = -plan.bounds.min[1] * 1000 + paddingMm;
  const width = Math.round(maxX - minX);
  const height = Math.round(maxY - minY);

  return {
    viewBox: `${Math.round(minX)} ${Math.round(minY)} ${width} ${height}`,
    width,
    height,
    parts: ordered.map(({ part }) => ({
      partId: part.partId,
      shapes: part.meshes.flatMap((mesh) => mesh.recipes.map(projectRecipe)),
    })),
  };
}
