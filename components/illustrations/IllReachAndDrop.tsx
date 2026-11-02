import { calloutText, GuideIllustrationFrame } from "./guide-frame";
import { fine, leader, solid, tint } from "./guide-shapes";
import type { IllustrationProps } from "./placeholder";

/**
 * `reach-and-drop` — the front half of a road bike seen from the side, front
 * to the right: saddle, seatpost, top tube, head tube, stem and drop bar with
 * its lever hood. The reach is a straight dimension from the saddle nose to
 * the middle of the hood, where the hands rest; the drop is the vertical
 * dimension from a level line at the top of the saddle down to the top of the
 * bar (its tube, not the hood above it), about 7 cm here, mid road range.
 */
export function IllReachAndDrop(props: IllustrationProps) {
  return (
    <GuideIllustrationFrame id="reach-and-drop" placeholder={false} {...props}>
      {/* frame: seat tube, top tube, head tube, fork and down tube */}
      <path d="M68 98 L104 214 M68 100 L206 104 M206 98 L217 136 L228 190 M214 126 L120 214" />
      {/* saddle on its seatpost */}
      <path d="M60 63 L68 98" strokeWidth={4} />
      <path
        d="M18 56 Q22 50 36 51 L86 53 Q97 54 98 57 L86 61 Q60 63 36 63 Q22 63 18 59 Z"
        {...tint}
      />
      {/* spacer, stem, bar clamp, drop bar and lever hood */}
      <path d="M203 86 L206 98" strokeWidth={3} />
      <path d="M204 88 L238 77" strokeWidth={5} />
      <circle cx={243} cy={76} r={6} />
      <path d="M249 76 H262 Q284 76 284 100 Q284 122 262 124 H252" strokeWidth={5} />
      <path d="M264 76 Q266 68 273 67 L286 66 Q292 66 291 72 L288 86 Q284 90 281 85 Z" {...solid} />
      <path d="M288 86 Q295 104 289 120" strokeWidth={3} />
      {/* reach: saddle nose to the middle of the hands, on the hood */}
      <path
        d="M99 57 L278 66 M106.8 61.4 L99 57 L107.2 53.4 M269.8 69.6 L278 66 L270.2 61.6"
        {...fine}
      />
      {/* drop: level with the top of the saddle, down to the top of the bar */}
      <path d="M60 51 H306 M250 73.5 H306" {...fine} strokeDasharray="3 3" />
      <path d="M300 51 V73.5 M296 56 L300 51 L304 56 M296 68.5 L300 73.5 L304 68.5" {...fine} />

      <path d="M171 41 L185 59" {...leader} />
      <circle data-callout="1" cx={166} cy={30} r={11} />
      <text x={166} y={30} {...calloutText}>
        1
      </text>
      <path d="M283 30 L297 61" {...leader} />
      <circle data-callout="2" cx={276} cy={22} r={11} />
      <text x={276} y={22} {...calloutText}>
        2
      </text>
    </GuideIllustrationFrame>
  );
}
