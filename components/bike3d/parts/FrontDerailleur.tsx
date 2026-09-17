/**
 * `front-derailleur` — cage clamped on the seat tube above the outer ring.
 *
 * Declarative only (ESLint: no if / ternary / && / loops here): every decision
 * about what this part looks like is taken in `lib/bike3d/scene.ts` and arrives
 * as mesh descriptors on `part`.
 */
"use client";

import { PartMeshes, type PartProps } from "../Part";

export function FrontDerailleur(props: PartProps): React.JSX.Element {
  return <PartMeshes {...props} />;
}
