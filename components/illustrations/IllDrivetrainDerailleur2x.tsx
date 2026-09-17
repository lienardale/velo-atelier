import type { IllustrationProps } from "./placeholder";
import { TreeIllustrationFrame } from "./tree-frame";
import { Crankset } from "./tree-parts";

/**
 * `ill-drivetrain-derailleur-2x` — option thumbnail (W2-T4c): a crankset with two chainrings and a front derailleur.
 *
 * The distinguishing feature is drawn in the accent token. No callouts: the
 * option label under the card names the picture.
 */
export function IllDrivetrainDerailleur2x(props: IllustrationProps) {
  return (
    <TreeIllustrationFrame id="ill-drivetrain-derailleur-2x" {...props}>
      <Crankset x={10} y={10} w={3} rings={2} frontDerailleur />
    </TreeIllustrationFrame>
  );
}
