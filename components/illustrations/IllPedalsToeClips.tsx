import type { IllustrationProps } from "./placeholder";
import { TreeIllustrationFrame } from "./tree-frame";
import { ToeClipPedal } from "./tree-parts";

/**
 * `ill-pedals-toe-clips` — option thumbnail (W2-T4c): a cage and strap above the pedal, from the side.
 *
 * The distinguishing feature is drawn in the accent token. No callouts: the
 * option label under the card names the picture.
 */
export function IllPedalsToeClips(props: IllustrationProps) {
  return (
    <TreeIllustrationFrame id="ill-pedals-toe-clips" {...props}>
      <ToeClipPedal x={10} y={10} w={3} />
    </TreeIllustrationFrame>
  );
}
