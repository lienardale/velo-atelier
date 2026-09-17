import type { IllustrationProps } from "./placeholder";
import { TreeIllustrationFrame } from "./tree-frame";
import { StiShifter } from "./tree-parts";

/**
 * `ill-shifter-sti-integrated` — option thumbnail (W2-T4c): a road brake lever that swings sideways to shift.
 *
 * The distinguishing feature is drawn in the accent token. No callouts: the
 * option label under the card names the picture.
 */
export function IllShifterStiIntegrated(props: IllustrationProps) {
  return (
    <TreeIllustrationFrame id="ill-shifter-sti-integrated" {...props}>
      <StiShifter x={10} y={10} w={3} />
    </TreeIllustrationFrame>
  );
}
