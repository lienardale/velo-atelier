import type { IllustrationProps } from "./placeholder";
import { TreeIllustrationFrame } from "./tree-frame";
import { SingleSpeed } from "./tree-parts";

/**
 * `ill-drivetrain-singlespeed` — option thumbnail (W2-T4c): one chainring, one sprocket, no derailleur.
 *
 * The distinguishing feature is drawn in the accent token. No callouts: the
 * option label under the card names the picture.
 */
export function IllDrivetrainSinglespeed(props: IllustrationProps) {
  return (
    <TreeIllustrationFrame id="ill-drivetrain-singlespeed" {...props}>
      <SingleSpeed x={10} y={10} w={3} />
    </TreeIllustrationFrame>
  );
}
