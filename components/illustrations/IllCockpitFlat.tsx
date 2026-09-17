import type { IllustrationProps } from "./placeholder";
import { TreeIllustrationFrame } from "./tree-frame";
import { FlatBar } from "./tree-parts";

/**
 * `ill-cockpit-flat` — option thumbnail (W2-T4c): a flat bar from the front, straight end to end.
 *
 * The distinguishing feature is drawn in the accent token. No callouts: the
 * option label under the card names the picture.
 */
export function IllCockpitFlat(props: IllustrationProps) {
  return (
    <TreeIllustrationFrame id="ill-cockpit-flat" {...props}>
      <FlatBar x={10} y={10} w={3} />
    </TreeIllustrationFrame>
  );
}
