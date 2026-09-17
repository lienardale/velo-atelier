import type { IllustrationProps } from "./placeholder";
import { TreeIllustrationFrame } from "./tree-frame";
import { Bike } from "./tree-parts";

/**
 * `ill-discipline-kids` — option thumbnail (W2-T4c): a small child's bike with a training wheel.
 *
 * The distinguishing feature is drawn in the accent token. No callouts: the
 * option label under the card names the picture.
 */
export function IllDisciplineKids(props: IllustrationProps) {
  return (
    <TreeIllustrationFrame id="ill-discipline-kids" {...props}>
      <Bike
        x={17}
        y={30}
        s={0.28}
        w={2.5}
        bar="flat"
        tire="wide"
        trainingWheel
        accent={["tires", "training-wheel"]}
      />
    </TreeIllustrationFrame>
  );
}
