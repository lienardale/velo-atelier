import type { IllustrationProps } from "./placeholder";
import { TreeIllustrationFrame } from "./tree-frame";
import { DiscHydraulicBrake } from "./tree-parts";

/**
 * `ill-brake-type-disc-hydraulic` — option thumbnail (W2-T4c): a disc caliper fed by a hose on a banjo fitting.
 *
 * The distinguishing feature is drawn in the accent token. No callouts: the
 * option label under the card names the picture.
 */
export function IllBrakeTypeDiscHydraulic(props: IllustrationProps) {
  return (
    <TreeIllustrationFrame id="ill-brake-type-disc-hydraulic" {...props}>
      <DiscHydraulicBrake x={10} y={10} w={3} />
    </TreeIllustrationFrame>
  );
}
