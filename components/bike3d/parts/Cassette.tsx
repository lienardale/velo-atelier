/**
 * `cassette`, `freewheel` (the cog block) and `internal-gear-hub` (hub shell + sprocket).
 *
 * Declarative only (ESLint: no if / ternary / && / loops here): every decision
 * about what this part looks like is taken in `lib/bike3d/scene.ts` and arrives
 * as mesh descriptors on `part`.
 */
"use client";

import { PartMeshes, type PartProps } from "../Part";

export function Cassette(props: PartProps): React.JSX.Element {
  return <PartMeshes {...props} />;
}
