/**
 * A build-list line's `refinement` AT REST — the cap on one answer, and the one
 * rule every reader applies to a stored refinement (`.debug/017` §5.9).
 *
 * A refinement is what the list's form produced for one line: attribute key →
 * the string a control returned (`lib/shop/questions.ts` turns those strings
 * back into the attributes' own types). It is kept in two places — a `Json`
 * column for a saved bike, `va:buildlist:<ref>` for a guest — and both hold
 * whatever an earlier release, another tab or a visitor's DevTools put there.
 *
 * ## One cap
 *
 * {@link MAX_REFINEMENT_VALUE_LENGTH} is the length of one answer everywhere
 * an answer is bounded: the form's text inputs (`maxLength`), the list page's
 * parser, the saved bike's action and loader, the buying guide's prefill, the
 * guest import's contract and its collector. Until 2026-10-13 that was five
 * literals and one absence: the parser, the action, the loader and the prefill
 * said 64, the import's contract said 120, and the INPUT said nothing. A
 * product title pasted into "Référence des plaquettes" was therefore written
 * to `localStorage` whole, and the page — whose parser refused the whole list
 * for one value over 64 — showed "Rien à acheter pour l'instant" from then
 * on, with the card holding the field gone; over 120 characters the import
 * refused the bike as well, on every retry.
 *
 * ## One reader: a bad entry costs that ENTRY
 *
 * {@link refinementOf} keeps the entries that are an answer — a string of at
 * most the cap under a key of at most {@link MAX_REFINEMENT_KEY_LENGTH} — and
 * drops the others, one by one. It never fails: a value that is not an object
 * at all is a line with no refinement, never a line that is lost. This is the
 * rule the saved bike's loader always applied (`liste/load.ts`); the guest
 * list's parser applied the same bounds by refusing the LIST, which is the
 * defect above.
 *
 * Dropped, not cut: a reader that shortened a stored value would show the
 * visitor something they did not type, and half a number is another number.
 * The control is where a value is stopped ({@link clipRefinementText}).
 *
 * Plain TS, no zod and no import: this file is in the list page's bundle, in
 * `/acheter`'s (through `item-prefill.ts`, a route with a tight first-load
 * pin), in the wizard's and in the chunk `/import` loads
 * (`tests/unit/guest/module-graph.test.ts` walks that last one).
 */

/** The longest answer a refinement holds, in UTF-16 code units — what `maxLength` and zod count. */
export const MAX_REFINEMENT_VALUE_LENGTH = 64;

/** The longest key. Keys are the catalogue's attribute keys; nothing a visitor types. */
export const MAX_REFINEMENT_KEY_LENGTH = 64;

/** Is this stored entry an answer — a short string under a short key? */
export function isRefinementEntry(key: string, value: unknown): value is string {
  return (
    typeof value === "string" &&
    key.length <= MAX_REFINEMENT_KEY_LENGTH &&
    value.length <= MAX_REFINEMENT_VALUE_LENGTH
  );
}

/**
 * A stored value, as a refinement: the entries that are answers, or
 * `undefined` when there is none — the value was not an object, or nothing in
 * it could be kept.
 */
export function refinementOf(value: unknown): Record<string, string> | undefined {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return undefined;
  const entries = Object.entries(value).filter(([key, entry]) => isRefinementEntry(key, entry));
  return entries.length === 0 ? undefined : (Object.fromEntries(entries) as Record<string, string>);
}

const HIGH_SURROGATE_FIRST = 0xd800;
const HIGH_SURROGATE_LAST = 0xdbff;

/**
 * What a TEXT control may hand on: `text` as it is when it fits, otherwise its
 * beginning — the same thing `maxLength` leaves of a paste.
 *
 * The inputs carry `maxLength`, so this only ever cuts text that reached the
 * handler past the attribute — a value set by something that is not typing or
 * pasting, or a browser that did not apply it. Neither was observed: it is the
 * wall behind the attribute, not a description of a browser. Never between the
 * two halves of a surrogate pair — half an emoji is a string a `jsonb` column
 * refuses (`lib/guest/schema.ts`).
 *
 * Not for a number field: a number cut short is another number. Those are held
 * by the form itself, which stores nothing longer than the cap.
 */
export function clipRefinementText(text: string): string {
  if (text.length <= MAX_REFINEMENT_VALUE_LENGTH) return text;
  const last = text.charCodeAt(MAX_REFINEMENT_VALUE_LENGTH - 1);
  const splitsAPair = last >= HIGH_SURROGATE_FIRST && last <= HIGH_SURROGATE_LAST;
  return text.slice(0, MAX_REFINEMENT_VALUE_LENGTH - (splitsAPair ? 1 : 0));
}
