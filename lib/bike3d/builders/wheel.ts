/**
 * Wheels: rim and tyre tori, hub discs, and the spokes.
 *
 * Spokes are ONE `InstancedMesh` of `CylinderGeometry(0.001, 0.001, L, 4)` with
 * 32 instances at every tier — never `LineSegments` (§3.3: line width is
 * ignored by WebGL and lines are not pickable). `spokeMatrices` computes the
 * instance transforms; the component hands them to the instanced mesh.
 */
import {
  BufferGeometry,
  CylinderGeometry,
  Matrix4,
  Quaternion,
  TorusGeometry,
  Vector3,
} from "three";

import type { SpokeDescriptor, Vec3 } from "../types";
import type { LodSettings } from "./lod";

export function torusGeometry(
  center: Vec3,
  radius: number,
  tube: number,
  lod: LodSettings,
): BufferGeometry {
  const geometry = new TorusGeometry(radius, tube, lod.torusRadial, lod.torusTubular);
  geometry.translate(center[0], center[1], center[2]);
  return geometry;
}

/** A flat disc (hub shell, rotor, pulley) with its axis along Z. */
export function discGeometry(
  center: Vec3,
  radius: number,
  thickness: number,
  lod: LodSettings,
): BufferGeometry {
  const geometry = new CylinderGeometry(radius, radius, thickness, lod.discSegments);
  geometry.rotateX(Math.PI / 2);
  geometry.translate(center[0], center[1], center[2]);
  return geometry;
}

/** Unit-length spoke, scaled per instance. */
export function spokeGeometry(): BufferGeometry {
  return new CylinderGeometry(0.001, 0.001, 1, 4, 1, true);
}

/**
 * One matrix per spoke: hub flange (alternating ±flangeOffset) to rim, with a
 * tangential lacing offset so the wheel reads as laced, not radial.
 */
export function spokeMatrices(spokes: SpokeDescriptor): Matrix4[] {
  const matrices: Matrix4[] = [];
  const up = new Vector3(0, 1, 0);
  for (let i = 0; i < spokes.count; i++) {
    const angle = (2 * Math.PI * i) / spokes.count;
    const side = i % 2 === 0 ? 1 : -1;
    const lace = side * 0.35;
    const hub = new Vector3(
      spokes.center[0] + spokes.hubRadius * Math.cos(angle + lace),
      spokes.center[1] + spokes.hubRadius * Math.sin(angle + lace),
      spokes.center[2] + side * spokes.flangeOffset,
    );
    const rim = new Vector3(
      spokes.center[0] + spokes.rimRadius * Math.cos(angle),
      spokes.center[1] + spokes.rimRadius * Math.sin(angle),
      spokes.center[2],
    );
    const dir = rim.clone().sub(hub);
    const length = dir.length();
    const quaternion = new Quaternion().setFromUnitVectors(up, dir.normalize());
    const position = hub.add(rim).multiplyScalar(0.5);
    matrices.push(new Matrix4().compose(position, quaternion, new Vector3(1, length, 1)));
  }
  return matrices;
}
