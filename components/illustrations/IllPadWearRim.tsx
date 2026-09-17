import { calloutText, GuideIllustrationFrame } from "./guide-frame";
import { fine, leader, solid, tint } from "./guide-shapes";
import type { IllustrationProps } from "./placeholder";

/**
 * `pad-wear-rim` — a stretch of rim seen from the side with its tyre, the
 * braking track along the sidewall, and a brake block with its wear grooves
 * about to press on the track.
 */
export function IllPadWearRim(props: IllustrationProps) {
  return (
    <GuideIllustrationFrame id="pad-wear-rim" placeholder={false} {...props}>
      {/* tyre */}
      <path d="M24 84 Q160 30 296 84" />
      <path d="M24 104 Q160 56 296 104" {...fine} />
      {/* rim sidewall and braking track */}
      <path d="M24 104 Q160 56 296 104 L296 150 Q160 102 24 150 Z" />
      <path d="M24 112 Q160 64 296 112 L296 138 Q160 90 24 138 Z" {...tint} />
      {/* brake block on its holder */}
      <rect x={96} y={166} width={128} height={30} rx={14} {...tint} />
      <path d="M126 170 V192 M146 170 V192 M166 170 V192 M186 170 V192 M206 170 V192" {...fine} />
      <path d="M150 196 V216 H170 V196" />
      <circle cx={160} cy={222} r={4} {...solid} />
      {/* squeeze direction */}
      <path d="M160 160 V124 M153 132 L160 123 L167 132" {...fine} />

      <path d="M58 188 L96 182" {...leader} />
      <circle data-callout="1" cx={47} cy={190} r={11} />
      <text x={47} y={190} {...calloutText}>
        1
      </text>
      <path d="M279 150 L256 118" {...leader} />
      <circle data-callout="2" cx={286} cy={162} r={11} />
      <text x={286} y={162} {...calloutText}>
        2
      </text>
    </GuideIllustrationFrame>
  );
}
