import type { IllustrationProps } from "./placeholder";
import { TreeIllustrationFrame } from "./tree-frame";
import { SpdPedal } from "./tree-parts";

/**
 * `ill-pedals-spd` — option thumbnail (W2-T4c): a small recessed mechanism and its two-bolt cleat.
 *
 * The distinguishing feature is drawn in the accent token. No callouts: the
 * option label under the card names the picture.
 */
export function IllPedalsSpd(props: IllustrationProps) {
  return (
    <TreeIllustrationFrame id="ill-pedals-spd" {...props}>
      <SpdPedal x={10} y={10} w={3} />
    </TreeIllustrationFrame>
  );
}
