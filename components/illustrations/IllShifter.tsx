import type { IllustrationProps } from "./placeholder";
import { calloutCircle, calloutDigit, TreeIllustrationFrame } from "./tree-frame";
import {
  BarEndShifter,
  ElectronicShifter,
  GripShifter,
  Leader,
  StiShifter,
  ThumbShifter,
  TriggerShifter,
} from "./tree-parts";

/**
 * `ill-shifter` — help drawing (W2-T4c): the six shifter families side by side — integrated brake-shift lever, triggers,
 * twist grip, thumb lever, bar-end lever, electronic buttons.
 *
 * Numbered callouts, one literal `data-callout` per
 * `illustrations.ill-shifter.callouts.<n>` key; the legend under the drawing reads
 * those keys.
 */
export function IllShifter(props: IllustrationProps) {
  return (
    <TreeIllustrationFrame id="ill-shifter" {...props}>
      <StiShifter x={10} y={8} s={0.9} />
      <TriggerShifter x={115} y={8} s={0.9} />
      <GripShifter x={220} y={8} s={0.9} />
      <ThumbShifter x={10} y={128} s={0.9} />
      <BarEndShifter x={115} y={128} s={0.9} />
      <ElectronicShifter x={220} y={128} s={0.9} />
      <Leader from={[100, 104]} to={[82, 90]} />
      <circle data-callout="1" cx={100} cy={104} {...calloutCircle} />
      <text x={100} y={104} {...calloutDigit}>
        1
      </text>
      <Leader from={[130, 108]} to={[143, 84]} />
      <circle data-callout="2" cx={130} cy={108} {...calloutCircle} />
      <text x={130} y={108} {...calloutDigit}>
        2
      </text>
      <Leader from={[240, 104]} to={[270, 70]} />
      <circle data-callout="3" cx={240} cy={104} {...calloutCircle} />
      <text x={240} y={104} {...calloutDigit}>
        3
      </text>
      <Leader from={[20, 128]} to={[37, 150]} />
      <circle data-callout="4" cx={20} cy={128} {...calloutCircle} />
      <text x={20} y={128} {...calloutDigit}>
        4
      </text>
      <Leader from={[142, 226]} to={[122, 212]} />
      <circle data-callout="5" cx={142} cy={226} {...calloutCircle} />
      <text x={142} y={226} {...calloutDigit}>
        5
      </text>
      <Leader from={[256, 228]} to={[288, 190]} />
      <circle data-callout="6" cx={256} cy={228} {...calloutCircle} />
      <text x={256} y={228} {...calloutDigit}>
        6
      </text>
    </TreeIllustrationFrame>
  );
}
