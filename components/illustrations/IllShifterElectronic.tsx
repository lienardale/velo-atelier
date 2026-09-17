import type { IllustrationProps } from "./placeholder";
import { TreeIllustrationFrame } from "./tree-frame";
import { ElectronicShifter } from "./tree-parts";

/**
 * `ill-shifter-electronic` — option thumbnail (W2-T4c): buttons on the lever, a battery, no gear cable.
 *
 * The distinguishing feature is drawn in the accent token. No callouts: the
 * option label under the card names the picture.
 */
export function IllShifterElectronic(props: IllustrationProps) {
  return (
    <TreeIllustrationFrame id="ill-shifter-electronic" {...props}>
      <ElectronicShifter x={10} y={10} w={3} />
    </TreeIllustrationFrame>
  );
}
