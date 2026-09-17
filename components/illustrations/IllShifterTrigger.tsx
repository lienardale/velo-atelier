import type { IllustrationProps } from "./placeholder";
import { TreeIllustrationFrame } from "./tree-frame";
import { TriggerShifter } from "./tree-parts";

/**
 * `ill-shifter-trigger` — option thumbnail (W2-T4c): two trigger levers under the bar.
 *
 * The distinguishing feature is drawn in the accent token. No callouts: the
 * option label under the card names the picture.
 */
export function IllShifterTrigger(props: IllustrationProps) {
  return (
    <TreeIllustrationFrame id="ill-shifter-trigger" {...props}>
      <TriggerShifter x={10} y={10} w={3} />
    </TreeIllustrationFrame>
  );
}
