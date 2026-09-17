import type { IllustrationProps } from "./placeholder";
import { TreeIllustrationFrame } from "./tree-frame";
import { RimCaliperBrake } from "./tree-parts";

/**
 * `ill-brake-type-rim-caliper` — option thumbnail (W2-T4c): a single arch over the tyre.
 *
 * The distinguishing feature is drawn in the accent token. No callouts: the
 * option label under the card names the picture.
 */
export function IllBrakeTypeRimCaliper(props: IllustrationProps) {
  return (
    <TreeIllustrationFrame id="ill-brake-type-rim-caliper" {...props}>
      <RimCaliperBrake x={10} y={10} w={3} />
    </TreeIllustrationFrame>
  );
}
