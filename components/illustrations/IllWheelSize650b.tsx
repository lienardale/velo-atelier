import type { IllustrationProps } from "./placeholder";
import { TreeIllustrationFrame } from "./tree-frame";
import { SizedWheel } from "./tree-parts";

/**
 * `ill-wheel-size-650b` — option thumbnail (W2-T4c): a wheel drawn to scale, rim diameter 584 mm (ETRTO), wide tyre; the dashed circle is the 622 size.
 *
 * The distinguishing feature is drawn in the accent token. No callouts: the
 * option label under the card names the picture.
 */
export function IllWheelSize650b(props: IllustrationProps) {
  return (
    <TreeIllustrationFrame id="ill-wheel-size-650b" {...props}>
      <SizedWheel etrto={584} tire="wide" />
    </TreeIllustrationFrame>
  );
}
