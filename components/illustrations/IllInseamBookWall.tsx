import { calloutText, GuideIllustrationFrame } from "./guide-frame";
import { fine, leader, tint } from "./guide-shapes";
import type { IllustrationProps } from "./placeholder";

/**
 * `inseam-book-wall` — measuring the inseam, seen from the side: a person
 * standing barefoot with their back to the wall holds a book level, spine up,
 * pushed into the crotch; the top edge of the book is marked on the wall, and
 * the inseam is the height from the floor to that mark. Drawn in profile
 * because from the front the body hides the mark on the wall behind it.
 */
export function IllInseamBookWall(props: IllustrationProps) {
  return (
    <GuideIllustrationFrame id="inseam-book-wall" placeholder={false} {...props}>
      {/* wall, in section, and floor */}
      <rect x={92} y={20} width={48} height={194} {...tint} stroke="none" />
      <path d="M140 20 V214 M20 214 H300" />
      {/* person in profile, barefoot, back and buttocks against the wall */}
      <circle cx={158} cy={42} r={12} />
      <path d="M154 54 C148 58 142 62 141 70 L140 124 Q141 134 146 140 L150 176 Q152 186 150 196 L148 206 L146 212 H182 Q184 208 178 205 L168 201 L170 168 Q173 160 174 150 L176 126 Q176 118 172 112 Q174 98 172 86 Q172 70 166 64 L162 56" />
      {/* the book, spine up and level, pushed into the crotch by one hand */}
      <rect x={144} y={128} width={38} height={18} rx={2} {...tint} />
      <path d="M144 128 H182" strokeWidth={3} />
      <path d="M156 70 L160 102 L183 134" strokeWidth={5} />
      {/* the mark on the wall, and the inseam from the floor up to it */}
      <path d="M130 128 H140" strokeWidth={3} />
      <path d="M106 128 H127" {...fine} strokeDasharray="3 3" />
      <path d="M116 128 V214 M112 133 L116 128 L120 133 M112 209 L116 214 L120 209" {...fine} />

      <path d="M231 120 L184 134" {...leader} />
      <circle data-callout="1" cx={242} cy={118} r={11} />
      <text x={242} y={118} {...calloutText}>
        1
      </text>
      <path d="M75 170 H114" {...leader} />
      <circle data-callout="2" cx={64} cy={170} r={11} />
      <text x={64} y={170} {...calloutText}>
        2
      </text>
    </GuideIllustrationFrame>
  );
}
