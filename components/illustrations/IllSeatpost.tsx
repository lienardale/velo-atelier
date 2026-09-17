import type { IllustrationProps } from "./placeholder";
import {
  ACCENT,
  ACCENT_MASK,
  calloutCircle,
  calloutDigit,
  MASK,
  TreeIllustrationFrame,
} from "./tree-frame";
import { Leader } from "./tree-parts";

/**
 * `ill-seatpost` — help drawing (W2-T4c): a dropper post close up — its sliding upper part, the cable running into the
 * frame and the remote lever on the bar — next to the seat clamp, which is all a
 * rigid post has.
 *
 * Numbered callouts, one literal `data-callout` per
 * `illustrations.ill-seatpost.callouts.<n>` key; the legend under the drawing reads
 * those keys.
 */
export function IllSeatpost(props: IllustrationProps) {
  return (
    <TreeIllustrationFrame id="ill-seatpost" {...props}>
      <path d="M60 40 Q112 26 170 46 M96 48 H132" />
      <path d="M100 240 V150 M124 240 V150" />
      <path d="M104 142 V98 M120 142 V98" />
      <path d="M108 90 V48 M116 90 V48" {...ACCENT} />
      <rect x={102} y={90} width={20} height={8} rx={2} {...ACCENT_MASK} />
      <rect x={96} y={142} width={32} height={12} rx={3} {...MASK} />
      <path d="M128 148 H138" />
      <path d="M200 60 H316" />
      <rect x={272} y={52} width={44} height={16} rx={6} {...MASK} />
      <rect x={196} y={48} width={16} height={24} rx={3} {...MASK} />
      <g {...ACCENT}>
        <path d="M262 60 L250 80" />
        <circle cx={248} cy={82} r={4} {...ACCENT_MASK} />
        <path d="M262 62 C240 140 160 200 124 200" />
      </g>
      <Leader from={[226, 104]} to={[246, 86]} />
      <circle data-callout="1" cx={226} cy={104} {...calloutCircle} />
      <text x={226} y={104} {...calloutDigit}>
        1
      </text>
      <Leader from={[226, 190]} to={[184, 174]} />
      <circle data-callout="2" cx={226} cy={190} {...calloutCircle} />
      <text x={226} y={190} {...calloutDigit}>
        2
      </text>
      <Leader from={[60, 94]} to={[100, 94]} />
      <circle data-callout="3" cx={60} cy={94} {...calloutCircle} />
      <text x={60} y={94} {...calloutDigit}>
        3
      </text>
      <Leader from={[60, 150]} to={[94, 148]} />
      <circle data-callout="4" cx={60} cy={150} {...calloutCircle} />
      <text x={60} y={150} {...calloutDigit}>
        4
      </text>
    </TreeIllustrationFrame>
  );
}
