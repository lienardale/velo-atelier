import type { IllustrationProps } from "./placeholder";
import { TreeIllustrationFrame } from "./tree-frame";
import { Bike } from "./tree-parts";

/**
 * `ill-discipline-city-hybrid` — option thumbnail (W2-T4c): a city bike: step-through frame, mudguards and rack.
 *
 * The distinguishing feature is drawn in the accent token. No callouts: the
 * option label under the card names the picture.
 */
export function IllDisciplineCityHybrid(props: IllustrationProps) {
  return (
    <TreeIllustrationFrame id="ill-discipline-city-hybrid" {...props}>
      <Bike
        x={3}
        y={16}
        s={0.37}
        w={2.5}
        bar="swept"
        tire="wide"
        frame="step"
        mudguards
        rack
        accent={["mudguards", "rack"]}
      />
    </TreeIllustrationFrame>
  );
}
