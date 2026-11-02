import { calloutText, GuideIllustrationFrame } from "./guide-frame";
import { fine, leader, tint } from "./guide-shapes";
import type { IllustrationProps } from "./placeholder";

/**
 * `bar-tape-wrap` — the right-hand drop of a road handlebar seen from the
 * side, the front of the bike to the right, while the tape goes on: the first
 * turn overhangs the open bar end (the plug tucks it in), every turn covers
 * about a third of the one before (the darker strips), the arrow is the way
 * up the bar, and the tape crosses in a figure-eight over the lever clamp,
 * the hood rolled back.
 */
export function IllBarTapeWrap(props: IllustrationProps) {
  return (
    <GuideIllustrationFrame id="bar-tape-wrap" placeholder={false} {...props}>
      {/* stem, then the bar: the curve, the drop and its open end */}
      <path d="M60 51 H135 M60 65 H135" />
      <circle cx={150} cy={58} r={15} />
      <path d="M160 47 H180 A71 71 0 0 1 180 189 H48 M160 69 H180 A49 49 0 0 0 180 167 H48" />
      <ellipse cx={48} cy={178} rx={4} ry={11} />
      {/* lever body and blade */}
      <path d="M185 47.2 L188 38 Q191 32 202 32 L238 30 Q247 23 254 26 Q263 30 264 44 L262 58 L221.7 60.6" />
      <path d="M262 58 Q288 112 260 176" strokeWidth={5} />
      {/* the tape: first turn, turns and their overlaps, figure-eight over the lever clamp */}
      <path d="M40 167 L56 167 L58 189 L42 189 Z" {...fine} {...tint} />
      <path
        d="M62 167 L70 167 L78 167 L86 189 L78 189 L70 189 Z M84 167 L92 167 L100 167 L108 189 L100 189 L92 189 Z M106 167 L114 167 L122 167 L130 189 L122 189 L114 189 Z M128 167 L136 167 L144 167 L152 189 L144 189 L136 189 Z M150 167 L158 167 L166 167 L174 189 L166 189 L158 189 Z M172 167 L180 167 L186.5 166.6 L198.7 186.5 L189.4 188.4 L180 189 Z M191.3 165.7 L197.6 163.7 L203.5 161 L222 175.2 L214 180.3 L205.5 184.3 Z M207.7 158.4 L212.8 154.4 L217.3 149.7 L239.7 156.4 L234.1 164 L227.5 170.7 Z M220.3 145.8 L223.7 140.2 L226.2 134.2 L249.5 132.4 L247 141.5 L243.3 150.2 Z M227.6 129.5 L228.7 123.1 L229 116.6 L250.1 106.5 L251 115.9 L250.6 125.4 Z"
        {...fine}
        {...tint}
      />
      <path
        d="M51 167 L59 167 L67 167 L75 189 L67 189 L59 189 Z M73 167 L81 167 L89 167 L97 189 L89 189 L81 189 Z M95 167 L103 167 L111 167 L119 189 L111 189 L103 189 Z M117 167 L125 167 L133 167 L141 189 L133 189 L125 189 Z M139 167 L147 167 L155 167 L163 189 L155 189 L147 189 Z M161 167 L169 167 L177 167 L185.9 188.8 L177 189 L169 189 Z M182.4 166.9 L188.9 166.2 L195.3 164.6 L210.9 181.9 L202.1 185.5 L192.9 187.8 Z M199.8 162.8 L205.6 159.8 L210.9 156 L231.7 166.6 L224.8 173.1 L217.1 178.5 Z M214.6 152.7 L218.9 147.8 L222.5 142.4 L245.7 144.8 L241.6 153.3 L236.3 161.2 Z M224.7 138 L227 131.9 L228.4 125.5 L251 119.5 L250.2 128.9 L248.1 138.1 Z M228.9 120.7 L228.8 114.1 L227.9 107.7 L246.8 93.9 L249.4 103 L250.8 112.4 Z"
        {...fine}
        {...tint}
      />
      <path d="M227.1 104.4 L222.4 93.4 L225.9 63.8 L234.4 72.3 Z" {...fine} {...tint} />
      <path d="M216.5 85.3 L207.5 77.4 L240.2 80.4 L245.7 91.1 Z" {...fine} {...tint} />
      {/* wrapping direction, up the bar */}
      <path d="M70 207 H180 A89 89 0 0 0 231 190.9" {...fine} />
      <path d="M221.5 191.4 L231 190.9 L227.3 199.6" {...fine} />

      <path d="M29 158 L40 170" {...leader} />
      <circle data-callout="1" cx={22} cy={150} r={11} />
      <text x={22} y={150} {...calloutText}>
        1
      </text>
      <path d="M112 139 V178" {...leader} />
      <circle data-callout="2" cx={112} cy={128} r={11} />
      <text x={112} y={128} {...calloutText}>
        2
      </text>
      <path d="M176.5 100.8 L218 90" {...leader} />
      <circle data-callout="3" cx={166} cy={104} r={11} />
      <text x={166} y={104} {...calloutText}>
        3
      </text>
    </GuideIllustrationFrame>
  );
}
