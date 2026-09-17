import type { IllustrationProps } from "./placeholder";
import { TreeIllustrationFrame } from "./tree-frame";
import { RiserBar } from "./tree-parts";

/**
 * `ill-cockpit-riser` — option thumbnail (W2-T4c): a riser bar from the front, rising on each side of the stem.
 *
 * The distinguishing feature is drawn in the accent token. No callouts: the
 * option label under the card names the picture.
 */
export function IllCockpitRiser(props: IllustrationProps) {
  return (
    <TreeIllustrationFrame id="ill-cockpit-riser" {...props}>
      <RiserBar x={10} y={10} w={3} />
    </TreeIllustrationFrame>
  );
}
