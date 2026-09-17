import type { IllustrationProps } from "./placeholder";
import { TreeIllustrationFrame } from "./tree-frame";
import { SizedWheel } from "./tree-parts";

/**
 * `ill-wheel-size-20` — option thumbnail (W2-T4c): a wheel drawn to scale, rim diameter 406 mm (ETRTO), wide tyre; the dashed circle is the 622 size.
 *
 * The distinguishing feature is drawn in the accent token. No callouts: the
 * option label under the card names the picture.
 */
export function IllWheelSize20(props: IllustrationProps) {
  return (
    <TreeIllustrationFrame id="ill-wheel-size-20" {...props}>
      <SizedWheel etrto={406} tire="wide" />
    </TreeIllustrationFrame>
  );
}
