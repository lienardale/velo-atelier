import { calloutText, GuideIllustrationFrame } from "./guide-frame";
import { fine, leader, solid, tint } from "./guide-shapes";
import type { IllustrationProps } from "./placeholder";

/**
 * `headset-threaded-vs-threadless` — two front ends side by side. Left: a
 * threaded headset, its locknut above the adjustable cup and a quill stem
 * rising out of the steerer. Right: a threadless (Aheadset) headset, the stem
 * clamped on the steerer by two side bolts and closed by the top cap.
 */
export function IllHeadsetThreadedVsThreadless(props: IllustrationProps) {
  return (
    <GuideIllustrationFrame id="headset-threaded-vs-threadless" placeholder={false} {...props}>
      {/* threaded: head tube, adjustable cup, locknut, quill stem */}
      <rect x={52} y={136} width={48} height={84} rx={4} {...tint} />
      <rect x={48} y={124} width={56} height={12} rx={2} />
      <rect x={44} y={108} width={64} height={14} rx={2} {...solid} />
      <path
        d="M52 108 V122 M60 108 V122 M68 108 V122 M76 108 V122 M84 108 V122 M92 108 V122 M100 108 V122"
        {...fine}
      />
      <path d="M66 108 V46 H130 M86 108 V64 H130" />
      <circle cx={134} cy={55} r={10} />

      <path d="M160 30 V220" {...fine} strokeDasharray="6 6" strokeOpacity={0.5} />

      {/* threadless: head tube, spacer, stem clamp with two bolts, top cap */}
      <rect x={206} y={150} width={48} height={70} rx={4} {...tint} />
      <rect x={210} y={138} width={40} height={12} rx={2} />
      <rect x={202} y={90} width={56} height={48} rx={6} />
      <path d="M258 102 H290 M258 126 H290" />
      <circle cx={296} cy={114} r={14} />
      <path d="M196 102 H206 M196 126 H206" strokeWidth={3} />
      <circle cx={194} cy={102} r={4} {...solid} />
      <circle cx={194} cy={126} r={4} {...solid} />
      <rect x={206} y={78} width={48} height={10} rx={3} {...solid} />
      <path d="M230 70 V78" strokeWidth={3} />

      <path d="M29 97 L44 110" {...leader} />
      <circle data-callout="1" cx={22} cy={88} r={11} />
      <text x={22} y={88} {...calloutText}>
        1
      </text>
      <path d="M180 170 L192 130" {...leader} />
      <circle data-callout="2" cx={178} cy={181} r={11} />
      <text x={178} y={181} {...calloutText}>
        2
      </text>
      <path d="M270 44 L250 76" {...leader} />
      <circle data-callout="3" cx={277} cy={34} r={11} />
      <text x={277} y={34} {...calloutText}>
        3
      </text>
    </GuideIllustrationFrame>
  );
}
