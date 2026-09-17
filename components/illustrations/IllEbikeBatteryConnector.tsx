import { calloutText, GuideIllustrationFrame } from "./guide-frame";
import { fine, leader, solid, tint } from "./guide-shapes";
import type { IllustrationProps } from "./placeholder";

/**
 * `ebike-battery-connector` — an e-bike battery lifted off its mount: the
 * metal contacts at the end of the battery face the matching socket on the
 * mount, and the key lock sits in the mount beside them.
 */
export function IllEbikeBatteryConnector(props: IllustrationProps) {
  return (
    <GuideIllustrationFrame id="ebike-battery-connector" placeholder={false} {...props}>
      {/* battery body, tilted off the mount */}
      <path
        d="M28 70 L186 38 Q200 36 202 50 L212 100 Q214 114 200 116 L42 148 Q28 150 26 136 L18 86 Q16 72 28 70 Z"
        {...tint}
      />
      <path d="M40 90 L190 60" {...fine} strokeOpacity={0.5} />
      {/* contact block on the battery end */}
      <path d="M204 58 L226 54 L234 98 L212 102" />
      <path d="M214 64 L220 63 M216 74 L222 73 M218 84 L224 83 M220 94 L226 93" strokeWidth={3} />
      {/* mount on the frame with its socket */}
      <path d="M24 196 H296" strokeWidth={4} />
      <rect x={236} y={120} width={56} height={76} rx={6} />
      <path d="M248 132 V184 M258 132 V184 M268 132 V184 M278 132 V184" {...fine} />
      {/* key lock with key slot */}
      <circle cx={196} cy={172} r={14} {...solid} />
      <path d="M196 164 V180" strokeWidth={3} />
      <path d="M210 172 H236" {...fine} />
      {/* battery slides onto the socket */}
      <path d="M232 110 L248 124 M240 124 H248 V116" {...fine} />

      <path d="M270 58 L227 72" {...leader} />
      <circle data-callout="1" cx={281} cy={54} r={11} />
      <text x={281} y={54} {...calloutText}>
        1
      </text>
      <path d="M151 205 L184 181" {...leader} />
      <circle data-callout="2" cx={142} cy={214} r={11} />
      <text x={142} y={214} {...calloutText}>
        2
      </text>
    </GuideIllustrationFrame>
  );
}
