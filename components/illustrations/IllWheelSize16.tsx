import type { IllustrationProps } from "./placeholder";
import { TreeIllustrationFrame } from "./tree-frame";
import { SizedWheel } from "./tree-parts";

/**
 * `ill-wheel-size-16` — option thumbnail (W2-T4c): a wheel drawn to scale, rim diameter 305 mm (ETRTO), wide tyre; the dashed circle is the 622 size.
 *
 * The distinguishing feature is drawn in the accent token. No callouts: the
 * option label under the card names the picture.
 */
export function IllWheelSize16(props: IllustrationProps) {
  return (
    <TreeIllustrationFrame id="ill-wheel-size-16" {...props}>
      <SizedWheel etrto={305} tire="wide" />
    </TreeIllustrationFrame>
  );
}
