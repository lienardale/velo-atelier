import { calloutText, GuideIllustrationFrame } from "./guide-frame";
import { fine, leader, solid, tint } from "./guide-shapes";
import type { IllustrationProps } from "./placeholder";

/**
 * `brake-lever-reach-screw` — a flat-bar brake lever seen from above, the
 * front of the bike at the top: the lever clamped on the bar beside the grip,
 * its blade reaching out in front of the grip, the small reach screw at the
 * blade's pivot, and the gap between grip and blade at fingertip height. The
 * curved arrow is the blade coming closer to the grip as the screw goes in.
 */
export function IllBrakeLeverReachScrew(props: IllustrationProps) {
  return (
    <GuideIllustrationFrame id="brake-lever-reach-screw" placeholder={false} {...props}>
      {/* handlebar, and the grip on its end */}
      <path d="M12 174 H176 M12 190 H176" />
      <rect x={176} y={164} width={106} height={36} rx={10} {...tint} />
      <path
        d="M192 164 V200 M206 164 V200 M220 164 V200 M234 164 V200 M248 164 V200 M262 164 V200"
        {...fine}
        strokeOpacity={0.45}
      />
      {/* lever clamp, body and hose */}
      <rect x={124} y={168} width={22} height={28} rx={3} />
      <rect x={100} y={118} width={64} height={50} rx={10} />
      <path d="M100 138 Q70 138 54 114 Q40 94 24 86" {...fine} strokeWidth={3} />
      {/* blade on its pivot */}
      <path d="M158 118 Q216 112 270 120 Q280 124 276 134 Q218 130 160 138 Z" {...tint} />
      <circle cx={164} cy={128} r={3} {...fine} />
      {/* reach screw at the blade's root */}
      <circle cx={170} cy={110} r={8} {...solid} />
      <path d="M174 110 L172 113.5 H168 L166 110 L168 106.5 H172 Z" {...fine} />
      {/* blade coming closer to the grip */}
      <path d="M290 104 Q298 116 294 132" {...fine} />
      <path d="M288 127 L294 133 L299 126" {...fine} />
      {/* reach at fingertip height */}
      <path d="M240 137 V163 M234 137 H246 M234 163 H246" {...fine} />

      <path d="M170 65 V101" {...leader} />
      <circle data-callout="1" cx={170} cy={54} r={11} />
      <text x={170} y={54} {...calloutText}>
        1
      </text>
      <path d="M232 65 V114" {...leader} />
      <circle data-callout="2" cx={232} cy={54} r={11} />
      <text x={232} y={54} {...calloutText}>
        2
      </text>
      <path d="M287 150 H241" {...leader} />
      <circle data-callout="3" cx={298} cy={150} r={11} />
      <text x={298} y={150} {...calloutText}>
        3
      </text>
    </GuideIllustrationFrame>
  );
}
