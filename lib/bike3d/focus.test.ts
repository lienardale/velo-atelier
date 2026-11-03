import { describe, expect, it } from "vitest";

import { presetBuild } from "./builds";
import {
  CAMERA_FOV,
  defaultPose,
  fitDistance,
  focusSphereFor,
  isPoseName,
  POSE_NAMES,
  poseFor,
} from "./focus";
import { planScene, sceneSphere } from "./scene";
import { DRIVE_SIDE_Z, LEFT_Z } from "./types";
import { distance } from "./vec";

const plan = planScene(presetBuild("road-disc-2x12"));

describe("fitDistance", () => {
  it("grows with the radius and shrinks with the field of view", () => {
    expect(fitDistance(2)).toBeCloseTo(2 * fitDistance(1), 9);
    expect(fitDistance(1, 60)).toBeLessThan(fitDistance(1, CAMERA_FOV));
    expect(fitDistance(1, CAMERA_FOV, 1)).toBeCloseTo(
      1 / Math.sin((CAMERA_FOV * Math.PI) / 360),
      9,
    );
  });

  it("backs off on a portrait canvas, where the horizontal angle is narrower", () => {
    expect(fitDistance(1, CAMERA_FOV, 0.5)).toBeGreaterThan(fitDistance(1, CAMERA_FOV, 1));
    expect(fitDistance(1, CAMERA_FOV, 2)).toBeCloseTo(fitDistance(1, CAMERA_FOV, 1), 9);
    expect(Number.isFinite(fitDistance(1, CAMERA_FOV, 0))).toBe(true);
  });
});

describe("poses", () => {
  it("every pose looks at the bike from its fit distance", () => {
    const { center, radius } = sceneSphere(plan);
    for (const name of POSE_NAMES) {
      if (name.startsWith("close-")) continue;
      const pose = poseFor(plan, name, 1.6);
      expect(pose.target).toEqual(center);
      expect(distance(pose.position, pose.target)).toBeCloseTo(
        fitDistance(radius, CAMERA_FOV, 1.6) * 1.02,
        9,
      );
    }
  });

  it("close-ups frame one region from much nearer", () => {
    const whole = poseFor(plan, "drive-side");
    const bb = poseFor(plan, "close-drive-bb");
    expect(bb.target).toEqual(plan.anchors.bb);
    expect(distance(bb.position, bb.target)).toBeCloseTo(fitDistance(0.26), 9);
    expect(distance(bb.position, bb.target)).toBeLessThan(
      distance(whole.position, whole.target) / 3,
    );
    expect(
      Math.sign(
        poseFor(plan, "close-non-drive-front-axle").position[2] - plan.anchors.frontAxle[2],
      ),
    ).toBe(LEFT_Z);
    expect(isPoseName("close-top-cockpit")).toBe(true);
    const caliper = plan.parts.find((part) => part.partId === "brake-caliper-rear")!;
    expect(poseFor(plan, "close-drive-rear-brake").target).toEqual(caliper.focus.center);
    const noCaliper = { ...plan, parts: plan.parts.filter((part) => part !== caliper) };
    expect(poseFor(noCaliper, "close-drive-rear-brake").target).toEqual(plan.anchors.rearAxle);
  });

  it("the default pose is the drive side (camera on +Z), from slightly in front", () => {
    const pose = defaultPose(plan);
    expect(Math.sign(pose.position[2] - pose.target[2])).toBe(DRIVE_SIDE_Z);
    expect(pose.position[0]).toBeGreaterThan(pose.target[0]);
    expect(pose).toEqual(poseFor(plan, "drive-side"));
  });

  it("names every side pose after the side its camera is on", () => {
    for (const name of POSE_NAMES) {
      const side = name.includes("non-drive") ? LEFT_Z : name.includes("drive") ? DRIVE_SIDE_Z : 0;
      if (side === 0) continue;
      const pose = poseFor(plan, name);
      expect(Math.sign(pose.position[2] - pose.target[2]), name).toBe(side);
    }
  });

  it("puts the front wheel on the right of the default view", () => {
    // Camera basis: right = forward × up, with forward = target − position.
    const pose = defaultPose(plan);
    const forward = [
      pose.target[0] - pose.position[0],
      pose.target[1] - pose.position[1],
      pose.target[2] - pose.position[2],
    ] as const;
    // up = +Y, so forward × up = (−forward.z, 0, forward.x).
    const right = [-forward[2], 0, forward[0]] as const;
    const toFront = plan.anchors.frontAxle[0] - plan.anchors.rearAxle[0];
    expect(Math.sign(right[0] * toFront)).toBe(1);
  });

  it("guards pose names", () => {
    expect(isPoseName("top")).toBe(true);
    expect(isPoseName("toString")).toBe(false);
    expect(isPoseName(42)).toBe(false);
  });
});

describe("focusSphereFor", () => {
  it("focuses a drawn part, and a hosted part through its host", () => {
    const caliper = focusSphereFor(plan, "brake-caliper-front")!;
    expect(focusSphereFor(plan, "brake-pads-front")).toEqual(caliper);
    expect(caliper.radius).toBeGreaterThanOrEqual(0.08);
    expect(focusSphereFor(plan, "frame")!.radius).toBeGreaterThan(0.4);
    expect(focusSphereFor(plan, "frame", 5)!.radius).toBe(5);
  });

  it("returns null for unknown or undrawn parts", () => {
    expect(focusSphereFor(plan, "nope")).toBeNull();
    expect(focusSphereFor(planScene(presetBuild("road-rim-2x11")), "rotor-front")).toBeNull();
  });
});
