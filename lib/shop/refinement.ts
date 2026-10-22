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
 * parser, the saved bike's action — its schema, and the reader behind the
 * buying guide's prefill — and its loader, the guest's prefill, the guest
 * import's contract and its collector. Until 2026-10-13 that was SIX literals
 * and one absence: the parser, the action's schema, the action's own reader,
 * the loader and the guest's prefill said 64, the import's contract said 120,
 * and the INPUT said nothing. A product title pasted into "Référence des
 * plaquettes" was therefore written to `localStorage` whole, and the page —
 * whose parser refused the whole list for one value over 64 — showed "Rien à
 * acheter pour l'instant" from then on, with the card holding the field gone;
 * over 120 characters the import refused the bike as well, on every retry.
 *
 * ## One key
 *
 * {@link isRefinementKey} is what an answer may be stored UNDER: the shape of
 * the catalogue's attribute keys, and none of the three names that mean
 * something to an object. The saved bike's action refuses any other key, and
 * so does the import's contract (which also stops at 40 characters). Until
 * 2026-10-13 each wrote the shape out for itself and only the action refused
 * the names: a guest's line holding `constructor` was imported, and from then
 * on the action refused every answer given on that line — the page hands back
 * the whole refinement it was given (measured on PostgreSQL in review).
 *
 * ## One reader: a bad entry costs that ENTRY
 *
 * {@link refinementOf} keeps the entries that are an answer — a string of at
 * most the cap under a key of that kind — and drops the others, one by one.
 * It never fails: a value that is not an object at all is a line with no
 * refinement, never a line that is lost. Every reader of a stored refinement
 * is this function: the saved bike's loader (`liste/load.ts`) and the reader
 * behind its `/acheter` prefill (`liste/actions.ts`), the guest list's
 * parser, the guest's prefill, the wizard's merge and the import's collector.
 *
 * The VALUE's rule is the one the loader always applied; the guest list's
 * parser applied the same bound by refusing the LIST, which is the defect
 * above. The KEY's rule is the action's, and the reason is the same one: what
 * a reader hands the page, the page hands back whole with the next edit, so
 * an entry the writer refuses must not be read — or the line can never be
 * edited again. The loader used to keep any key of at most 64 characters
 * (and the action's own reader refused the three names: two readers of one
 * column, two answers). ONE kind of row is read differently for it, and that
 * is the point: a row the import wrote with `constructor` or `prototype`
 * among its keys, which the page is no longer handed. Every other key the
 * application can have written is in the shape — the action and the contract
 * have always held a key to it.
 *
 * ## One count
 *
 * {@link MAX_REFINEMENT_ENTRIES} is how many answers one line holds: the
 * saved bike's action refuses more (`TOO_MANY`), the import's contract
 * refuses more, and {@link refinementOf} hands over no more. Until
 * 2026-10-22 the number was written twice — in `liste/actions.ts` and in
 * `lib/guest/schema.ts` — and the list's LOADER applied no count at all,
 * only the action's own reader did, whose answer is never sent back. A row
 * holding 25 answers was then a line every edit of which was refused
 * `TOO_MANY` until one answer was cleared, and one holding 30 a line where
 * clearing one was refused too (measured on PostgreSQL in the review of the
 * fix; `.debug/017` §5.9). It is the key's reason again: the page hands back
 * whole what it was handed, so the reader must not hand over what the writer
 * refuses.
 *
 * No form of the application writes a 25th answer: a part has far fewer
 * questions than that (`tests/unit/checkup/list-refinement.test.ts` holds
 * every part of the seven presets to the count). A row holding more was
 * written past the form — by hand in DevTools, then imported while the
 * import's contract had no cap on entries: production's had none until
 * PR #27 (merged 2026-10-22), whose branch added it on 2026-10-09.
 * WHICH of its answers are kept is decided by their keys alone, in code-unit
 * order, never by where they sit in the stored object: a `jsonb` column
 * hands keys back shortest first and `localStorage` in the order they were
 * written, and the same entries must give the same answers in both. Nothing
 * better is within this module's reach: it knows no part and no question,
 * so it cannot tell an answer the form shows from one it does not. A row at
 * or under the count is read exactly as before, in its stored order.
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

/**
 * The most answers one line holds — a part has a handful of attributes. The
 * saved bike's action refuses more, the import's contract refuses more, and
 * {@link refinementOf} reads no more.
 */
export const MAX_REFINEMENT_ENTRIES = 24;

/** The catalogue's attribute keys are kebab-case ids, and so is the price tier's. */
const KEY_SHAPE = /^[a-z0-9-]+$/;

/**
 * The names that mean something to an object. `__proto__` is already outside
 * the shape (underscores); the two others are all-lowercase and inside it, so
 * they are refused by name: a refinement is written to a `Json` column and
 * read back into a record, and such a key does not belong in stored data,
 * whatever the reader does with it.
 */
const OBJECT_NAMES: readonly string[] = ["__proto__", "constructor", "prototype"];

/**
 * Is `key` one an answer may be stored under? THE definition: the saved
 * bike's action and the guest import's contract ask it of a key they are
 * sent, and {@link refinementOf} of a key it reads.
 */
export function isRefinementKey(key: string): boolean {
  return (
    key.length >= 1 &&
    key.length <= MAX_REFINEMENT_KEY_LENGTH &&
    KEY_SHAPE.test(key) &&
    !OBJECT_NAMES.includes(key)
  );
}

/** Is this stored entry an answer — a short string under an attribute key? */
export function isRefinementEntry(key: string, value: unknown): value is string {
  return (
    typeof value === "string" && value.length <= MAX_REFINEMENT_VALUE_LENGTH && isRefinementKey(key)
  );
}

/**
 * A stored value, as a refinement: the entries that are answers — at most
 * {@link MAX_REFINEMENT_ENTRIES} of them, the first by key when there are
 * more — or `undefined` when there is none: the value was not an object, or
 * nothing in it could be kept.
 */
export function refinementOf(value: unknown): Record<string, string> | undefined {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return undefined;
  const entries = Object.entries(value).filter(([key, entry]) => isRefinementEntry(key, entry));
  if (entries.length === 0) return undefined;
  if (entries.length <= MAX_REFINEMENT_ENTRIES) {
    return Object.fromEntries(entries) as Record<string, string>;
  }
  // More than a line holds: which ones survive is a property of the keys,
  // never of the store's order. `sort()` compares code units, like the
  // engine does everywhere; the stored order is kept among the survivors.
  const kept = new Set(
    entries
      .map(([key]) => key)
      .sort()
      .slice(0, MAX_REFINEMENT_ENTRIES),
  );
  return Object.fromEntries(entries.filter(([key]) => kept.has(key))) as Record<string, string>;
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
