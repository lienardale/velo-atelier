import { calloutText, GuideIllustrationFrame } from "./guide-frame";
import { fine, leader, tint } from "./guide-shapes";
import type { IllustrationProps } from "./placeholder";

/**
 * `frame-inspection-points` — a bare diamond frame seen from the side, the
 * front to the right, with the four areas to look at closely once it is dry:
 * the joints at the head tube, the bottom bracket shell and the roots of the
 * chainstays, the seat cluster, and the rear dropouts.
 */
export function IllFrameInspectionPoints(props: IllustrationProps) {
  return (
    <GuideIllustrationFrame id="frame-inspection-points" placeholder={false} {...props}>
      {/* areas to inspect */}
      <circle cx={256} cy={92} r={30} {...fine} {...tint} strokeDasharray="5 4" />
      <circle cx={134} cy={172} r={26} {...fine} {...tint} strokeDasharray="5 4" />
      <circle cx={125} cy={76} r={21} {...fine} {...tint} strokeDasharray="5 4" />
      <circle cx={46} cy={166} r={20} {...fine} {...tint} strokeDasharray="5 4" />
      {/* tubes: seat tube, top tube, down tube, stays */}
      <path d="M140.4 166.1 L123 60" strokeWidth={4} />
      <path d="M126 76 L248 76 M150.4 170.6 L254 105" strokeWidth={4} />
      <path d="M125 82 L47 164 M132 175.1 L50 168" strokeWidth={4} />
      {/* head tube, bottom bracket shell, dropout */}
      <path d="M246 66 L258 64 L268 114 L256 116 Z" strokeWidth={2.5} />
      <circle cx={142} cy={176} r={10} />
      <path d="M36 160 Q38 154 46 154 L56 162 Q58 172 52 178 H36 Q32 170 36 160 Z" />
      <path d="M41 178 V169 Q41 166 44 166 Q47 166 47 169 V178" {...fine} />

      <path d="M289 47 L273 67" {...leader} />
      <circle data-callout="1" cx={296} cy={38} r={11} />
      <text x={296} y={38} {...calloutText}>
        1
      </text>
      <path d="M171 212 L153 191" {...leader} />
      <circle data-callout="2" cx={178} cy={220} r={11} />
      <text x={178} y={220} {...calloutText}>
        2
      </text>
      <path d="M93 38 L110 61" {...leader} />
      <circle data-callout="3" cx={86} cy={29} r={11} />
      <text x={86} y={29} {...calloutText}>
        3
      </text>
      <path d="M30 206 L38 184" {...leader} />
      <circle data-callout="4" cx={26} cy={217} r={11} />
      <text x={26} y={217} {...calloutText}>
        4
      </text>
    </GuideIllustrationFrame>
  );
}
