import type { IllustrationProps } from "./placeholder";
import { TreeIllustrationFrame } from "./tree-frame";
import { SweptBar } from "./tree-parts";

/**
 * `ill-cockpit-swept` — option thumbnail (W2-T4c): a swept-back bar seen from above, curving toward the rider.
 *
 * The distinguishing feature is drawn in the accent token. No callouts: the
 * option label under the card names the picture.
 */
export function IllCockpitSwept(props: IllustrationProps) {
  return (
    <TreeIllustrationFrame id="ill-cockpit-swept" {...props}>
      <SweptBar x={10} y={10} w={3} />
    </TreeIllustrationFrame>
  );
}
