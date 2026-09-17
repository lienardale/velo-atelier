import type { IllustrationProps } from "./placeholder";
import { TreeIllustrationFrame } from "./tree-frame";
import { ThumbShifter } from "./tree-parts";

/**
 * `ill-shifter-thumb` — option thumbnail (W2-T4c): a lever on top of the bar, pushed with the thumb.
 *
 * The distinguishing feature is drawn in the accent token. No callouts: the
 * option label under the card names the picture.
 */
export function IllShifterThumb(props: IllustrationProps) {
  return (
    <TreeIllustrationFrame id="ill-shifter-thumb" {...props}>
      <ThumbShifter x={10} y={10} w={3} />
    </TreeIllustrationFrame>
  );
}
