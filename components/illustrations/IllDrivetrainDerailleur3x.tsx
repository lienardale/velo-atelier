import type { IllustrationProps } from "./placeholder";
import { TreeIllustrationFrame } from "./tree-frame";
import { Crankset } from "./tree-parts";

/**
 * `ill-drivetrain-derailleur-3x` — option thumbnail (W2-T4c): a crankset with three chainrings and a front derailleur.
 *
 * The distinguishing feature is drawn in the accent token. No callouts: the
 * option label under the card names the picture.
 */
export function IllDrivetrainDerailleur3x(props: IllustrationProps) {
  return (
    <TreeIllustrationFrame id="ill-drivetrain-derailleur-3x" {...props}>
      <Crankset x={10} y={10} w={3} rings={3} frontDerailleur />
    </TreeIllustrationFrame>
  );
}
