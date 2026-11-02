import { calloutText, GuideIllustrationFrame } from "./guide-frame";
import { fine, leader, solid, tint } from "./guide-shapes";
import type { IllustrationProps } from "./placeholder";

/**
 * `reach-and-drop` — the front half of a road bike seen from the side, front
 * to the right: saddle, seatpost, top tube, head tube, stem and drop bar with
 * its lever hood. The reach is a straight dimension from the saddle nose to
 * the middle of the hood, where the hands rest; the drop is the vertical
 * dimension from a level line at the top of the saddle down to the bar there.
 */
export function IllReachAndDrop(props: IllustrationProps) {
  return (
    <GuideIllustrationFrame id="reach-and-drop" placeholder={false} {...props}>
      {/* frame: seat tube, top tube, head tube, fork and down tube */}
      <path d="M68 98 L104 214 M68 100 L206 104 M206 98 L217 136 L228 190 M214 126 L120 214" />
      {/* saddle on its seatpost */}
      <path d="M58 57 L68 98" strokeWidth={4} />
      <path
        d="M18 50 Q22 44 36 45 L86 47 Q97 48 98 51 L86 55 Q60 57 36 57 Q22 57 18 53 Z"
        {...tint}
      />
      {/* spacer, stem, bar clamp, drop bar and lever hood */}
      <path d="M203 90 L206 98" strokeWidth={3} />
      <path d="M206 93 L239 89" strokeWidth={5} />
      <circle cx={243} cy={90} r={5} />
      <path d="M248 90 H262 Q284 90 284 114 Q284 136 262 138 H252" strokeWidth={4} />
      <path
        d="M262 90 Q264 82 272 81 L286 80 Q292 80 291 86 L288 100 Q284 104 280 99 Z"
        {...solid}
      />
      <path d="M288 100 Q295 118 289 134" strokeWidth={3} />
      {/* reach: saddle nose to the middle of the hands */}
      <path
        d="M99 51 L274 80 M106.2 56.3 L99 51 L107.5 48.4 M265.5 82.6 L274 80 L266.8 74.7"
        {...fine}
      />
      {/* drop: level with the top of the saddle, down to the bar */}
      <path d="M60 45 H306 M294 80 H306" {...fine} strokeDasharray="3 3" />
      <path d="M300 45 V80 M296 50 L300 45 L304 50 M296 75 L300 80 L304 75" {...fine} />

      <path d="M171 41 L183 63" {...leader} />
      <circle data-callout="1" cx={166} cy={30} r={11} />
      <text x={166} y={30} {...calloutText}>
        1
      </text>
      <path d="M283 30 L297 62" {...leader} />
      <circle data-callout="2" cx={276} cy={22} r={11} />
      <text x={276} y={22} {...calloutText}>
        2
      </text>
    </GuideIllustrationFrame>
  );
}
