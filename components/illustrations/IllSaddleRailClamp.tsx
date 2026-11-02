import { calloutText, GuideIllustrationFrame } from "./guide-frame";
import { fine, leader, solid, tint } from "./guide-shapes";
import type { IllustrationProps } from "./placeholder";

/**
 * `saddle-rail-clamp` — a saddle seen from the side, nose to the left, on its
 * seatpost: the shell, one rail running under it from the nose to the back,
 * the two-bolt seatpost clamp gripping the rail, and the marked zone printed
 * on the rail, its two ends bolder, between which the clamp must sit.
 */
export function IllSaddleRailClamp(props: IllustrationProps) {
  return (
    <GuideIllustrationFrame id="saddle-rail-clamp" placeholder={false} {...props}>
      {/* shell and padding */}
      <path
        d="M18 88 Q22 78 56 76 Q120 72 170 70 Q236 66 268 54 Q292 46 300 56 Q304 72 288 80 Q232 86 160 90 Q90 92 34 94 Q18 95 18 88 Z"
        {...tint}
      />
      {/* rail, from the nose under the shell to the back */}
      <path d="M46 93 Q68 120 96 120 H216 Q250 120 270 81" strokeWidth={3} />
      {/* marked zone printed on the rail: bold ends, fine scale between */}
      <path d="M104 112 V128 M214 112 V128" strokeWidth={2.5} />
      <path
        d="M112 115 V125 M120 115 V125 M128 115 V125 M190 115 V125 M198 115 V125 M206 115 V125"
        {...fine}
      />
      {/* seatpost and its clamp: cradle below the rail, plate above, two bolts */}
      <path d="M150 134 L130 226 M170 134 L150 226" />
      <path d="M136 122 H184 L180 134 H140 Z" {...solid} />
      <rect x={138} y={108} width={44} height={9} rx={2} {...solid} />
      <path d="M146 102 V138 M174 102 V138" strokeWidth={3} />
      <path d="M141 102 H151 M169 102 H179" strokeWidth={3} />

      <path d="M278 126 L250 108" {...leader} />
      <circle data-callout="1" cx={288} cy={129} r={11} />
      <text x={288} y={129} {...calloutText}>
        1
      </text>
      <path d="M210 168 L180 136" {...leader} />
      <circle data-callout="2" cx={219} cy={177} r={11} />
      <text x={219} y={177} {...calloutText}>
        2
      </text>
      <path d="M76 157 L102 129" {...leader} />
      <circle data-callout="3" cx={70} cy={166} r={11} />
      <text x={70} y={166} {...calloutText}>
        3
      </text>
    </GuideIllustrationFrame>
  );
}
