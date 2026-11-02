import { calloutText, GuideIllustrationFrame } from "./guide-frame";
import { fine, leader, solid, tint } from "./guide-shapes";
import type { IllustrationProps } from "./placeholder";

/**
 * `saddle-setback-plumb-line` — the middle of a bike seen from the side, front
 * to the right, cranks vertical: a weighted string hangs from the saddle nose
 * past the crankset, the centre of the bottom bracket axle is marked, and the
 * setback is the horizontal distance between the two, dimensioned below.
 */
export function IllSaddleSetbackPlumbLine(props: IllustrationProps) {
  return (
    <GuideIllustrationFrame id="saddle-setback-plumb-line" placeholder={false} {...props}>
      {/* frame: seat tube, top tube, down tube, seat stay, chainstay */}
      <path d="M193.7 142.4 L166.8 54.4 M166.8 56 L308 64 M202.7 145.6 L308 76" />
      <path d="M166 62 L12 128 M188 149.4 L12 136" strokeOpacity={0.6} />
      {/* seatpost, rails and saddle, nose forward */}
      <path d="M166.8 54.4 L161.5 37" strokeWidth={4} />
      <path d="M124 39 L166 35" {...fine} />
      <path
        d="M106 24 Q110 17 124 19 L162 26 Q172 27 173 31 L162 34 Q140 35 124 37 Q110 37 106 30 Z"
        {...tint}
      />
      {/* chainring, bottom bracket and both cranks vertical */}
      <circle cx={196} cy={150} r={26} {...fine} />
      <circle cx={196} cy={150} r={8} />
      <path d="M196 116 V140 M196 160 V184" strokeWidth={4} />
      <rect x={186} y={112} width={20} height={5} rx={2} {...solid} />
      <rect x={186} y={184} width={20} height={5} rx={2} {...solid} />
      <path d="M196 150h0" strokeWidth={5} />
      {/* plumb line from the saddle nose, its weight below */}
      <path d="M173 32 V204" {...fine} />
      <path d="M167 204 H179 L173 218 Z" {...solid} />
      {/* setback: horizontal dimension, string to axle centre */}
      <path d="M196 192 V204" {...fine} strokeDasharray="3 3" />
      <path d="M173 198 H196 M177 194 L173 198 L177 202 M192 194 L196 198 L192 202" {...fine} />

      <path d="M216 30 L177 41" {...leader} />
      <circle data-callout="1" cx={227} cy={28} r={11} />
      <text x={227} y={28} {...calloutText}>
        1
      </text>
      <path d="M252 171 L202 153" {...leader} />
      <circle data-callout="2" cx={263} cy={175} r={11} />
      <text x={263} y={175} {...calloutText}>
        2
      </text>
      <path d="M207 209 L188 201" {...leader} />
      <circle data-callout="3" cx={216} cy={217} r={11} />
      <text x={216} y={217} {...calloutText}>
        3
      </text>
    </GuideIllustrationFrame>
  );
}
