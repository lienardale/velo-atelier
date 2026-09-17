import type { IllustrationProps } from "./placeholder";
import { calloutCircle, calloutDigit, TreeIllustrationFrame } from "./tree-frame";
import { DropBar, FlatBar, Leader, RiserBar, SweptBar } from "./tree-parts";

/**
 * `ill-cockpit` — help drawing (W2-T4c): the four bar shapes — drop, flat and riser seen from the front, swept-back
 * seen from above.
 *
 * Numbered callouts, one literal `data-callout` per
 * `illustrations.ill-cockpit.callouts.<n>` key; the legend under the drawing reads
 * those keys.
 */
export function IllCockpit(props: IllustrationProps) {
  return (
    <TreeIllustrationFrame id="ill-cockpit" {...props}>
      <DropBar x={40} y={8} />
      <FlatBar x={180} y={8} />
      <RiserBar x={40} y={128} />
      <SweptBar x={180} y={128} />
      <Leader from={[158, 64]} to={[138, 80]} />
      <circle data-callout="1" cx={158} cy={64} {...calloutCircle} />
      <text x={158} y={64} {...calloutDigit}>
        1
      </text>
      <Leader from={[296, 30]} to={[278, 50]} />
      <circle data-callout="2" cx={296} cy={30} {...calloutCircle} />
      <text x={296} y={30} {...calloutDigit}>
        2
      </text>
      <Leader from={[158, 136]} to={[136, 148]} />
      <circle data-callout="3" cx={158} cy={136} {...calloutCircle} />
      <text x={158} y={136} {...calloutDigit}>
        3
      </text>
      <Leader from={[300, 180]} to={[272, 198]} />
      <circle data-callout="4" cx={300} cy={180} {...calloutCircle} />
      <text x={300} y={180} {...calloutDigit}>
        4
      </text>
    </TreeIllustrationFrame>
  );
}
