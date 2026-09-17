import type { IllustrationProps } from "./placeholder";
import {
  ACCENT,
  calloutCircle,
  calloutDigit,
  FAINT,
  MASK,
  partNumber,
  TreeIllustrationFrame,
} from "./tree-frame";
import { Leader } from "./tree-parts";

/**
 * `ill-speeds` — help drawing (W2-T4c): a cassette seen from behind with its eleven sprockets numbered, and a shifter
 * whose window shows the number of speeds.
 *
 * Numbered callouts, one literal `data-callout` per
 * `illustrations.ill-speeds.callouts.<n>` key; the legend under the drawing reads
 * those keys.
 */
export function IllSpeeds(props: IllustrationProps) {
  return (
    <TreeIllustrationFrame id="ill-speeds" {...props}>
      <path d="M20 130 H200" {...FAINT} />
      {Array.from({ length: 11 }, (_, i) => (
        <g key={i}>
          <rect
            x={32 + i * 14}
            y={130 - (150 - i * 10) / 2}
            width={8}
            height={150 - i * 10}
            rx={4}
            {...ACCENT}
          />
          <text x={36 + i * 14} y={130 - (150 - i * 10) / 2 - 10} fontSize={9} {...partNumber}>
            {i + 1}
          </text>
        </g>
      ))}
      <path d="M204 176 H316" {...FAINT} />
      <path d="M236 150 V176 M288 150 V176" />
      <rect x={220} y={90} width={84} height={60} rx={10} {...MASK} />
      <rect x={240} y={104} width={44} height={28} rx={4} {...ACCENT} />
      <text x={262} y={118} fontSize={16} fontWeight={600} {...partNumber}>
        11
      </text>
      <Leader from={[18, 222]} to={[32, 204]} />
      <circle data-callout="1" cx={18} cy={222} {...calloutCircle} />
      <text x={18} y={222} {...calloutDigit}>
        1
      </text>
      <Leader from={[300, 62]} to={[284, 102]} />
      <circle data-callout="2" cx={300} cy={62} {...calloutCircle} />
      <text x={300} y={62} {...calloutDigit}>
        2
      </text>
    </TreeIllustrationFrame>
  );
}
