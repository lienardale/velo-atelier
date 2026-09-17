import { calloutText, GuideIllustrationFrame } from "./guide-frame";
import { fine, leader, tint } from "./guide-shapes";
import type { IllustrationProps } from "./placeholder";

/**
 * `barrel-adjuster` — the knurled barrel adjuster where the housing meets the
 * derailleur (or the lever): the housing and its ferrule come in from the
 * left, the cable runs on through the barrel, and the arrow shows the barrel
 * turning in its thread.
 */
export function IllBarrelAdjuster(props: IllustrationProps) {
  return (
    <GuideIllustrationFrame id="barrel-adjuster" placeholder={false} {...props}>
      {/* housing and ferrule */}
      <path d="M24 112 H136 M24 128 H136" />
      <path
        d="M40 112 V128 M60 112 V128 M80 112 V128 M100 112 V128"
        {...fine}
        strokeOpacity={0.5}
      />
      <rect x={128} y={108} width={20} height={24} rx={2} {...tint} />
      {/* knurled barrel */}
      <rect x={148} y={96} width={52} height={48} rx={6} />
      <path d="M158 96 V144 M168 96 V144 M178 96 V144 M188 96 V144" {...fine} />
      {/* thread into the body */}
      <rect x={200} y={108} width={22} height={24} />
      <path d="M204 108 L210 132 M211 108 L217 132 M218 108 L222 124" {...fine} />
      {/* derailleur or lever body, cable inside */}
      <rect x={222} y={78} width={74} height={84} rx={10} {...tint} />
      <path d="M136 120 H296" {...fine} strokeDasharray="5 4" />
      {/* turning arrow */}
      <path d="M150 84 Q174 64 198 84" {...fine} />
      <path d="M190 76 L199 85 L187 88" {...fine} />

      <path d="M174 50 V62" {...leader} />
      <circle data-callout="1" cx={174} cy={39} r={11} />
      <text x={174} y={39} {...calloutText}>
        1
      </text>
      <path d="M72 181 L72 130" {...leader} />
      <circle data-callout="2" cx={72} cy={192} r={11} />
      <text x={72} y={192} {...calloutText}>
        2
      </text>
    </GuideIllustrationFrame>
  );
}
