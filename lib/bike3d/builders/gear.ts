/**
 * Sprockets: a toothed profile extruded 2 mm on the high tier, a plain
 * cylinder on the low tier (§3.3). The gear lies in the XY plane, its face at
 * `center.z`, extruded towards −Z (the drive side).
 */
import { BufferGeometry, CylinderGeometry, ExtrudeGeometry, Shape } from "three";

import type { Vec3 } from "../types";
import type { LodSettings } from "./lod";

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
    cylinder.translate(center[0], center[1], center[2] - thickness / 2);
    return cylinder;
  }
  const geometry = new ExtrudeGeometry(gearProfile(teeth, pitchRadius), {
    depth: 0.002,
    bevelEnabled: false,
    curveSegments: 1,
  });
  geometry.translate(center[0], center[1], center[2] - 0.002);
  return geometry;
}
