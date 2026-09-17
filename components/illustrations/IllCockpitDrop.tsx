import type { IllustrationProps } from "./placeholder";
import { TreeIllustrationFrame } from "./tree-frame";
import { DropBar } from "./tree-parts";

/**
 * `ill-cockpit-drop` — option thumbnail (W2-T4c): a drop bar from the front, ends curling down.
 *
 * The distinguishing feature is drawn in the accent token. No callouts: the
 * option label under the card names the picture.
 */
export function IllCockpitDrop(props: IllustrationProps) {
  return (
    <TreeIllustrationFrame id="ill-cockpit-drop" {...props}>
      <DropBar x={10} y={10} w={3} />
    </TreeIllustrationFrame>
  );
}
