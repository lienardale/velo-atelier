import type { IllustrationProps } from "./placeholder";
import { calloutCircle, calloutDigit, TreeIllustrationFrame } from "./tree-frame";
import { ComboPedal, FlatPedal, Leader, RoadPedal, SpdPedal, ToeClipPedal } from "./tree-parts";

/**
 * `ill-pedals` — help drawing (W2-T4c): the five pedal families — flat with pins, SPD with its two-bolt cleat, road with
 * its triangular cleat (from above), toe clips (from the side) and combo.
 *
 * Numbered callouts, one literal `data-callout` per
 * `illustrations.ill-pedals.callouts.<n>` key; the legend under the drawing reads
 * those keys.
 */
export function IllPedals(props: IllustrationProps) {
  return (
    <TreeIllustrationFrame id="ill-pedals" {...props}>
      <FlatPedal x={10} y={8} s={0.9} />
      <SpdPedal x={115} y={8} s={0.9} />
      <RoadPedal x={220} y={8} s={0.9} />
      <ToeClipPedal x={62} y={128} s={0.9} />
      <ComboPedal x={167} y={128} s={0.9} />
      <Leader from={[104, 18]} to={[86, 34]} />
      <circle data-callout="1" cx={104} cy={18} {...calloutCircle} />
      <text x={104} y={18} {...calloutDigit}>
        1
      </text>
      <Leader from={[206, 20]} to={[182, 18]} />
      <circle data-callout="2" cx={206} cy={20} {...calloutCircle} />
      <text x={206} y={20} {...calloutDigit}>
        2
      </text>
      <Leader from={[306, 100]} to={[296, 60]} />
      <circle data-callout="3" cx={306} cy={100} {...calloutCircle} />
      <text x={306} y={100} {...calloutDigit}>
        3
      </text>
      <Leader from={[150, 118]} to={[146, 148]} />
      <circle data-callout="4" cx={150} cy={118} {...calloutCircle} />
      <text x={150} y={118} {...calloutDigit}>
        4
      </text>
      <Leader from={[288, 216]} to={[244, 192]} />
      <circle data-callout="5" cx={288} cy={216} {...calloutCircle} />
      <text x={288} y={216} {...calloutDigit}>
        5
      </text>
    </TreeIllustrationFrame>
  );
}
