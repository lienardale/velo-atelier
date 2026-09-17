import type { IllustrationProps } from "./placeholder";
import { calloutCircle, calloutDigit, TreeIllustrationFrame } from "./tree-frame";
import { Bike, Leader } from "./tree-parts";

/**
 * `ill-e-battery` — help drawing (W2-T4c): three electric bikes: battery hidden in the down tube behind a lock, battery
 * block bolted onto the down tube, battery on the rear rack.
 *
 * Numbered callouts, one literal `data-callout` per
 * `illustrations.ill-e-battery.callouts.<n>` key; the legend under the drawing reads
 * those keys.
 */
export function IllEBattery(props: IllustrationProps) {
  return (
    <TreeIllustrationFrame id="ill-e-battery" {...props}>
      <Bike
        x={4}
        y={2}
        s={0.5}
        bar="flat"
        tire="wide"
        battery="integrated"
        motor="mid"
        accent={["battery"]}
      />
      <Bike
        x={166}
        y={2}
        s={0.5}
        bar="flat"
        tire="wide"
        battery="external"
        motor="mid"
        accent={["battery"]}
      />
      <Bike
        x={87}
        y={118}
        s={0.5}
        bar="swept"
        tire="wide"
        frame="step"
        rack
        battery="rack"
        motor="hub"
        accent={["battery"]}
      />
      <Leader from={[150, 20]} to={[100, 58]} />
      <circle data-callout="1" cx={150} cy={20} {...calloutCircle} />
      <text x={150} y={20} {...calloutDigit}>
        1
      </text>
      <Leader from={[306, 20]} to={[262, 50]} />
      <circle data-callout="2" cx={306} cy={20} {...calloutCircle} />
      <text x={306} y={20} {...calloutDigit}>
        2
      </text>
      <Leader from={[60, 140]} to={[108, 144]} />
      <circle data-callout="3" cx={60} cy={140} {...calloutCircle} />
      <text x={60} y={140} {...calloutDigit}>
        3
      </text>
    </TreeIllustrationFrame>
  );
}
