import type { IllustrationProps } from "./placeholder";
import { calloutCircle, calloutDigit, TreeIllustrationFrame } from "./tree-frame";
import {
  CantileverBrake,
  DiscHydraulicBrake,
  DiscMechanicalBrake,
  Leader,
  RimCaliperBrake,
  VBrake,
} from "./tree-parts";

/**
 * `ill-brake-type` — help drawing (W2-T4c): the five brakes side by side — rim caliper, V-brake, cantilever (front view),
 * then a disc caliper pulled by a cable and one fed by a hydraulic hose.
 *
 * Numbered callouts, one literal `data-callout` per
 * `illustrations.ill-brake-type.callouts.<n>` key; the legend under the drawing reads
 * those keys.
 */
export function IllBrakeType(props: IllustrationProps) {
  return (
    <TreeIllustrationFrame id="ill-brake-type" {...props}>
      <RimCaliperBrake x={10} y={4} s={0.9} />
      <VBrake x={115} y={4} s={0.9} />
      <CantileverBrake x={220} y={4} s={0.9} />
      <DiscMechanicalBrake x={62} y={130} s={0.9} />
      <DiscHydraulicBrake x={167} y={130} s={0.9} />
      <Leader from={[20, 24]} to={[42, 38]} />
      <circle data-callout="1" cx={20} cy={24} {...calloutCircle} />
      <text x={20} y={24} {...calloutDigit}>
        1
      </text>
      <Leader from={[210, 20]} to={[180, 34]} />
      <circle data-callout="2" cx={210} cy={20} {...calloutCircle} />
      <text x={210} y={20} {...calloutDigit}>
        2
      </text>
      <Leader from={[308, 22]} to={[282, 46]} />
      <circle data-callout="3" cx={308} cy={22} {...calloutCircle} />
      <text x={308} y={22} {...calloutDigit}>
        3
      </text>
      <Leader from={[150, 112]} to={[142, 136]} />
      <circle data-callout="4" cx={150} cy={112} {...calloutCircle} />
      <text x={150} y={112} {...calloutDigit}>
        4
      </text>
      <Leader from={[268, 120]} to={[243, 148]} />
      <circle data-callout="5" cx={268} cy={120} {...calloutCircle} />
      <text x={268} y={120} {...calloutDigit}>
        5
      </text>
    </TreeIllustrationFrame>
  );
}
