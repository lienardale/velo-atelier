import type { IllustrationProps } from "./placeholder";
import {
  ACCENT,
  ACCENT_MASK,
  calloutCircle,
  calloutDigit,
  FAINT,
  MASK,
  TreeIllustrationFrame,
} from "./tree-frame";
import { Leader } from "./tree-parts";

/**
 * `ill-e-motor` — help drawing (W2-T4c): on the left a mid-drive motor: a large angular housing around the crank axle;
 * on the right a hub motor: a very fat rear hub with a cable coming out.
 *
 * Numbered callouts, one literal `data-callout` per
 * `illustrations.ill-e-motor.callouts.<n>` key; the legend under the drawing reads
 * those keys.
 */
export function IllEMotor(props: IllustrationProps) {
  return (
    <TreeIllustrationFrame id="ill-e-motor" {...props}>
      <path d="M144 36 L88 124 M156 44 L100 132 M52 20 L70 124 M64 18 L82 122 M70 150 L0 160" />
      <path d="M44 112 H112 L128 132 V160 L108 184 H56 L36 164 V128 Z" {...ACCENT_MASK} />
      <circle cx={80} cy={146} r={22} strokeDasharray="3 2" {...MASK} />
      <path d="M80 146 L104 204 M96 204 H118" />
      <circle cx={80} cy={146} r={4} />
      <circle cx={250} cy={130} r={90} />
      {Array.from({ length: 10 }, (_, i) => {
        const rad = (i * 36 * Math.PI) / 180;
        return (
          <path
            key={i}
            d={`M${(250 + 26 * Math.cos(rad)).toFixed(1)} ${(130 + 26 * Math.sin(rad)).toFixed(1)} L${(250 + 86 * Math.cos(rad)).toFixed(1)} ${(130 + 86 * Math.sin(rad)).toFixed(1)}`}
            {...FAINT}
          />
        );
      })}
      <circle cx={250} cy={130} r={26} {...ACCENT_MASK} />
      <circle cx={250} cy={130} r={4} />
      <path d="M268 112 Q296 88 308 40" {...ACCENT} />
      <Leader from={[24, 40]} to={[48, 110]} />
      <circle data-callout="1" cx={24} cy={40} {...calloutCircle} />
      <text x={24} y={40} {...calloutDigit}>
        1
      </text>
      <Leader from={[190, 222]} to={[234, 152]} />
      <circle data-callout="2" cx={190} cy={222} {...calloutCircle} />
      <text x={190} y={222} {...calloutDigit}>
        2
      </text>
      <Leader from={[282, 22]} to={[300, 58]} />
      <circle data-callout="3" cx={282} cy={22} {...calloutCircle} />
      <text x={282} y={22} {...calloutDigit}>
        3
      </text>
    </TreeIllustrationFrame>
  );
}
