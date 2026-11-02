import { calloutText, GuideIllustrationFrame } from "./guide-frame";
import { fine, leader, solid, tint } from "./guide-shapes";
import type { IllustrationProps } from "./placeholder";

/**
 * `b-screw-gap` — a rear derailleur seen from the drive side, shifted onto the
 * largest sprocket: the hanger with the axle and the mounting bolt, the upper
 * knuckle pivoting on that bolt with the B-screw in a boss at its back, the
 * screw's tip bearing on a tab of the hanger, then the body and the cage, and
 * the small gap between the upper jockey wheel's teeth and the teeth of the
 * largest sprocket above it. The chain is left out so the gap stays visible;
 * the gap is drawn at about 7 mm, a little over its real 5 to 6 mm.
 */
export function IllBScrewGap(props: IllustrationProps) {
  return (
    <GuideIllustrationFrame id="b-screw-gap" placeholder={false} {...props}>
      {/* cassette: the largest sprocket with its teeth, smaller ones inside */}
      <path
        d="M226.5 15.6L222.3 18.7L222.5 21.5L227 21.3L226.9 27.1L222.3 29.6L222 32.3L226.5 32.8L225.6 38.5L220.6 40.3L220 42.9L224.3 44.1L222.6 49.6L217.4 50.6L216.4 53.1L220.5 54.9L218 60.1L212.7 60.4L211.3 62.7L215.1 65.1L211.9 69.9L206.6 69.3L204.8 71.4L208.3 74.4L204.3 78.6L199.2 77.3L197.2 79.1L200.1 82.5L195.6 86.1L190.7 84L188.4 85.5L190.8 89.3L185.8 92.2L181.3 89.4L178.8 90.5L180.6 94.6L175.3 96.7L171.2 93.3L168.6 94.1L169.8 98.4L164.1 99.7L160.6 95.7L158 96.1L158.4 100.5L152.7 101L149.8 96.5L147.1 96.4L146.9 100.9L141.2 100.5L139 95.7L136.4 95.2L135.5 99.6L129.9 98.3L128.5 93.2L125.9 92.4L124.4 96.6L119.1 94.5L118.4 89.2L116 88L113.9 92L108.9 89.1L109 83.8L106.8 82.2L104.1 85.9L99.6 82.3L100.6 77L98.6 75.2L95.4 78.3L91.5 74.1L93.2 69.1L91.6 66.9L87.9 69.6L84.7 64.8L87.1 60.1L85.8 57.7L81.8 59.8L79.4 54.6L82.5 50.3L81.5 47.8L77.3 49.3L75.6 43.8L79.3 40L78.7 37.3L74.3 38.1L73.5 32.4L77.7 29.3L77.5 26.5L73 26.7L73.1 20.9L77.7 18.4L78 15.7L73.5 15.2"
        strokeWidth={1.5}
      />
      <path
        d="M85.1 12A66 66 0 1 0 214.9 12 M95.3 12A56 56 0 1 0 204.7 12 M104.6 12A47 47 0 1 0 195.4 12"
        {...fine}
        strokeOpacity={0.5}
      />
      {/* hanger, with the axle, the derailleur's mounting bolt and a tab at the back */}
      <path
        d="M138 12 H166 V42 Q162 60 148 62 H140 V56 H124 Q120 56 120 53 Q120 50 124 50 H138 Z"
        {...tint}
      />
      <circle cx={150} cy={24} r={6} />
      {/* upper knuckle on the bolt, its boss at the back holding the B-screw */}
      <path
        d="M149 35 A13 13 0 0 1 161 53 L150 76 H120 Q114 76 114 71 V69 Q114 64 120 64 H134 Q137 60 136.2 50.5 A13 13 0 0 1 149 35 Z"
        {...tint}
      />
      <circle cx={149} cy={48} r={7} />
      {/* B-screw: head under the boss, tip bearing on the hanger tab */}
      <rect x={123} y={56} width={6} height={8} {...solid} />
      <path d="M123 59 H129 M123 62 H129" {...fine} />
      <path d="M126 76 V78" strokeWidth={4} />
      <rect x={118} y={78} width={16} height={6} rx={2} {...solid} />
      {/* parallelogram body and cage pivot */}
      <path d="M156 60 L202 66 L210 100 L174 106 Z" />
      <circle cx={174} cy={112} r={4} {...solid} />
      {/* cage with the upper and lower jockey wheels */}
      <path
        d="M169.2 133.2L149.2 199.2A12 12 0 0 1 126.2 192.2L146.2 126.2A12 12 0 0 1 169.2 133.2Z"
        {...tint}
      />
      <path
        d="M153.2 109.2L159.2 108.8L161.2 113.6L163.4 114.3L165 110L170.3 112.9L169.3 118L170.9 119.8L174.5 117.1L177.4 122.4L173.8 126.2L174.1 128.5L178.6 128.2L178.2 134.2L173.2 135.5L172.2 137.6L176.1 139.8L172.6 144.6L167.6 142.9L165.6 144.2L167.8 148.1L162.2 150.2L158.9 146.2L156.5 146.2L156.2 150.7L150.4 149.4L149.8 144.2L147.8 142.9L145.1 146.5L140.9 142.3L143.2 137.6L142.2 135.5L138 137.1L136.7 131.2L141.2 128.6L141.6 126.2L137.2 125.3L139.2 119.7L144.5 119.8L146 118.1L142.8 114.9L147.6 111.3L151.9 114.3L154.2 113.6Z"
        strokeWidth={1.5}
      />
      <path
        d="M158.4 199L156.7 204.7L151.4 204.8L150 206.7L153.4 209.7L148.8 213.5L144.3 210.8L142.1 211.6L143.3 216L137.4 216.7L135.1 212L132.8 211.5L131.5 215.8L126.1 213.2L126.7 208L125.1 206.3L121.6 209.2L118.5 204.2L121.8 200.1L121.3 197.8L116.9 198.4L116.9 192.4L121.9 190.8L122.8 188.7L118.7 186.7L122 181.7L127.1 183.1L129 181.7L126.6 177.9L132.1 175.5L135.6 179.4L137.9 179.2L138 174.7L143.9 175.7L144.8 180.8L146.8 182L149.3 178.2L153.8 182.2L151.7 187L152.8 189.1L156.9 187.3L158.5 193L154.2 196L154 198.3Z"
        strokeWidth={1.5}
      />
      <circle cx={157.7} cy={129.7} r={4} />
      <circle cx={137.7} cy={195.7} r={4} />
      {/* the gap, jockey teeth to sprocket teeth */}
      <path
        d="M155.6 100.8L156.2 108.8M153.6 103.9L155.6 100.8L158 103.6M153.8 105.9L156.2 108.8L158.1 105.6"
        {...fine}
      />

      <path d="M71 81 H118" {...leader} />
      <circle data-callout="1" cx={60} cy={81} r={11} />
      <text x={60} y={81} {...calloutText}>
        1
      </text>
      <path d="M102 122 L152 105" {...leader} />
      <circle data-callout="2" cx={92} cy={125} r={11} />
      <text x={92} y={125} {...calloutText}>
        2
      </text>
    </GuideIllustrationFrame>
  );
}
