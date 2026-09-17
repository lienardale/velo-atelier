/**
 * Blocky parts: boxes (levers, calipers, saddle, derailleur bodies, pedals,
 * motor, lights). A box is rotated about Z around its own centre.
 */
import { BoxGeometry, BufferGeometry } from "three";

import type { Vec3 } from "../types";

export function boxGeometry(center: Vec3, size: Vec3, rotationZ: number): BufferGeometry {
  const geometry = new BoxGeometry(size[0], size[1], size[2]);
  if (rotationZ !== 0) geometry.rotateZ(rotationZ);
  geometry.translate(center[0], center[1], center[2]);
  return geometry;
}
