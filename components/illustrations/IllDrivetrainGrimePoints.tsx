import { calloutText, GuideIllustrationFrame } from "./guide-frame";
import { fine, leader, solid, tint } from "./guide-shapes";
import type { IllustrationProps } from "./placeholder";

/**
 * `drivetrain-grime-points` — a drivetrain seen from the drive side, the
 * front to the right: the chainring and crank, the chain's upper and lower
 * runs, the cassette as concentric sprockets and the rear derailleur's cage
 * with its two jockey wheels. The dark specks are where grime packs in:
 * between the sprockets, at the chainring teeth and on the jockey wheels.
 */
export function IllDrivetrainGrimePoints(props: IllustrationProps) {
  return (
    <GuideIllustrationFrame id="drivetrain-grime-points" placeholder={false} {...props}>
      {/* cassette: largest sprocket's teeth, the smaller sprockets, axle */}
      <path d="M92.2 50.1 A42 42 0 0 1 64.7 129" strokeWidth={4} strokeDasharray="2.5 2.5" />
      <circle cx={74} cy={88} r={33} {...fine} />
      <circle cx={74} cy={88} r={24} {...fine} />
      <circle cx={74} cy={88} r={15} {...fine} />
      <circle cx={74} cy={88} r={6} />
      {/* chainring: teeth, ring, spider */}
      <path d="M230.7 201.7 A52 52 0 1 1 244.7 98.7" strokeWidth={4} strokeDasharray="2.5 2.5" />
      <circle cx={236} cy={150} r={38} {...fine} />
      <path
        d="M243.1 157.1 L262.9 176.9 M228.9 157.1 L209.1 176.9 M228.9 142.9 L209.1 123.1 M243.1 142.9 L262.9 123.1"
        {...fine}
      />
      {/* chain over the cassette, through the derailleur and round the chainring */}
      <path
        d="M251.8 100.4 L86.7 48 A42 42 0 0 0 59.1 127.3 L99.6 142.7 A10 10 0 0 1 103 159.1 L71 190.9 A10 10 0 0 0 78.4 208 L238 202 A52 52 0 0 0 251.8 100.4"
        strokeWidth={5}
        strokeDasharray="5 2"
        strokeLinecap="butt"
      />
      {/* crank */}
      <path d="M231.5 157.8 L285 185.2 A6 6 0 0 0 291 174.8 L240.5 142.2 Z" {...solid} />
      <circle cx={236} cy={150} r={9} />
      {/* derailleur cage and its two jockey wheels */}
      <circle cx={96} cy={152} r={8} strokeWidth={3} strokeDasharray="1.6 1.6" />
      <circle cx={78} cy={198} r={8} strokeWidth={3} strokeDasharray="1.6 1.6" />
      <path
        d="M109 157.1 L91 203.1 A14 14 0 0 1 65 192.9 L83 146.9 A14 14 0 0 1 109 157.1 Z"
        {...tint}
      />
      <circle cx={96} cy={152} r={2.5} {...solid} />
      <circle cx={78} cy={198} r={2.5} {...solid} />
      {/* grime: between the sprockets, at the chainring teeth, on the jockey wheels */}
      <path
        d="M93.8 55.9 A1.4 1.4 0 1 0 96.6 55.9 A1.4 1.4 0 1 0 93.8 55.9 M105.7 68.3 A0.9 0.9 0 1 0 107.5 68.3 A0.9 0.9 0 1 0 105.7 68.3 M110.9 83.4 A0.9 0.9 0 1 0 112.7 83.4 A0.9 0.9 0 1 0 110.9 83.4 M109.1 100 A0.9 0.9 0 1 0 110.9 100 A0.9 0.9 0 1 0 109.1 100 M98.8 113.9 A1.4 1.4 0 1 0 101.6 113.9 A1.4 1.4 0 1 0 98.8 113.9 M87.9 122.7 A1.4 1.4 0 1 0 90.7 122.7 A1.4 1.4 0 1 0 87.9 122.7 M73.9 125.4 A0.9 0.9 0 1 0 75.7 125.4 A0.9 0.9 0 1 0 73.9 125.4 M92.6 68.5 A0.9 0.9 0 1 0 94.4 68.5 A0.9 0.9 0 1 0 92.6 68.5 M100.8 79.6 A0.9 0.9 0 1 0 102.6 79.6 A0.9 0.9 0 1 0 100.8 79.6 M102.4 90.9 A0.9 0.9 0 1 0 104.2 90.9 A0.9 0.9 0 1 0 102.4 90.9 M97.5 102 A0.9 0.9 0 1 0 99.3 102 A0.9 0.9 0 1 0 97.5 102 M88.1 110.9 A1.4 1.4 0 1 0 90.9 110.9 A1.4 1.4 0 1 0 88.1 110.9 M76.1 115.8 A0.9 0.9 0 1 0 77.9 115.8 A0.9 0.9 0 1 0 76.1 115.8 M89.6 76.6 A0.9 0.9 0 1 0 91.4 76.6 A0.9 0.9 0 1 0 89.6 76.6 M91.6 92.2 A0.9 0.9 0 1 0 93.4 92.2 A0.9 0.9 0 1 0 91.6 92.2 M78.7 106.3 A1.4 1.4 0 1 0 81.5 106.3 A1.4 1.4 0 1 0 78.7 106.3"
        {...solid}
      />
      <path
        d="M212.1 189.7 A1.4 1.4 0 1 0 214.9 189.7 A1.4 1.4 0 1 0 212.1 189.7 M203.9 184.9 A0.9 0.9 0 1 0 205.7 184.9 A0.9 0.9 0 1 0 203.9 184.9 M195 173.1 A1.4 1.4 0 1 0 197.8 173.1 A1.4 1.4 0 1 0 195 173.1 M190 162.3 A1.4 1.4 0 1 0 192.8 162.3 A1.4 1.4 0 1 0 190 162.3 M188.6 148.7 A0.9 0.9 0 1 0 190.4 148.7 A0.9 0.9 0 1 0 188.6 148.7 M189.5 135.7 A1.4 1.4 0 1 0 192.3 135.7 A1.4 1.4 0 1 0 189.5 135.7 M198.9 120.4 A0.9 0.9 0 1 0 200.7 120.4 A0.9 0.9 0 1 0 198.9 120.4 M207.2 112.8 A0.9 0.9 0 1 0 209 112.8 A0.9 0.9 0 1 0 207.2 112.8 M221.7 105.7 A0.9 0.9 0 1 0 223.5 105.7 A0.9 0.9 0 1 0 221.7 105.7"
        {...solid}
      />
      <path
        d="M99.8 154 A1 1 0 1 0 101.8 154 A1 1 0 1 0 99.8 154 M90.4 154.4 A1 1 0 1 0 92.4 154.4 A1 1 0 1 0 90.4 154.4 M94.6 146.8 A1 1 0 1 0 96.6 146.8 A1 1 0 1 0 94.6 146.8 M81.7 200.2 A1 1 0 1 0 83.7 200.2 A1 1 0 1 0 81.7 200.2 M72.7 200.9 A1 1 0 1 0 74.7 200.9 A1 1 0 1 0 72.7 200.9 M77.8 192.9 A1 1 0 1 0 79.8 192.9 A1 1 0 1 0 77.8 192.9"
        {...solid}
      />

      <path d="M137 96 L105 91" {...leader} />
      <circle data-callout="1" cx={148} cy={98} r={11} />
      <text x={148} y={98} {...calloutText}>
        1
      </text>
      <path d="M169 147 L186 146" {...leader} />
      <circle data-callout="2" cx={158} cy={148} r={11} />
      <text x={158} y={148} {...calloutText}>
        2
      </text>
      <path d="M130 176 L106 158 M130 186 L89 199" {...leader} />
      <circle data-callout="3" cx={140} cy={182} r={11} />
      <text x={140} y={182} {...calloutText}>
        3
      </text>
    </GuideIllustrationFrame>
  );
}
