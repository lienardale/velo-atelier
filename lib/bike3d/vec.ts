/**
 * Tiny immutable vector helpers over `Vec3` tuples, so the solver, the scene
 * plan and the silhouette stay free of three.js (they ship in the eager viewer
 * shell, three.js ships only in the lazy scene chunk).
 */
import type { Vec3 } from "./types";

export const add = (a: Vec3, b: Vec3): Vec3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
export const sub = (a: Vec3, b: Vec3): Vec3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
export const scale = (a: Vec3, k: number): Vec3 => [a[0] * k, a[1] * k, a[2] * k];
export const length = (a: Vec3): number => Math.hypot(a[0], a[1], a[2]);
export const distance = (a: Vec3, b: Vec3): number => length(sub(a, b));
export const lerp = (a: Vec3, b: Vec3, t: number): Vec3 => add(a, scale(sub(b, a), t));
export const withZ = (a: Vec3, z: number): Vec3 => [a[0], a[1], z];
export const offset = (a: Vec3, dx: number, dy: number, dz: number): Vec3 => [
  a[0] + dx,
  a[1] + dy,
  a[2] + dz,
];

export function normalize(a: Vec3): Vec3 {
  const l = length(a);
  return l === 0 ? [0, 0, 0] : scale(a, 1 / l);
}

export const isFiniteVec = (a: Vec3): boolean => a.every((c) => Number.isFinite(c));

export const round = (a: Vec3, digits = 6): Vec3 =>
  a.map((c) => Number(c.toFixed(digits)) + 0) as unknown as Vec3;

/** Component-wise min / max of a point cloud. */
export function boundsOf(points: readonly Vec3[]): { min: Vec3; max: Vec3 } {
  const min: [number, number, number] = [Infinity, Infinity, Infinity];
  const max: [number, number, number] = [-Infinity, -Infinity, -Infinity];
  for (const p of points) {
    for (let i = 0; i < 3; i++) {
      min[i] = Math.min(min[i]!, p[i]!);
      max[i] = Math.max(max[i]!, p[i]!);
    }
  }
  return { min, max };
}
