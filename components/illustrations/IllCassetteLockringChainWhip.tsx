import { calloutText, GuideIllustrationFrame } from "./guide-frame";
import { fine, leader, solid, tint } from "./guide-shapes";
import type { IllustrationProps } from "./placeholder";

/**
 * `cassette-lockring-chain-whip` — a cassette seen face-on from the drive
 * side (concentric sprockets). The chain whip's chain lies over the top of
 * the largest sprocket and its handle points right, holding the cassette; the
 * lockring tool sits in the splined lockring at the centre, gripped by an
 * adjustable wrench whose handle points left. The arrow at the wrench's end
 * is the loosening direction: anticlockwise, as seen from this side.
 */
export function IllCassetteLockringChainWhip(props: IllustrationProps) {
  return (
    <GuideIllustrationFrame id="cassette-lockring-chain-whip" placeholder={false} {...props}>
      {/* sprockets, largest with its teeth */}
      <path d="M82.7 105.5 A78 78 0 1 1 82.7 126.5" strokeWidth={4} strokeDasharray="2.5 2.5" />
      <path
        d="M93.9 105.2 A67 67 0 1 1 93.9 126.8 M105 105.3 A56 56 0 1 1 105 126.7 M123 90.4 A45 45 0 1 1 122.3 140.5 M134.7 90.4 A36 36 0 1 1 133.7 140.6"
        {...fine}
      />
      {/* chain whip: its chain over the largest sprocket, pivot and handle */}
      <path d="M239 116 A79 79 0 0 0 96.1 69.6 L88 63.7 A89 89 0 0 1 249 116 Z" {...tint} />
      <path
        d="M238 103.6 L247.9 102.1 M235.1 91.6 L244.6 88.5 M230.4 80.1 L239.3 75.6 M223.9 69.6 L232 63.7 M215.9 60.1 L222.9 53.1 M206.4 52.1 L212.3 44 M195.9 45.6 L200.4 36.7 M184.4 40.9 L187.5 31.4 M172.4 38 L173.9 28.1 M160 37 L160 27 M147.6 38 L146.1 28.1 M135.6 40.9 L132.5 31.4 M124.1 45.6 L119.6 36.7 M113.6 52.1 L107.7 44 M104.1 60.1 L97.1 53.1"
        {...fine}
      />
      <path d="M250 110 H300 Q306 110 306 116 Q306 122 300 122 H250" />
      <circle cx={246} cy={116} r={6} {...solid} />
      {/* lockring with its splines */}
      <path d="M148.5 90.5 A28 28 0 1 1 146.5 140.5" />
      <path
        d="M172.6 99.2 A21 21 0 0 1 172.6 132.8 M181 116 H185 M178.2 126.5 L181.7 128.5 M178.2 105.5 L181.7 103.5 M170.5 134.2 L172.5 137.7 M170.5 97.8 L172.5 94.3"
        {...fine}
      />
      {/* adjustable wrench on the tool's flats */}
      <path d="M170 93 H132 Q124 93 124 101 V130 Q124 138 132 138 H170 V128 H146 V104 H170 Z" />
      <path d="M130 108 V124 M135 108 V124" {...fine} />
      <path d="M124 108 H24 Q16 108 16 116 Q16 124 24 124 H124" />
      <circle cx={28} cy={116} r={3} {...fine} />
      <path d="M174 116 L167 128.1 L153 128.1 L146 116 L153 103.9 L167 103.9 Z" {...solid} />
      <circle cx={160} cy={116} r={5} {...fine} />
      {/* loosening: anticlockwise */}
      <path d="M54.3 85.7 A110 110 0 0 0 54.3 146.3" />
      <path d="M47.3 140 L54.3 146.3 L56.9 137.2" />

      <path d="M285 55 L232 67" {...leader} />
      <circle data-callout="1" cx={296} cy={52} r={11} />
      <text x={296} y={52} {...calloutText}>
        1
      </text>
      <path d="M160 209 V140" {...leader} />
      <circle data-callout="2" cx={160} cy={220} r={11} />
      <text x={160} y={220} {...calloutText}>
        2
      </text>
      <path d="M37 69 L50 82" {...leader} />
      <circle data-callout="3" cx={30} cy={61} r={11} />
      <text x={30} y={61} {...calloutText}>
        3
      </text>
    </GuideIllustrationFrame>
  );
}
