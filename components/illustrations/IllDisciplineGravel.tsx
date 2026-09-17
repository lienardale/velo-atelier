import type { IllustrationProps } from "./placeholder";
import { TreeIllustrationFrame } from "./tree-frame";
import { Bike } from "./tree-parts";

/**
 * `ill-discipline-gravel` — option thumbnail (W2-T4c): a gravel bike: drop bar and wide knobby tyres.
 *
 * The distinguishing feature is drawn in the accent token. No callouts: the
 * option label under the card names the picture.
 */
export function IllDisciplineGravel(props: IllustrationProps) {
  return (
    <TreeIllustrationFrame id="ill-discipline-gravel" {...props}>
      <Bike x={3} y={16} s={0.37} w={2.5} bar="drop" tire="knobby" accent={["bar", "tires"]} />
    </TreeIllustrationFrame>
  );
}
