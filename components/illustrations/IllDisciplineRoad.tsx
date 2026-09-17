import type { IllustrationProps } from "./placeholder";
import { TreeIllustrationFrame } from "./tree-frame";
import { Bike } from "./tree-parts";

/**
 * `ill-discipline-road` — option thumbnail (W2-T4c): a road bike: drop bar and thin tyres.
 *
 * The distinguishing feature is drawn in the accent token. No callouts: the
 * option label under the card names the picture.
 */
export function IllDisciplineRoad(props: IllustrationProps) {
  return (
    <TreeIllustrationFrame id="ill-discipline-road" {...props}>
      <Bike x={3} y={16} s={0.37} w={2.5} bar="drop" tire="thin" accent={["bar", "tires"]} />
    </TreeIllustrationFrame>
  );
}
