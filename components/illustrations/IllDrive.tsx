import type { IllustrationProps } from "./placeholder";
import { calloutCircle, calloutDigit, FAINT, TreeIllustrationFrame } from "./tree-frame";
import { Bike, GearHub, Leader } from "./tree-parts";

/**
 * `ill-drive` — help drawing (W2-T4c): an electric bike with a battery on the down tube and a motor around the bottom
 * bracket; inset, the other motor position: a fat rear hub with its cable.
 *
 * Numbered callouts, one literal `data-callout` per
 * `illustrations.ill-drive.callouts.<n>` key; the legend under the drawing reads
 * those keys.
 */
export function IllDrive(props: IllustrationProps) {
  return (
    <TreeIllustrationFrame id="ill-drive" {...props}>
      <Bike
        x={6}
        y={40}
        s={0.9}
        bar="flat"
        tire="wide"
        battery="external"
        motor="mid"
        accent={["battery", "motor"]}
      />
      <rect x={212} y={4} width={104} height={76} rx={8} {...FAINT} />
      <GearHub x={234} y={8} s={0.66} />
      <Leader from={[150, 112]} to={[163, 132]} />
      <circle data-callout="1" cx={150} cy={112} {...calloutCircle} />
      <text x={150} y={112} {...calloutDigit}>
        1
      </text>
      <Leader from={[96, 224]} to={[122, 180]} />
      <circle data-callout="2" cx={96} cy={224} {...calloutCircle} />
      <text x={96} y={224} {...calloutDigit}>
        2
      </text>
      <Leader from={[228, 20]} to={[255, 36]} />
      <circle data-callout="3" cx={228} cy={20} {...calloutCircle} />
      <text x={228} y={20} {...calloutDigit}>
        3
      </text>
    </TreeIllustrationFrame>
  );
}
