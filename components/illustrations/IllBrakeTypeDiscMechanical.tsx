import type { IllustrationProps } from "./placeholder";
import { TreeIllustrationFrame } from "./tree-frame";
import { DiscMechanicalBrake } from "./tree-parts";

/**
 * `ill-brake-type-disc-mechanical` — option thumbnail (W2-T4c): a disc caliper pulled by a cable in its housing.
 *
 * The distinguishing feature is drawn in the accent token. No callouts: the
 * option label under the card names the picture.
 */
export function IllBrakeTypeDiscMechanical(props: IllustrationProps) {
  return (
    <TreeIllustrationFrame id="ill-brake-type-disc-mechanical" {...props}>
      <DiscMechanicalBrake x={10} y={10} w={3} />
    </TreeIllustrationFrame>
  );
}
