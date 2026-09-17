import type { IllustrationProps } from "./placeholder";
import { calloutCircle, calloutDigit, TreeIllustrationFrame } from "./tree-frame";
import { Bike, Leader } from "./tree-parts";

/**
 * `ill-discipline` — help drawing (W2-T4c): five bikes — road, gravel, mountain, city, kids — each with the detail the
 * help text tells the visitor to look at drawn in the accent colour.
 *
 * Numbered callouts, one literal `data-callout` per
 * `illustrations.ill-discipline.callouts.<n>` key; the legend under the drawing reads
 * those keys.
 */
export function IllDiscipline(props: IllustrationProps) {
  return (
    <TreeIllustrationFrame id="ill-discipline" {...props}>
      <Bike x={4} y={30} s={0.32} bar="drop" tire="thin" accent={["bar"]} />
      <Bike x={110} y={30} s={0.32} bar="drop" tire="knobby" accent={["tires"]} />
      <Bike x={216} y={30} s={0.32} bar="riser" tire="knobby" fork="suspension" accent={["fork"]} />
      <Bike
        x={57}
        y={140}
        s={0.32}
        bar="swept"
        tire="wide"
        frame="step"
        mudguards
        rack
        accent={["mudguards", "rack"]}
      />
      <Bike x={176} y={160} s={0.22} bar="flat" tire="wide" trainingWheel accent={["tires"]} />
      <Leader from={[96, 22]} to={[81, 48]} />
      <circle data-callout="1" cx={96} cy={22} {...calloutCircle} />
      <text x={96} y={22} {...calloutDigit}>
        1
      </text>
      <Leader from={[212, 104]} to={[197, 88]} />
      <circle data-callout="2" cx={212} cy={104} {...calloutCircle} />
      <text x={212} y={104} {...calloutDigit}>
        2
      </text>
      <Leader from={[304, 22]} to={[288, 62]} />
      <circle data-callout="3" cx={304} cy={22} {...calloutCircle} />
      <text x={304} y={22} {...calloutDigit}>
        3
      </text>
      <Leader from={[40, 140]} to={[70, 158]} />
      <circle data-callout="4" cx={40} cy={140} {...calloutCircle} />
      <text x={40} y={140} {...calloutDigit}>
        4
      </text>
      <Leader from={[170, 228]} to={[184, 214]} />
      <circle data-callout="5" cx={170} cy={228} {...calloutCircle} />
      <text x={170} y={228} {...calloutDigit}>
        5
      </text>
    </TreeIllustrationFrame>
  );
}
