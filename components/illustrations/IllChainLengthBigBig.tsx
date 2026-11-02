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
      {/* inner links (narrow) between outer links (wide, waisted); the two
          added links filled darker: one inner, then one outer */}
      <path
        d="M22 201.1Q23.8 201 25.5 200.8A5.5 5.5 0 0 0 25.5 207.2Q23.8 207 22 206.9L22 201.1ZM54.5 200.8Q60 201.4 65.5 200.8A5.5 5.5 0 0 0 65.5 207.2Q60 206.6 54.5 207.2A5.5 5.5 0 0 0 54.5 200.8ZM94.5 200.8Q100 201.4 105.5 200.8A5.5 5.5 0 0 0 105.5 207.2Q100 206.6 94.5 207.2A5.5 5.5 0 0 0 94.5 200.8ZM174.5 200.8Q180 201.4 185.5 200.8A5.5 5.5 0 0 0 185.5 207.2Q180 206.6 174.5 207.2A5.5 5.5 0 0 0 174.5 200.8ZM214.5 200.8Q220 201.4 225.5 200.8A5.5 5.5 0 0 0 225.5 207.2Q220 206.6 214.5 207.2A5.5 5.5 0 0 0 214.5 200.8ZM254.5 200.8Q260 201.4 265.5 200.8A5.5 5.5 0 0 0 265.5 207.2Q260 206.6 254.5 207.2A5.5 5.5 0 0 0 254.5 200.8ZM294.5 200.8Q296.2 201 298 201.1L298 206.9Q296.2 207 294.5 207.2A5.5 5.5 0 0 0 294.5 200.8Z"
        {...tint}
        {...fine}
      />
      <path
        d="M134.5 200.8Q140 201.4 145.5 200.8A5.5 5.5 0 0 0 145.5 207.2Q140 206.6 134.5 207.2A5.5 5.5 0 0 0 134.5 200.8Z"
        {...solid}
        {...fine}
      />
      <path
        d="M30 198.5Q40 202.3 50 198.5A5.5 5.5 0 0 1 50 209.5Q40 205.7 30 209.5A5.5 5.5 0 0 1 30 198.5ZM70 198.5Q80 202.3 90 198.5A5.5 5.5 0 0 1 90 209.5Q80 205.7 70 209.5A5.5 5.5 0 0 1 70 198.5ZM110 198.5Q120 202.3 130 198.5A5.5 5.5 0 0 1 130 209.5Q120 205.7 110 209.5A5.5 5.5 0 0 1 110 198.5ZM190 198.5Q200 202.3 210 198.5A5.5 5.5 0 0 1 210 209.5Q200 205.7 190 209.5A5.5 5.5 0 0 1 190 198.5ZM230 198.5Q240 202.3 250 198.5A5.5 5.5 0 0 1 250 209.5Q240 205.7 230 209.5A5.5 5.5 0 0 1 230 198.5ZM270 198.5Q280 202.3 290 198.5A5.5 5.5 0 0 1 290 209.5Q280 205.7 270 209.5A5.5 5.5 0 0 1 270 198.5Z"
        {...tint}
      />
      <path
        d="M150 198.5Q160 202.3 170 198.5A5.5 5.5 0 0 1 170 209.5Q160 205.7 150 209.5A5.5 5.5 0 0 1 150 198.5Z"
        {...solid}
      />
      <path
        d="M30 204h0M50 204h0M70 204h0M90 204h0M110 204h0M130 204h0M150 204h0M170 204h0M190 204h0M210 204h0M230 204h0M250 204h0M270 204h0M290 204h0"
        strokeWidth={3.5}
      />
      <path d="M130 193 V189 H170 V193" {...fine} />

      <path d="M144 146 L110 121" {...leader} />
      <circle data-callout="1" cx={153} cy={153} r={11} />
      <text x={153} y={153} {...calloutText}>
        1
      </text>
      <path d="M118 175 L140 188" {...leader} />
      <circle data-callout="2" cx={108} cy={167} r={11} />
      <text x={108} y={167} {...calloutText}>
        2
      </text>
    </GuideIllustrationFrame>
  );
}
