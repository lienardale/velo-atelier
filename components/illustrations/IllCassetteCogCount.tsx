import { calloutText, GuideIllustrationFrame } from "./guide-frame";
import { fine, leader, solid } from "./guide-shapes";
import type { IllustrationProps } from "./placeholder";

/**
 * `cassette-cog-count` — a cassette seen edge-on from behind the wheel: the
 * hub flange and its spokes on the left, then the sprockets stepping down
 * from the largest, next to the spokes, to the smallest, outboard, and the
 * lockring. The two sprockets whose tooth counts name the cassette are filled.
 */
export function IllCassetteCogCount(props: IllustrationProps) {
  return (
    <GuideIllustrationFrame id="cassette-cog-count" placeholder={false} {...props}>
      {/* axle, hub shell and drive-side flange with its spokes */}
      <path d="M14 122 H80 M237 122 H256" {...fine} />
      <path d="M14 108 H86 M14 136 H86" />
      <rect x={80} y={92} width={8} height={60} rx={3} />
      <path d="M84 94 L46 14 M84 94 L66 14 M84 150 L46 226 M84 150 L66 226" {...fine} />
      {/* freehub body and the spacers seen between the sprockets */}
      <path d="M88 106 H100 M88 138 H100 M224 106 H228 M224 138 H228" />
      <path d="M107 106 H217 M107 138 H217" strokeDasharray="6 7" />
      {/* sprockets, largest to smallest: the two that are counted are filled */}
      <path d="M100 42 L102.5 37 H104.5 L107 42 V202 L104.5 207 H102.5 L100 202 Z" {...solid} />
      <path d="M113 49.5 L115.5 44.5 H117.5 L120 49.5 V194.5 L117.5 199.5 H115.5 L113 194.5 Z" />
      <path d="M126 57 L128.5 52 H130.5 L133 57 V187 L130.5 192 H128.5 L126 187 Z" />
      <path d="M139 67 L141.5 62 H143.5 L146 67 V177 L143.5 182 H141.5 L139 177 Z" />
      <path d="M152 74.5 L154.5 69.5 H156.5 L159 74.5 V169.5 L156.5 174.5 H154.5 L152 169.5 Z" />
      <path d="M165 79.5 L167.5 74.5 H169.5 L172 79.5 V164.5 L169.5 169.5 H167.5 L165 164.5 Z" />
      <path d="M178 84.5 L180.5 79.5 H182.5 L185 84.5 V159.5 L182.5 164.5 H180.5 L178 159.5 Z" />
      <path d="M191 89.5 L193.5 84.5 H195.5 L198 89.5 V154.5 L195.5 159.5 H193.5 L191 154.5 Z" />
      <path d="M204 94.5 L206.5 89.5 H208.5 L211 94.5 V149.5 L208.5 154.5 H206.5 L204 149.5 Z" />
      <path
        d="M217 99.5 L219.5 94.5 H221.5 L224 99.5 V144.5 L221.5 149.5 H219.5 L217 144.5 Z"
        {...solid}
      />
      {/* lockring */}
      <rect x={228} y={102} width={9} height={40} rx={2} />

      <path d="M260 66 L223 95" {...leader} />
      <circle data-callout="1" cx={269} cy={59} r={11} />
      <text x={269} y={59} {...calloutText}>
        1
      </text>
      <path d="M140 28 L107 37" {...leader} />
      <circle data-callout="2" cx={151} cy={25} r={11} />
      <text x={151} y={25} {...calloutText}>
        2
      </text>
    </GuideIllustrationFrame>
  );
}
