/**
 * `mudguards`, `rack`, `kickstand`, `lights` — one draw call each.
 *
 * Declarative only (ESLint: no if / ternary / && / loops here): every decision
 * about what this part looks like is taken in `lib/bike3d/scene.ts` and arrives
 * as mesh descriptors on `part`.
 */
"use client";

import { PartMeshes, type PartProps } from "../Part";

export function Accessories(props: PartProps): React.JSX.Element {
  return <PartMeshes {...props} />;
}
