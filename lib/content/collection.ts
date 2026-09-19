/**
 * The compiled guides, typed as `GuideDocument[]` — the ONE import of the
 * content-collections output (`content-collections` → `.content-collections/generated`,
 * tsconfig `paths`).
 *
 * Server side only in practice: pages, `generateStaticParams`, the OG image and
 * (W3) the checkup page read it. The documents carry compiled MDX, so a client
 * component must receive `GuideSummary` objects (`toSummary`) instead — ESLint
 * forbids importing `content-collections` under `components/**`.
 *
 * The generated module exists after `npm run content:build`, or during
 * `next build` / `next dev` once `next.config.ts` wraps the config in
 * `withContentCollections`.
 */
import { allGuides, allLegalPages } from "content-collections";

import type { LegalDocument } from "./legal";
import type { GuideDocument } from "./types";

// The generated type is inferred from the transform's return type, which is
// `GuideDocument` itself; the annotation keeps every consumer on the contract
// type rather than on content-collections' derived one.
export const GUIDES: readonly GuideDocument[] = allGuides;

/** The two legal pages, both locales (`lib/content/legal.ts`). */
export const LEGAL: readonly LegalDocument[] = allLegalPages;
