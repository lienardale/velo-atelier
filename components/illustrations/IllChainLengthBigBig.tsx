import { calloutText, GuideIllustrationFrame } from "./guide-frame";
import { fine, leader, solid, tint } from "./guide-shapes";
import type { IllustrationProps } from "./placeholder";

/**
 * `chain-length-big-big` — sizing a new chain, seen from the drive side: the
 * chain wrapped around the largest sprocket (left) and the largest chainring
 * (right), its lower run going straight past the rear derailleur, drawn faint,
 * instead of through its jockey wheels. Below, the place where the two ends
 * meet, enlarged: the two links added there, one inner and one outer, filled.
 */
export function IllChainLengthBigBig(props: IllustrationProps) {
  return (
    <GuideIllustrationFrame id="chain-length-big-big" placeholder={false} {...props}>
      {/* largest sprocket and largest chainring */}
      <circle cx={80} cy={84} r={33} {...fine} />
      <path
        d="M80 58 A26 26 0 1 0 80.1 58 M80 64 A20 20 0 1 0 80.1 64 M80 70 A14 14 0 1 0 80.1 70"
        {...fine}
        strokeOpacity={0.5}
      />
      <circle cx={80} cy={84} r={6} />
      <circle cx={234} cy={80} r={52} {...fine} />
      <circle cx={234} cy={80} r={30} {...fine} strokeOpacity={0.5} />
      <circle cx={234} cy={80} r={7} />
      {/* rear derailleur, bypassed: hanger, body, cage and jockey wheels */}
      <g strokeOpacity={0.4}>
        <circle cx={78} cy={100} r={4} />
        <path d="M82 102 L98 106 L102 126 L90 130 Z" />
        <path d="M91.6 138.2L81.6 164.2A6 6 0 0 1 70.4 159.8L80.4 133.8A6 6 0 0 1 91.6 138.2Z" />
        <circle cx={86} cy={136} r={8} />
        <circle cx={76} cy={162} r={8} />
      </g>
      {/* the chain: big-big, its lower run straight from sprocket to chainring */}
      <path
        d="M74.9 49.9L226 27.1A53.5 53.5 0 1 1 228.8 133.2L76.6 118.3A34.5 34.5 0 0 1 74.9 49.9Z M75.9 56.8L227.1 34A46.5 46.5 0 1 1 229.5 126.3L77.3 111.4A27.5 27.5 0 0 1 75.9 56.8Z"
        {...tint}
        {...fine}
        fillRule="evenodd"
      />
      <path
        d="M75.4 53.3L226.5 30.6A50 50 0 1 1 229.1 129.8L77 114.9A31 31 0 0 1 75.4 53.3Z"
        strokeWidth={2.5}
        strokeDasharray="0 7"
      />
      {/* where the ends meet, enlarged below */}
      <circle cx={200} cy={126.5} r={11} {...fine} strokeDasharray="3 3" />
      <path d="M200 138 V184" {...fine} strokeDasharray="3 3" strokeOpacity={0.6} />
      <rect x={18} y={184} width={284} height={32} rx={8} {...fine} strokeDasharray="3 3" />
      {/* the added inner link and outer link, between the two ends */}
      <path
        d="M128 199Q135 202 142 199A5 5 0 0 1 142 209Q135 206 128 209A5 5 0 0 1 128 199Z M142 198Q149 202 156 198A6 6 0 0 1 156 210Q149 206 142 210A6 6 0 0 1 142 198Z"
        {...solid}
      />
      <path
        d="M48.8 200.3Q51 200.7 53.2 200.3M48.8 207.7Q51 207.3 53.2 207.7M76.8 200.3Q79 200.7 81.2 200.3M76.8 207.7Q79 207.3 81.2 207.7M104.8 200.3Q107 200.7 109.2 200.3M104.8 207.7Q107 207.3 109.2 207.7M160.8 200.3Q163 200.7 165.2 200.3M160.8 207.7Q163 207.3 165.2 207.7M188.8 200.3Q191 200.7 193.2 200.3M188.8 207.7Q191 207.3 193.2 207.7M216.8 200.3Q219 200.7 221.2 200.3M216.8 207.7Q219 207.3 221.2 207.7M244.8 200.3Q247 200.7 249.2 200.3M244.8 207.7Q247 207.3 249.2 207.7M272.8 200.3Q275 200.7 277.2 200.3M272.8 207.7Q275 207.3 277.2 207.7"
        {...fine}
      />
      <path
        d="M30 198Q37 202 44 198A6 6 0 0 1 44 210Q37 206 30 210A6 6 0 0 1 30 198ZM58 198Q65 202 72 198A6 6 0 0 1 72 210Q65 206 58 210A6 6 0 0 1 58 198ZM86 198Q93 202 100 198A6 6 0 0 1 100 210Q93 206 86 210A6 6 0 0 1 86 198ZM114 198Q121 202 128 198A6 6 0 0 1 128 210Q121 206 114 210A6 6 0 0 1 114 198ZM170 198Q177 202 184 198A6 6 0 0 1 184 210Q177 206 170 210A6 6 0 0 1 170 198ZM198 198Q205 202 212 198A6 6 0 0 1 212 210Q205 206 198 210A6 6 0 0 1 198 198ZM226 198Q233 202 240 198A6 6 0 0 1 240 210Q233 206 226 210A6 6 0 0 1 226 198ZM254 198Q261 202 268 198A6 6 0 0 1 268 210Q261 206 254 210A6 6 0 0 1 254 198ZM282 198Q289 202 296 198A6 6 0 0 1 296 210Q289 206 282 210A6 6 0 0 1 282 198Z"
        {...tint}
      />
      <path
        d="M30 204h0M44 204h0M58 204h0M72 204h0M86 204h0M100 204h0M114 204h0M128 204h0M142 204h0M156 204h0M170 204h0M184 204h0M198 204h0M212 204h0M226 204h0M240 204h0M254 204h0M268 204h0M282 204h0M296 204h0"
        strokeWidth={4}
      />
      <path d="M128 193 V189 H156 V193" {...fine} />

      <path d="M144 146 L110 121" {...leader} />
      <circle data-callout="1" cx={153} cy={153} r={11} />
      <text x={153} y={153} {...calloutText}>
        1
      </text>
      <path d="M118 175 L134 188" {...leader} />
      <circle data-callout="2" cx={108} cy={167} r={11} />
      <text x={108} y={167} {...calloutText}>
        2
      </text>
    </GuideIllustrationFrame>
  );
}
