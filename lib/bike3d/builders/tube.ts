/**
 * Tubes: straight (`tubeBetween`), bent through points (`bentTube`, a
 * Catmull-Rom curve) and capsules. All return indexed `BufferGeometry` with
 * position / normal / uv, ready for `mergeGeometries`.
 */
import {
  BufferGeometry,
  CapsuleGeometry,
  CatmullRomCurve3,
  CylinderGeometry,
  Quaternion,
  TubeGeometry,
  Vector3,
} from "three";

import type { Vec3 } from "../types";
import type { LodSettings } from "./lod";

const Y = new Vector3(0, 1, 0);

/** Orient a Y-aligned geometry of height `|to − from|` between two points. */
export function orientBetween(geometry: BufferGeometry, from: Vec3, to: Vec3): BufferGeometry {
  const a = new Vector3(...from);
  const b = new Vector3(...to);
  const dir = b.clone().sub(a);
  const len = dir.length();
  if (len > 0) {
    geometry.applyQuaternion(new Quaternion().setFromUnitVectors(Y, dir.normalize()));
  }
  const mid = a.add(b).multiplyScalar(0.5);
  geometry.translate(mid.x, mid.y, mid.z);
  return geometry;
}

export function tubeBetween(
  from: Vec3,
  to: Vec3,
  radius: number,
  lod: LodSettings,
): BufferGeometry {
  const len = Math.max(1e-4, new Vector3(...from).distanceTo(new Vector3(...to)));
  return orientBetween(
    new CylinderGeometry(radius, radius, len, lod.tubeRadial, 1, false),
    from,
    to,
  );
}

export function bentTube(
  points: readonly Vec3[],
  radius: number,
  closed: boolean,
  lod: LodSettings,
): BufferGeometry {
  const curve = new CatmullRomCurve3(
    points.map((p) => new Vector3(...p)),
    closed,
    "centripetal",
  );
  const segments = closed ? lod.pathSegments * 2 : Math.max(8, Math.round(lod.pathSegments / 2));
  return new TubeGeometry(curve, segments, radius, Math.max(4, lod.tubeRadial - 4), closed);
}

export function capsuleBetween(
  from: Vec3,
  to: Vec3,
  radius: number,
  lod: LodSettings,
): BufferGeometry {
  const len = Math.max(1e-4, new Vector3(...from).distanceTo(new Vector3(...to)));
  return orientBetween(
    new CapsuleGeometry(radius, len, Math.max(2, lod.capsuleSegments / 4), lod.capsuleSegments),
    from,
    to,
  );
}
