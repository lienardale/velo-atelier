import type { IllustrationProps } from "./placeholder";
import { TreeIllustrationFrame } from "./tree-frame";
import { RoadPedal } from "./tree-parts";

/**
 * `ill-pedals-road-clipless` — option thumbnail (W2-T4c): a large triangular three-bolt cleat over the pedal.
 *
 * The distinguishing feature is drawn in the accent token. No callouts: the
 * option label under the card names the picture.
 */
export function IllPedalsRoadClipless(props: IllustrationProps) {
  return (
    <TreeIllustrationFrame id="ill-pedals-road-clipless" {...props}>
      <RoadPedal x={10} y={10} w={3} />
    </TreeIllustrationFrame>
  );
}
