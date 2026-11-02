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
      <path d="M193 142.6 L158.5 57.3 M158.5 59 L308 66 M202.7 145.6 L308 76" />
      <path d="M158 65 L12 128 M188 149.4 L12 136" strokeOpacity={0.6} />
      {/* seatpost, rails and saddle, nose forward, clamped near mid-rail */}
      <path d="M158.5 57.3 L151 38.7" strokeWidth={4} />
      <path d="M132 39 L166 35" {...fine} />
      <path
        d="M121 24 Q124 18 136 20 L162 26 Q172 27 173 31 L162 34 Q146 35 136 37 Q124 37 121 30 Z"
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
      <path d="M173 32 V210" {...fine} />
      <path d="M167 210 H179 L173 224 Z" {...solid} />
      {/* setback: horizontal dimension, string to axle centre, below the pedal */}
      <path d="M196 192 V210" {...fine} strokeDasharray="3 3" />
      <path d="M173 204 H196 M178 200 L173 204 L178 208 M191 200 L196 204 L191 208" />

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
      <path d="M217 208 L199 205" {...leader} />
      <circle data-callout="3" cx={228} cy={211} r={11} />
      <text x={228} y={211} {...calloutText}>
        3
      </text>
    </GuideIllustrationFrame>
  );
}
