import type { IllustrationProps } from "./placeholder";
import { TreeIllustrationFrame } from "./tree-frame";
import { Bike } from "./tree-parts";

/**
 * `ill-discipline-mtb` — option thumbnail (W2-T4c): a mountain bike: riser bar, suspension fork, knobby tyres.
 *
 * The distinguishing feature is drawn in the accent token. No callouts: the
 * option label under the card names the picture.
 */
export function IllDisciplineMtb(props: IllustrationProps) {
  return (
    <TreeIllustrationFrame id="ill-discipline-mtb" {...props}>
      <Bike
        x={3}
        y={16}
        s={0.37}
        w={2.5}
        bar="riser"
        tire="knobby"
        fork="suspension"
        accent={["fork", "bar"]}
      />
    </TreeIllustrationFrame>
  );
}
