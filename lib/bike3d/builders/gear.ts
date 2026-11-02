/**
 * Sprockets: a toothed profile extruded 2 mm on the high tier, a plain
 * cylinder on the low tier (§3.3). The gear lies in the XY plane, its face at
 * `center.z`, extruded outboard — towards the drive side (`DRIVE_SIDE_Z`).
 */
import { BufferGeometry, CylinderGeometry, ExtrudeGeometry, Shape } from "three";

import { DRIVE_SIDE_Z, type Vec3 } from "../types";
import type { LodSettings } from "./lod";

/** The lower z of a slab `depth` thick whose face is at `face`, extruded towards the drive side. */
const slabStart = (face: number, depth: number) => Math.min(face, face + DRIVE_SIDE_Z * depth);

/** Closed tooth outline: root circle and tip circle alternating, 4 points per tooth. */
export function gearProfile(teeth: number, pitchRadius: number): Shape {
  const tip = pitchRadius + 0.0035;
  const root = pitchRadius - 0.0045;
  const shape = new Shape();
  const step = (2 * Math.PI) / teeth;
  for (let i = 0; i < teeth; i++) {
    const a = i * step;
    const corners: Array<[number, number]> = [
      [root, a],
      [tip, a + step * 0.3],
      [tip, a + step * 0.5],
      [root, a + step * 0.8],
    ];
    corners.forEach(([r, angle], k) => {
      const x = r * Math.cos(angle);
      const y = r * Math.sin(angle);
      if (i === 0 && k === 0) shape.moveTo(x, y);
      else shape.lineTo(x, y);
    });
  }
  shape.closePath();
  return shape;
}

export function gearGeometry(
  center: Vec3,
  teeth: number,
  pitchRadius: number,
  thickness: number,
  lod: LodSettings,
): BufferGeometry {
  if (!lod.gearTeeth) {
    const cylinder = new CylinderGeometry(pitchRadius, pitchRadius, thickness, lod.discSegments);
    cylinder.rotateX(Math.PI / 2);
    cylinder.translate(center[0], center[1], slabStart(center[2], thickness) + thickness / 2);
    return cylinder;
  }
  const depth = 0.002;
  const geometry = new ExtrudeGeometry(gearProfile(teeth, pitchRadius), {
    depth,
    bevelEnabled: false,
    curveSegments: 1,
  });
  geometry.translate(center[0], center[1], slabStart(center[2], depth));
  return geometry;
}
