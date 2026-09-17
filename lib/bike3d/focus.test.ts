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
    expect(poseFor(plan, "close-non-drive-front-axle").position[2]).toBeGreaterThan(
      plan.anchors.frontAxle[2],
    );
    expect(isPoseName("close-top-cockpit")).toBe(true);
    const caliper = plan.parts.find((part) => part.partId === "brake-caliper-rear")!;
    expect(poseFor(plan, "close-drive-rear-brake").target).toEqual(caliper.focus.center);
    const noCaliper = { ...plan, parts: plan.parts.filter((part) => part !== caliper) };
    expect(poseFor(noCaliper, "close-drive-rear-brake").target).toEqual(plan.anchors.rearAxle);
  });

  it("the default pose is the drive side (camera on −Z)", () => {
    const pose = defaultPose(plan);
    expect(pose.position[2]).toBeLessThan(pose.target[2]);
    expect(pose).toEqual(poseFor(plan, "drive-side"));
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
