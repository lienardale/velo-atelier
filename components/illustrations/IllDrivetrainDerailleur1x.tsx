import type { IllustrationProps } from "./placeholder";
import { TreeIllustrationFrame } from "./tree-frame";
import { Crankset } from "./tree-parts";

/**
 * `ill-drivetrain-derailleur-1x` — option thumbnail (W2-T4c): a crankset with a single chainring.
 *
 * The distinguishing feature is drawn in the accent token. No callouts: the
 * option label under the card names the picture.
 */
export function IllDrivetrainDerailleur1x(props: IllustrationProps) {
  return (
    <TreeIllustrationFrame id="ill-drivetrain-derailleur-1x" {...props}>
      <Crankset x={10} y={10} w={3} rings={1} />
    </TreeIllustrationFrame>
  );
}
