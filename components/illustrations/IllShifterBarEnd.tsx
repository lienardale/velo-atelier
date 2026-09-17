import type { IllustrationProps } from "./placeholder";
import { TreeIllustrationFrame } from "./tree-frame";
import { BarEndShifter } from "./tree-parts";

/**
 * `ill-shifter-bar-end` — option thumbnail (W2-T4c): a lever at the end of a drop bar.
 *
 * The distinguishing feature is drawn in the accent token. No callouts: the
 * option label under the card names the picture.
 */
export function IllShifterBarEnd(props: IllustrationProps) {
  return (
    <TreeIllustrationFrame id="ill-shifter-bar-end" {...props}>
      <BarEndShifter x={10} y={10} w={3} />
    </TreeIllustrationFrame>
  );
}
