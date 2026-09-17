import type { IllustrationProps } from "./placeholder";
import { calloutCircle, calloutDigit, TreeIllustrationFrame } from "./tree-frame";
import { Bike, Leader } from "./tree-parts";

/**
 * `ill-suspension` — help drawing (W2-T4c): a full-suspension mountain bike: the telescopic fork and the rear shock between
 * the seat tube and the rear triangle.
 *
 * Numbered callouts, one literal `data-callout` per
 * `illustrations.ill-suspension.callouts.<n>` key; the legend under the drawing reads
 * those keys.
 */
export function IllSuspension(props: IllustrationProps) {
  return (
    <TreeIllustrationFrame id="ill-suspension" {...props}>
      <Bike
        x={6}
        y={24}
        s={0.95}
        bar="riser"
        tire="knobby"
        fork="suspension"
        rearShock
        accent={["fork", "shock"]}
      />
      <Leader from={[296, 70]} to={[228, 120]} />
      <circle data-callout="1" cx={296} cy={70} {...calloutCircle} />
      <text x={296} y={70} {...calloutDigit}>
        1
      </text>
      <Leader from={[80, 40]} to={[112, 112]} />
      <circle data-callout="2" cx={80} cy={40} {...calloutCircle} />
      <text x={80} y={40} {...calloutDigit}>
        2
      </text>
    </TreeIllustrationFrame>
  );
}
