import type { IllustrationProps } from "./placeholder";
import {
  ACCENT,
  calloutCircle,
  calloutDigit,
  FAINT,
  MASK,
  TreeIllustrationFrame,
} from "./tree-frame";
import { Arrow, Leader } from "./tree-parts";

/**
 * `ill-tire-system` — help drawing (W2-T4c): a tubeless set-up: the tyre in cross-section on its rim with sealant inside,
 * and a valve whose removable core has been pulled out.
 *
 * Numbered callouts, one literal `data-callout` per
 * `illustrations.ill-tire-system.callouts.<n>` key; the legend under the drawing reads
 * those keys.
 */
export function IllTireSystem(props: IllustrationProps) {
  return (
    <TreeIllustrationFrame id="ill-tire-system" {...props}>
      <path d="M60 150 C20 120 30 30 110 30 C190 30 200 120 160 150" />
      <path d="M34 108 Q30 76 50 54" strokeDasharray="2 5" {...ACCENT} />
      <path d="M52 150 V196 Q52 212 68 212 H152 Q168 212 168 196 V150 M52 150 H64 M156 150 H168" />
      <path d="M64 150 V178 Q64 190 76 190 H144 Q156 190 156 178 V150" {...FAINT} />
      <g {...ACCENT}>
        <path d="M70 150 Q90 140 110 145 Q130 150 150 144" />
        <path d="M50 126 Q46 136 54 142 M170 126 Q174 136 166 142" />
      </g>
      <path d="M244 214 V120 M256 214 V120" />
      <rect x={236} y={176} width={28} height={10} rx={2} {...MASK} />
      <rect x={232} y={214} width={36} height={10} rx={3} />
      <g {...ACCENT}>
        <path d="M250 104 V60" />
        <rect x={244} y={78} width={12} height={22} rx={2} {...MASK} />
        <path d="M245 56 H255 V46 H245 Z" />
      </g>
      <Arrow x1={278} y1={124} x2={278} y2={84} />
      <Leader from={[296, 56]} to={[258, 76]} />
      <circle data-callout="1" cx={296} cy={56} {...calloutCircle} />
      <text x={296} y={56} {...calloutDigit}>
        1
      </text>
      <Leader from={[110, 228]} to={[110, 150]} />
      <circle data-callout="2" cx={110} cy={228} {...calloutCircle} />
      <text x={110} y={228} {...calloutDigit}>
        2
      </text>
      <Leader from={[22, 40]} to={[36, 90]} />
      <circle data-callout="3" cx={22} cy={40} {...calloutCircle} />
      <text x={22} y={40} {...calloutDigit}>
        3
      </text>
    </TreeIllustrationFrame>
  );
}
