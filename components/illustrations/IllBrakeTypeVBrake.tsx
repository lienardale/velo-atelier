import type { IllustrationProps } from "./placeholder";
import { TreeIllustrationFrame } from "./tree-frame";
import { VBrake } from "./tree-parts";

/**
 * `ill-brake-type-v-brake` — option thumbnail (W2-T4c): two vertical arms joined by a cross cable.
 *
 * The distinguishing feature is drawn in the accent token. No callouts: the
 * option label under the card names the picture.
 */
export function IllBrakeTypeVBrake(props: IllustrationProps) {
  return (
    <TreeIllustrationFrame id="ill-brake-type-v-brake" {...props}>
      <VBrake x={10} y={10} w={3} />
    </TreeIllustrationFrame>
  );
}
