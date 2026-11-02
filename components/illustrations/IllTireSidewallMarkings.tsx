import { calloutText, GuideIllustrationFrame } from "./guide-frame";
import { fine, leader, solid, tint } from "./guide-shapes";
import type { IllustrationProps } from "./placeholder";

/**
 * `tire-sidewall-markings` — the top of a wheel seen from the side: the tread
 * band outside, the sidewall, and the rim inside. Three markings are moulded
 * in the sidewall, drawn as abstract raised blocks rather than characters: the
 * ETRTO size (two groups joined by a dash), the pressure range (two values and
 * a unit), and the arrow giving the direction of rotation.
 */
export function IllTireSidewallMarkings(props: IllustrationProps) {
  return (
    <GuideIllustrationFrame id="tire-sidewall-markings" placeholder={false} {...props}>
      {/* tread band with its pattern */}
      <path
        d="M10 75.5A270 270 0 0 1 310 75.5 L310 95 A254 254 0 0 0 10 95 Z"
        {...tint}
        stroke="none"
      />
      <path d="M10 75.5A270 270 0 0 1 310 75.5 M10 95A254 254 0 0 1 310 95" />
      <path
        d="M23.8 82.1L18.5 73.6M39.3 73.1L34.7 64.3M55.5 65.2L51.4 56.1M72.1 58.5L68.7 49.1M89.2 53L86.4 43.3M106.6 48.6L104.5 38.8M124.2 45.5L122.8 35.6M142.1 43.6L141.4 33.7M160 43L160 33M177.9 43.6L178.6 33.7M195.8 45.5L197.2 35.6M213.4 48.6L215.5 38.8M230.8 53L233.6 43.3M247.9 58.5L251.3 49.1M264.5 65.2L268.6 56.1M280.7 73.1L285.3 64.3M296.2 82.1L301.5 73.6"
        {...fine}
      />
      {/* bead line, rim edge and rim */}
      <path d="M10 167.7A200 200 0 0 1 310 167.7" {...fine} strokeOpacity={0.6} />
      <path
        d="M10 173.8A196 196 0 0 1 310 173.8 L310 207.9 A176 176 0 0 0 10 207.9 Z"
        {...tint}
        stroke="none"
      />
      <path d="M10 173.8A196 196 0 0 1 310 173.8 M10 207.9A176 176 0 0 1 310 207.9" />
      {/* moulded markings: ETRTO size, pressure range, direction arrow */}
      <path
        d="M41 102A231 231 0 0 1 48.4 97.8L54.2 108.3A219 219 0 0 0 47.2 112.3ZM51.6 96A231 231 0 0 1 59.1 92.2L64.3 103A219 219 0 0 0 57.2 106.6ZM64.3 94.7A226.5 226.5 0 0 1 69.3 92.4L70.5 95.2A223.5 223.5 0 0 0 65.5 97.4ZM70.9 86.9A231 231 0 0 1 78.7 83.8L82.9 95A219 219 0 0 0 75.5 98ZM82.1 82.5A231 231 0 0 1 90.2 79.8L93.8 91.3A219 219 0 0 0 86.2 93.8ZM93.6 78.7A231 231 0 0 1 101.8 76.5L104.8 88.1A219 219 0 0 0 97.1 90.2Z"
        {...solid}
        {...fine}
      />
      <path
        d="M131.8 70.7A231 231 0 0 1 140.3 69.8L141.3 81.8A219 219 0 0 0 133.3 82.6ZM143.9 69.6A231 231 0 0 1 152.3 69.1L152.7 81.1A219 219 0 0 0 144.7 81.5ZM156 73.5A226.5 226.5 0 0 1 161.6 73.5L161.6 76.5A223.5 223.5 0 0 0 156.1 76.5ZM165.2 69.1A231 231 0 0 1 173.7 69.4L173 81.4A219 219 0 0 0 165 81.1ZM177.3 69.7A231 231 0 0 1 185.7 70.4L184.4 82.4A219 219 0 0 0 176.4 81.6ZM195.7 71.8A231 231 0 0 1 204.1 73.2L201.8 85A219 219 0 0 0 193.9 83.6ZM207.6 74A231 231 0 0 1 215.9 75.9L213 87.5A219 219 0 0 0 205.2 85.7ZM219.4 76.8A231 231 0 0 1 227.5 79.1L224 90.6A219 219 0 0 0 216.3 88.4Z"
        {...solid}
        {...fine}
      />
      <path d="M237 88.6A225 225 0 0 1 284.2 112.4" strokeWidth={3} />
      <path d="M287.5 107.4L297 121.5L280.9 117.4Z" {...solid} />

      <path d="M58 188 L73 105" {...leader} />
      <circle data-callout="1" cx={56} cy={199} r={11} />
      <text x={56} y={199} {...calloutText}>
        1
      </text>
      <path d="M169 186 L172 89" {...leader} />
      <circle data-callout="2" cx={168} cy={197} r={11} />
      <text x={168} y={197} {...calloutText}>
        2
      </text>
      <path d="M262 186 L266 109" {...leader} />
      <circle data-callout="3" cx={261} cy={197} r={11} />
      <text x={261} y={197} {...calloutText}>
        3
      </text>
    </GuideIllustrationFrame>
  );
}
