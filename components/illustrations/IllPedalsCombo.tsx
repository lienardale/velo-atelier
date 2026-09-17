import type { IllustrationProps } from "./placeholder";
import { TreeIllustrationFrame } from "./tree-frame";
import { ComboPedal } from "./tree-parts";

/**
 * `ill-pedals-combo` — option thumbnail (W2-T4c): one flat half with pins, one clipless half.
 *
 * The distinguishing feature is drawn in the accent token. No callouts: the
 * option label under the card names the picture.
 */
export function IllPedalsCombo(props: IllustrationProps) {
  return (
    <TreeIllustrationFrame id="ill-pedals-combo" {...props}>
      <ComboPedal x={10} y={10} w={3} />
    </TreeIllustrationFrame>
  );
}
