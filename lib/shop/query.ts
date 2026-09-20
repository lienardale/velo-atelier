/**
 * What gets typed into a shop's search box (§2.5, §5.5).
 *
 * The contract, pinned character for character by §5.8 AC5:
 *
 *   buildQuery("cassette", { speeds: 11, range: "11-34", freehub: "hg" }, "fr")
 *   → "cassette 11 vitesses 11-34 hg"
 *   …and the same thing in English → "cassette 11 speed 11-34 hg"
 *
 * `[partLabel, speeds + t("speeds"), range, freehub, …].filter(Boolean).join(" ")`,
 * with a brand appended only when the visitor picked one. The assembly itself
 * belongs to the domain (`buildSearchQuery`, which owns the per-part list of
 * attributes worth searching on and the order they are typed in); this module
 * is the shop's entry point to it, and the place the free-text box is cleaned.
 *
 * **Answers arrive typed, not as form strings.** A refinement comes back from a
 * `<select>`, from `localStorage` or from a `Json` column as a string, and the
 * domain's attribute values are typed (`speeds: 11`, `e-rated: false`). It is
 * `lib/shop/questions.ts` (`refinementAnswers`) that puts each value back into
 * the type its attribute declares, so the value the compatibility rules compare
 * and the value this query spells are the same one; `buildQuery` takes that
 * output, not the raw map.
 *
 * Client-safe: no zod, no `node:fs`. It reaches the part catalogue and the
 * `parts` message files through the domain, which the build list already
 * carries.
 */
import type { PartId } from "@/lib/domain/data/parts";
import { buildSearchQuery } from "@/lib/domain/engine/buying-guide";
import type { AttributeValue } from "@/lib/domain/schema/part";
import type { Locale } from "@/lib/i18n/routing";

/** The refinement answers a query is built from, in the attributes' own types. */
export type QueryAnswers = Readonly<Record<string, AttributeValue>>;

export interface QueryOptions {
  /**
   * A brand or product range the visitor chose, appended last (§2.5). Never a
   * tier id: "mid" is not something a shop's search box understands.
   */
  brand?: string;
}

/**
 * The longest query we will put in a URL.
 *
 * Only the free-text box can reach it — a built query is bounded by the part
 * label plus three or four attribute values. It is a guard against a pasted
 * essay becoming a 4 kB outbound URL, not a validation rule: the text is
 * trimmed, never rejected.
 */
export const QUERY_MAX_LENGTH = 120;

/**
 * The search terms for one part.
 *
 * `answers` are the attributes as the bike (or the visitor's refinement) has
 * them; anything the part does not search on is ignored by the domain.
 */
export function buildQuery(
  partId: PartId,
  answers: QueryAnswers,
  locale: Locale,
  options: QueryOptions = {},
): string {
  return buildSearchQuery(partId, { ...answers }, locale, options.brand);
}

/**
 * Clean what a visitor typed into the free-text box before it becomes a URL.
 *
 * Collapses whitespace (including the newlines a paste brings), drops the
 * control characters that would otherwise be percent-encoded into noise, and
 * caps the length. Returns `""` for anything that is not usable text, which is
 * the signal to the caller that there is no query to link to.
 */
export function normalizeQuery(raw: unknown): string {
  if (typeof raw !== "string") return "";
  return raw
    .replace(/[\p{Cc}\p{Cf}]+/gu, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, QUERY_MAX_LENGTH)
    .trim();
}
