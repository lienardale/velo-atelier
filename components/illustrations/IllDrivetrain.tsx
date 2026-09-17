import type { IllustrationProps } from "./placeholder";
import { calloutCircle, calloutDigit, TreeIllustrationFrame } from "./tree-frame";
import { Crankset, GearHub, Leader, SingleSpeed } from "./tree-parts";

/**
 * `ill-drivetrain` — help drawing (W2-T4c): cranksets with one, two and three chainrings, an internal-gear hub with its
 * single sprocket, and a single-speed drivetrain.
 *
 * Numbered callouts, one literal `data-callout` per
 * `illustrations.ill-drivetrain.callouts.<n>` key; the legend under the drawing reads
 * those keys.
 */
export function IllDrivetrain(props: IllustrationProps) {
  return (
    <TreeIllustrationFrame id="ill-drivetrain" {...props}>
      <Crankset x={10} y={10} s={0.9} rings={1} />
      <Crankset x={115} y={10} s={0.9} rings={2} frontDerailleur />
      <Crankset x={220} y={10} s={0.9} rings={3} frontDerailleur />
      <GearHub x={62} y={130} s={0.9} />
      <SingleSpeed x={167} y={130} s={0.9} />
      <Leader from={[14, 24]} to={[24, 50]} />
      <circle data-callout="1" cx={14} cy={24} {...calloutCircle} />
      <text x={14} y={24} {...calloutDigit}>
        1
      </text>
      <Leader from={[116, 24]} to={[126, 50]} />
      <circle data-callout="2" cx={116} cy={24} {...calloutCircle} />
      <text x={116} y={24} {...calloutDigit}>
        2
      </text>
      <Leader from={[222, 18]} to={[231, 48]} />
      <circle data-callout="3" cx={222} cy={18} {...calloutCircle} />
      <text x={222} y={18} {...calloutDigit}>
        3
      </text>
      <Leader from={[40, 130]} to={[95, 165]} />
      <circle data-callout="4" cx={40} cy={130} {...calloutCircle} />
      <text x={40} y={130} {...calloutDigit}>
        4
      </text>
      <Leader from={[292, 140]} to={[250, 176]} />
      <circle data-callout="5" cx={292} cy={140} {...calloutCircle} />
      <text x={292} y={140} {...calloutDigit}>
        5
      </text>
    </TreeIllustrationFrame>
  );
}
