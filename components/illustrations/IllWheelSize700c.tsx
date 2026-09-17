import type { IllustrationProps } from "./placeholder";
import { TreeIllustrationFrame } from "./tree-frame";
import { SizedWheel } from "./tree-parts";

/**
 * `ill-wheel-size-700c` — option thumbnail (W2-T4c): a wheel drawn to scale, rim diameter 622 mm (ETRTO), thin tyre; the dashed circle is the 622 size.
 *
 * The distinguishing feature is drawn in the accent token. No callouts: the
 * option label under the card names the picture.
 */
export function IllWheelSize700c(props: IllustrationProps) {
  return (
    <TreeIllustrationFrame id="ill-wheel-size-700c" {...props}>
      <SizedWheel etrto={622} tire="thin" />
    </TreeIllustrationFrame>
  );
}
