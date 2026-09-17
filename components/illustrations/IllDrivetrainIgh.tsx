import type { IllustrationProps } from "./placeholder";
import { TreeIllustrationFrame } from "./tree-frame";
import { GearHub } from "./tree-parts";

/**
 * `ill-drivetrain-igh` — option thumbnail (W2-T4c): a fat, smooth internal-gear hub with one sprocket.
 *
 * The distinguishing feature is drawn in the accent token. No callouts: the
 * option label under the card names the picture.
 */
export function IllDrivetrainIgh(props: IllustrationProps) {
  return (
    <TreeIllustrationFrame id="ill-drivetrain-igh" {...props}>
      <GearHub x={10} y={10} w={3} />
    </TreeIllustrationFrame>
  );
}
