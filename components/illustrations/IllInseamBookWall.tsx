import { calloutText, GuideIllustrationFrame } from "./guide-frame";
import { fine, leader, tint } from "./guide-shapes";
import type { IllustrationProps } from "./placeholder";

/**
 * `inseam-book-wall` — measuring the inseam, seen from the side: a person
 * standing barefoot with their back to the wall holds a book level, spine up,
 * pushed into the crotch between the legs (the near thigh hides its middle) and
 * touching the wall; the top edge of the book is marked on the wall, and
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
      <path d="M154 54 C148 58 142 62 141 70 L140 116 Q140 126 148 130 L152 160 L152 176 Q153 186 151 196 L149 206 L147 212 H182 Q184 208 178 205 L168 201 L170 168 Q173 160 174 150 L176 126 Q176 118 172 112 Q174 98 172 86 Q172 70 166 64 L162 56" />
      {/* the book, spine up and level, between the legs: the near thigh hides
          its middle, its back end touches the wall, its front end sticks out */}
      <path
        d="M140 128 H145.4 L150.4 146 H140 Z M175.8 128 H194 Q196 128 196 130 V144 Q196 146 194 146 H174.3 Z"
        {...tint}
      />
      <path d="M140 128 H145.4 M175.8 128 H196" strokeWidth={3} />
      <path d="M156 70 L162 102 L188 140" strokeWidth={5} />
      {/* the mark on the wall, and the inseam from the floor up to it */}
      <path d="M128 128 H140" strokeWidth={3} />
      <path d="M106 128 H125" {...fine} strokeDasharray="3 3" />
      <path d="M116 128 V214 M112 133 L116 128 L120 133 M112 209 L116 214 L120 209" {...fine} />

      <path d="M231 120 L197 133" {...leader} />
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
