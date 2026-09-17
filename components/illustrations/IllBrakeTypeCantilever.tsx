import type { IllustrationProps } from "./placeholder";
import { TreeIllustrationFrame } from "./tree-frame";
import { CantileverBrake } from "./tree-parts";

/**
 * `ill-brake-type-cantilever` — option thumbnail (W2-T4c): two short arms and a triangular straddle cable.
 *
 * The distinguishing feature is drawn in the accent token. No callouts: the
 * option label under the card names the picture.
 */
export function IllBrakeTypeCantilever(props: IllustrationProps) {
  return (
    <TreeIllustrationFrame id="ill-brake-type-cantilever" {...props}>
      <CantileverBrake x={10} y={10} w={3} />
    </TreeIllustrationFrame>
  );
}
