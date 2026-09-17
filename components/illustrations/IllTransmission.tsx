import type { IllustrationProps } from "./placeholder";
import {
  ACCENT,
  ACCENT_MASK,
  calloutCircle,
  calloutDigit,
  TreeIllustrationFrame,
} from "./tree-frame";

/**
 * `ill-transmission` — help drawing (W2-T4c): a chain above a toothed belt, and below them a right chainstay split by the
 * bolted joint a belt needs to pass through the frame.
 *
 * Numbered callouts, one literal `data-callout` per
 * `illustrations.ill-transmission.callouts.<n>` key; the legend under the drawing reads
 * those keys.
 */
export function IllTransmission(props: IllustrationProps) {
  return (
    <TreeIllustrationFrame id="ill-transmission" {...props}>
      {[0, 1, 2, 3, 4, 5].map((i) => (
        <rect key={`outer-${i}`} x={24 + i * 44} y={36} width={52} height={28} rx={14} />
      ))}
      {[0, 1, 2, 3, 4].map((i) => (
        <rect key={`inner-${i}`} x={50 + i * 44} y={40} width={44} height={20} rx={10} />
      ))}
      {[0, 1, 2, 3, 4, 5].map((i) => (
        <circle key={`pin-${i}`} cx={38 + i * 44} cy={50} r={4} />
      ))}
      <g {...ACCENT}>
        <rect x={24} y={100} width={272} height={20} rx={10} />
        {Array.from({ length: 17 }, (_, i) => (
          <path key={`tooth-${i}`} d={`M${32 + i * 16} 120 v6 h8 v-6`} />
        ))}
      </g>
      <path d="M24 176 H142 M24 200 H142 M178 176 H296 M178 200 H296" />
      <g {...ACCENT}>
        <rect x={138} y={168} width={44} height={40} rx={5} {...ACCENT_MASK} />
        <path d="M160 168 V208" strokeDasharray="3 3" />
        <circle cx={150} cy={188} r={4} />
        <circle cx={170} cy={188} r={4} />
      </g>
      <circle data-callout="1" cx={12} cy={50} {...calloutCircle} />
      <text x={12} y={50} {...calloutDigit}>
        1
      </text>
      <circle data-callout="2" cx={12} cy={110} {...calloutCircle} />
      <text x={12} y={110} {...calloutDigit}>
        2
      </text>
      <circle data-callout="3" cx={12} cy={188} {...calloutCircle} />
      <text x={12} y={188} {...calloutDigit}>
        3
      </text>
    </TreeIllustrationFrame>
  );
}
