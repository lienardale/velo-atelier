import type { IllustrationProps } from "./placeholder";
import { TreeIllustrationFrame } from "./tree-frame";
import { GripShifter } from "./tree-parts";

/**
 * `ill-shifter-grip` — option thumbnail (W2-T4c): a ridged collar that twists around the bar.
 *
 * The distinguishing feature is drawn in the accent token. No callouts: the
 * option label under the card names the picture.
 */
export function IllShifterGrip(props: IllustrationProps) {
  return (
    <TreeIllustrationFrame id="ill-shifter-grip" {...props}>
      <GripShifter x={10} y={10} w={3} />
    </TreeIllustrationFrame>
  );
}
