import { calloutText, GuideIllustrationFrame } from "./guide-frame";
import { fine, leader, solid, tint } from "./guide-shapes";
import type { IllustrationProps } from "./placeholder";

/**
 * `sag-measure-oring` — one fork leg: the stanchion sliding into the lower
 * leg, the O-ring pushed up the stanchion by the sag, the travel scale printed
 * on the stanchion, and the distance between seal and O-ring to measure.
 */
export function IllSagMeasureOring(props: IllustrationProps) {
  return (
    <GuideIllustrationFrame id="sag-measure-oring" placeholder={false} {...props}>
      {/* stanchion */}
      <rect x={144} y={16} width={32} height={112} />
      {/* lower leg and seal */}
      <path d="M130 128 H190 V222 Q160 234 130 222 Z" {...tint} />
      <rect x={136} y={120} width={48} height={10} rx={3} {...solid} />
      {/* travel scale */}
      <path
        d="M166 30 H176 M170 42 H176 M166 54 H176 M170 66 H176 M166 78 H176 M170 90 H176 M166 102 H176 M170 114 H176"
        {...fine}
      />
      {/* O-ring pushed up by the sag */}
      <ellipse cx={160} cy={76} rx={20} ry={5} strokeWidth={3} />
      {/* measured distance */}
      <path d="M112 80 V118 M106 80 H118 M106 118 H118" {...fine} />

      <path d="M69 60 L139 74" {...leader} />
      <circle data-callout="1" cx={58} cy={58} r={11} />
      <text x={58} y={58} {...calloutText}>
        1
      </text>
      <path d="M251 48 L178 54" {...leader} />
      <circle data-callout="2" cx={262} cy={46} r={11} />
      <text x={262} y={46} {...calloutText}>
        2
      </text>
    </GuideIllustrationFrame>
  );
}
