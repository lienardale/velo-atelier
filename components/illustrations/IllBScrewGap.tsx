import { calloutText, GuideIllustrationFrame } from "./guide-frame";
import { fine, leader, solid, tint } from "./guide-shapes";
import type { IllustrationProps } from "./placeholder";

/**
 * `b-screw-gap` — a rear derailleur seen from the drive side, shifted onto the
 * largest sprocket: the hanger with the axle and the mounting bolt, the B-screw
 * at the back of the derailleur bearing on the hanger, the body and the cage,
 * and the small gap between the upper jockey wheel's teeth and the teeth of the
 * largest sprocket above it. The chain is left out so the gap stays visible;
 * the gap is drawn about twice its real size.
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
      {/* hanger, with the axle and the derailleur's mounting bolt */}
      <path d="M136 12 H166 V42 Q162 60 146 62 H136 Q130 61 131 54 Z" {...tint} />
      <circle cx={150} cy={24} r={6} />
      <circle cx={149} cy={48} r={8} />
      {/* B-screw at the back, its tip on the hanger */}
      <rect x={104} y={53} width={24} height={10} rx={3} {...solid} />
      <path d="M128 58 H132" strokeWidth={3} />
      {/* parallelogram body and cage pivot */}
      <path d="M156 56 L202 64 L212 104 L176 112 Z" />
      <circle cx={176} cy={118} r={4} {...solid} />
      {/* cage with the upper and lower jockey wheels */}
      <path
        d="M169.5 137.2L149.5 203.2A12 12 0 0 1 126.5 196.2L146.5 130.2A12 12 0 0 1 169.5 137.2Z"
        {...tint}
      />
      <path
        d="M153.5 113.2L159.4 112.8L161.5 117.6L163.7 118.2L165.3 114L170.5 116.9L169.6 122L171.2 123.8L174.8 121.1L177.6 126.3L174.1 130.2L174.4 132.5L178.9 132.2L178.5 138.2L173.4 139.5L172.5 141.6L176.4 143.8L172.8 148.5L167.9 146.9L165.9 148.2L168.1 152.1L162.5 154.2L159.2 150.2L156.8 150.2L156.5 154.7L150.7 153.4L150.1 148.2L148.1 146.9L145.4 150.5L141.2 146.3L143.5 141.6L142.5 139.5L138.3 141.1L137 135.2L141.5 132.6L141.8 130.2L137.4 129.3L139.5 123.7L144.8 123.8L146.3 122.1L143.1 118.9L147.9 115.3L152.2 118.3L154.4 117.6Z"
        strokeWidth={1.5}
      />
      <path
        d="M158.7 203L156.9 208.7L151.7 208.8L150.3 210.7L153.6 213.7L149.1 217.5L144.6 214.8L142.4 215.6L143.6 219.9L137.7 220.7L135.4 216L133.1 215.5L131.8 219.8L126.4 217.2L127 212L125.4 210.3L121.9 213.2L118.7 208.2L122.1 204.1L121.6 201.8L117.1 202.4L117.2 196.4L122.2 194.8L123.1 192.6L119 190.7L122.3 185.7L127.4 187.1L129.3 185.7L126.9 181.9L132.3 179.5L135.9 183.3L138.2 183.2L138.3 178.7L144.2 179.6L145 184.8L147.1 186L149.6 182.2L154 186.2L152 191L153.1 193.1L157.2 191.3L158.8 197L154.5 199.9L154.3 202.3Z"
        strokeWidth={1.5}
      />
      <circle cx={158} cy={133.7} r={4} />
      <circle cx={138} cy={199.7} r={4} />
      {/* the gap, jockey teeth to sprocket teeth */}
      <path
        d="M155.6 100.8L156.5 112.8M153.3 104.5L155.6 100.8L158.3 104.1M153.7 109.5L156.5 112.8L158.7 109.1"
        {...fine}
      />

      <path d="M57 58 H104" {...leader} />
      <circle data-callout="1" cx={46} cy={58} r={11} />
      <text x={46} y={58} {...calloutText}>
        1
      </text>
      <path d="M103 125 L152 108" {...leader} />
      <circle data-callout="2" cx={92} cy={129} r={11} />
      <text x={92} y={129} {...calloutText}>
        2
      </text>
    </GuideIllustrationFrame>
  );
}
