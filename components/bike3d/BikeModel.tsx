/**
 * The bike as a three.js scene graph: one `parts/*` component per rendered
 * part of the plan, in draw order. No drei DOM components here (no `<Html>`),
 * so `@react-three/test-renderer` mounts it without a WebGL context
 * (`tests/bike3d/bike-model.test.tsx`).
 */
"use client";

import type { ComponentType } from "react";

import type { PartComponentName, ScenePlan } from "@/lib/bike3d/types";

import type { PartProps } from "./Part";
import { Accessories } from "./parts/Accessories";
import { Battery } from "./parts/Battery";
import { Brake } from "./parts/Brake";
import { Cassette } from "./parts/Cassette";
import { Chain } from "./parts/Chain";
import { Cockpit } from "./parts/Cockpit";
import { Crankset } from "./parts/Crankset";
import { EMotor } from "./parts/EMotor";
import { Fork } from "./parts/Fork";
import { Frame } from "./parts/Frame";
import { FrontDerailleur } from "./parts/FrontDerailleur";
import { RearDerailleur } from "./parts/RearDerailleur";
import { RearShock } from "./parts/RearShock";
import { Saddle } from "./parts/Saddle";
import { Seatpost } from "./parts/Seatpost";
import { Wheel } from "./parts/Wheel";

export const PART_COMPONENTS: Record<PartComponentName, ComponentType<PartProps>> = {
  Frame,
  Fork,
  Wheel,
  Crankset,
  Cassette,
  Chain,
  RearDerailleur,
  FrontDerailleur,
  Brake,
  Cockpit,
  Saddle,
  Seatpost,
  RearShock,
  EMotor,
  Battery,
  Accessories,
};

export function BikeModel({ plan }: { plan: ScenePlan }): React.JSX.Element {
  return (
    <group name="bike" userData={{ hash: plan.hash }}>
      {plan.parts.map((part) => {
        const Component = PART_COMPONENTS[part.component];
        return <Component key={part.partId} part={part} hash={plan.hash} />;
      })}
    </group>
  );
}
