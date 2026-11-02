import { calloutText, GuideIllustrationFrame } from "./guide-frame";
import { fine, leader, solid, tint } from "./guide-shapes";
import type { IllustrationProps } from "./placeholder";

/**
 * `valve-length-rim-depth` — a deep rim cut across, tyre side up: its two
 * bead hooks, the rim bed with its central well, the hollow section and the
 * spoke bed. A tubeless valve goes through both walls: rubber base in the
 * well, lock nut against the spoke bed, threaded stem and core below. One
 * dimension gives the rim depth, the other the part of the valve that sticks
 * out beyond the rim.
 */
export function IllValveLengthRimDepth(props: IllustrationProps) {
  return (
    <GuideIllustrationFrame id="valve-length-rim-depth" placeholder={false} {...props}>
      {/* tyre sidewalls, leaving the hooks */}
      <path d="M110 36 Q98 22 94 10 M170 36 Q182 22 186 10" {...fine} strokeOpacity={0.5} />
      {/* rim section: hooks, bead seats, well, hollow, spoke bed */}
      <path
        d="M106 38 H118 V45 H114 V54 H124 L130 68 H150 L156 54 H166 V45 H162 V38 H174 V100 Q174 154 140 156 Q106 154 106 100 Z M110 58 H122 L128 72 H152 L158 58 H170 V100 Q170 150 140 152 Q110 150 110 100 Z"
        fillRule="evenodd"
        {...tint}
      />
      {/* valve: rubber base in the well, stem through the rim */}
      <path d="M130 68 L134 57 H146 L150 68 Z" {...solid} />
      <path d="M134 68 V200 M146 68 V200" />
      {/* lock nut, threaded stem, core nut and pin */}
      <rect x={127} y={157} width={26} height={11} rx={2} {...solid} />
      <path
        d="M134 174 L146 178 M134 182 L146 186 M134 190 L146 194"
        {...fine}
        strokeOpacity={0.6}
      />
      <rect x={136} y={200} width={8} height={8} rx={1.5} {...solid} />
      <path d="M140 208 V218" strokeWidth={3} />

      {/* rim depth */}
      <path d="M104 38 H72 M136 156 H72" {...fine} />
      <path d="M78 41 V153" {...fine} />
      <path d="M78 38 L74 46 H82 Z M78 156 L74 148 H82 Z" {...solid} />
      {/* valve sticking out beyond the rim */}
      <path d="M156 156 H206 M144 218 H206" {...fine} />
      <path d="M200 159 V215" {...fine} />
      <path d="M200 156 L196 164 H204 Z M200 218 L196 210 H204 Z" {...solid} />

      <path d="M51 97 H78" {...leader} />
      <circle data-callout="1" cx={40} cy={97} r={11} />
      <text x={40} y={97} {...calloutText}>
        1
      </text>
      <path d="M233 187 H200" {...leader} />
      <circle data-callout="2" cx={244} cy={187} r={11} />
      <text x={244} y={187} {...calloutText}>
        2
      </text>
    </GuideIllustrationFrame>
  );
}
