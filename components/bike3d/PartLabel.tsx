/**
 * The one drei `<Html>` in the project (§3.3): a label chip over the selected
 * part. `pointer-events: none`, so it never steals a tap from the canvas.
 * WebGL-only: covered by Playwright.
 */
"use client";

import { Html } from "@react-three/drei";

import { focusSphereFor } from "@/lib/bike3d/focus";
import type { ScenePlan } from "@/lib/bike3d/types";

import { useViewerStore } from "./store";

export function PartLabel({
  plan,
  labels,
}: {
  plan: ScenePlan;
  labels: Readonly<Record<string, string>>;
}): React.JSX.Element | null {
  const selected = useViewerStore((state) => state.selectedPartId);
  const sphere = selected ? focusSphereFor(plan, selected) : null;
  if (!selected || !sphere) return null;
  return (
    <Html
      position={[sphere.center[0], sphere.center[1] + sphere.radius * 0.6, sphere.center[2]]}
      center
      zIndexRange={[20, 0]}
      style={{ pointerEvents: "none" }}
    >
      <span
        data-testid="bike3d-label"
        className="bg-paper text-ink border-rule pointer-events-none rounded-md border px-2 py-0.5 text-xs font-medium whitespace-nowrap shadow-sm"
      >
        {labels[selected] ?? selected}
      </span>
    </Html>
  );
}
