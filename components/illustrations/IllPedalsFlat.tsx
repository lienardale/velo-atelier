import type { IllustrationProps } from "./placeholder";
import { TreeIllustrationFrame } from "./tree-frame";
import { FlatPedal } from "./tree-parts";

/**
 * `ill-pedals-flat` — option thumbnail (W2-T4c): a wide platform with pins, from above.
 *
 * The distinguishing feature is drawn in the accent token. No callouts: the
 * option label under the card names the picture.
 */
export function IllPedalsFlat(props: IllustrationProps) {
  return (
    <TreeIllustrationFrame id="ill-pedals-flat" {...props}>
      <FlatPedal x={10} y={10} w={3} />
    </TreeIllustrationFrame>
  );
}
