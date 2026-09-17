/**
 * Camera maths (pure): focus spheres, the default pose, and the named poses
 * the e2e hooks sweep to prove every part is clickable (§3.5 select-every-part).
 *
 * The default view looks at the drive side (camera on −Z), slightly from the
 * front and above, framing the whole bike.
 */
import { clickTargetOf, isPartId } from "@/lib/domain/data/parts";

import { sceneSphere } from "./scene";
import type { ScenePlan, Vec3 } from "./types";
import { add, normalize, scale } from "./vec";

/** Vertical field of view of the viewer camera, degrees. */
export const CAMERA_FOV = 35;

export interface CameraPose {
  position: Vec3;
  target: Vec3;
}

/** Directions from the target towards the camera. */
export const POSE_DIRECTIONS = {
  "drive-side": [0.25, 0.18, -1],
  "non-drive-side": [0.25, 0.18, 1],
  "drive-rear": [-0.9, 0.35, -0.8],
  "drive-front": [0.9, 0.35, -0.8],
  "non-drive-front": [0.9, 0.35, 0.8],
  "non-drive-rear": [-0.9, 0.35, 0.8],
  top: [0.05, 1, -0.25],
  front: [1, 0.25, -0.12],
  rear: [-1, 0.25, -0.12],
  "drive-low": [0.1, -0.45, -1],
} as const satisfies Record<string, Vec3>;

/**
 * Close-ups: a whole-bike view puts a 7 mm chain at 1–2 px, which no finger and
 * no robust test click can hit. These frame one region (an anchor and a radius)
 * from one side — what a user gets by pinching in.
 */
export const CLOSE_UPS = {
  "close-drive-bb": { anchor: "bb", radius: 0.26, direction: [0.15, 0.1, -1] },
  "close-drive-rear-axle": { anchor: "rearAxle", radius: 0.26, direction: [-0.1, 0.1, -1] },
  "close-drive-cockpit": { anchor: "stemEnd", radius: 0.32, direction: [0.35, 0.45, -1] },
  "close-non-drive-front-axle": { anchor: "frontAxle", radius: 0.26, direction: [0.15, 0.1, 1] },
  "close-non-drive-rear-axle": { anchor: "rearAxle", radius: 0.26, direction: [-0.15, 0.1, 1] },
  "close-non-drive-bb": { anchor: "bb", radius: 0.26, direction: [0.1, 0.1, 1] },
  "close-non-drive-cockpit": { anchor: "stemEnd", radius: 0.32, direction: [0.35, 0.45, 1] },
  "close-top-cockpit": { anchor: "stemEnd", radius: 0.4, direction: [0.3, 1, -0.1] },
  // Rim brakes sit at the top of the rear rim, outside the axle close-ups.
  "close-drive-rear-brake": {
    anchor: "part:brake-caliper-rear",
    radius: 0.2,
    direction: [0.1, 0.3, -1],
  },
  "close-non-drive-rear-brake": {
    anchor: "part:brake-caliper-rear",
    radius: 0.2,
    direction: [0.1, 0.3, 1],
  },
} as const satisfies Record<
  string,
  {
    anchor: "bb" | "rearAxle" | "frontAxle" | "stemEnd" | `part:${string}`;
    radius: number;
    direction: Vec3;
  }
>;

export type PoseName = keyof typeof POSE_DIRECTIONS | keyof typeof CLOSE_UPS;

export const POSE_NAMES = [
  ...Object.keys(POSE_DIRECTIONS),
  ...Object.keys(CLOSE_UPS),
] as PoseName[];

export function isPoseName(value: unknown): value is PoseName {
  return (
    typeof value === "string" &&
    (Object.hasOwn(POSE_DIRECTIONS, value) || Object.hasOwn(CLOSE_UPS, value))
  );
}

/** Distance at which a sphere of `radius` fills the vertical field of view. */
export function fitDistance(radius: number, fovDeg = CAMERA_FOV, aspect = 1): number {
  const vertical = (fovDeg * Math.PI) / 360;
  const horizontal = Math.atan(Math.tan(vertical) * Math.max(aspect, 0.1));
  return radius / Math.sin(Math.min(vertical, horizontal));
}

export function poseFor(plan: ScenePlan, name: PoseName, aspect = 1, margin = 1.02): CameraPose {
  if (Object.hasOwn(CLOSE_UPS, name)) {
    const closeUp = CLOSE_UPS[name as keyof typeof CLOSE_UPS];
    const anchor: string = closeUp.anchor;
    const target = anchor.startsWith("part:")
      ? (plan.parts.find((part) => `part:${part.partId}` === anchor)?.focus.center ??
        plan.anchors.rearAxle)
      : plan.anchors[anchor as "bb" | "rearAxle" | "frontAxle" | "stemEnd"];
    return {
      target,
      position: add(
        target,
        scale(normalize(closeUp.direction), fitDistance(closeUp.radius, CAMERA_FOV, aspect)),
      ),
    };
  }
  const { center, radius } = sceneSphere(plan);
  const direction = normalize(POSE_DIRECTIONS[name as keyof typeof POSE_DIRECTIONS]);
  return {
    target: center,
    position: add(center, scale(direction, fitDistance(radius, CAMERA_FOV, aspect) * margin)),
  };
}

export function defaultPose(plan: ScenePlan, aspect = 1): CameraPose {
  return poseFor(plan, "drive-side", aspect);
}

/**
 * The sphere to fit when `partId` is focused: the part's own, or its host's for
 * a hosted part (pads → caliper). `null` when the part is not drawn at all.
 */
export function focusSphereFor(
  plan: ScenePlan,
  partId: string,
  minRadius = 0.08,
): { center: Vec3; radius: number } | null {
  if (!isPartId(partId)) return null;
  const target = clickTargetOf(partId);
  const part = plan.parts.find((candidate) => candidate.partId === target);
  if (!part) return null;
  return { center: part.focus.center, radius: Math.max(minRadius, part.focus.radius) };
}
