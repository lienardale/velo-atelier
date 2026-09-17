import type { IllustrationProps } from "./placeholder";
import {
  ACCENT,
  calloutCircle,
  calloutDigit,
  FAINT,
  partNumber,
  TreeIllustrationFrame,
} from "./tree-frame";
import { Leader } from "./tree-parts";

/**
 * `ill-wheel-size` — help drawing (W2-T4c): a close-up of a tyre sidewall carrying the ETRTO marking 40-622, with the rim
 * diameter (622) circled.
 *
 * Numbered callouts, one literal `data-callout` per
 * `illustrations.ill-wheel-size.callouts.<n>` key; the legend under the drawing reads
 * those keys.
 */
export function IllWheelSize(props: IllustrationProps) {
  return (
    <TreeIllustrationFrame id="ill-wheel-size" {...props}>
      <circle cx={160} cy={360} r={300} />
      <circle cx={160} cy={360} r={262} />
      <circle cx={160} cy={360} r={248} {...FAINT} />
      <path d="M100 150 L80 240 M160 136 V240 M220 150 L240 240" {...FAINT} />
      <text x={160} y={80} fontSize={18} fontWeight={600} {...partNumber}>
        40-622
      </text>
      <rect x={161} y={68} width={37} height={24} rx={12} {...ACCENT} />
      <Leader from={[50, 40]} to={[88, 86]} />
      <circle data-callout="1" cx={50} cy={40} {...calloutCircle} />
      <text x={50} y={40} {...calloutDigit}>
        1
      </text>
      <Leader from={[120, 34]} to={[136, 70]} />
      <circle data-callout="2" cx={120} cy={34} {...calloutCircle} />
      <text x={120} y={34} {...calloutDigit}>
        2
      </text>
      <Leader from={[236, 34]} to={[198, 72]} />
      <circle data-callout="3" cx={236} cy={34} {...calloutCircle} />
      <text x={236} y={34} {...calloutDigit}>
        3
      </text>
    </TreeIllustrationFrame>
  );
}
