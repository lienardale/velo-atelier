# Retailer links

The buying guide and the build list link out to three shops. The links are
plain outbound URLs: **no scraping, no affiliate ids, no click tracking**
(plan §2.5, §5.5). Because Alltricks and Decathlon refuse automated requests,
every link is checked **by a human in a real browser**, and the date of that
check is recorded as `verifiedAt` in `lib/domain/data/retailers.ts`.

When `verifiedAt` is `null`, the shop page shows a small "lien non vérifié
récemment / link not recently verified" note next to the retailer.

## Where things live

| What                                         | File                                                     |
| -------------------------------------------- | -------------------------------------------------------- |
| Templates, category URLs, `verifiedAt`       | `lib/domain/data/retailers.ts`                           |
| Contract (https only, `{q}` exactly once)    | `lib/domain/schema/retailer.ts` (`RetailerDefSchema`)    |
| Query text (`cassette 11 vitesses 11-34 hg`) | `lib/domain/engine/buying-guide.ts` (`buildSearchQuery`) |
| Retailer names                               | `messages/{fr,en}/parts.json` → `parts.retailers.<id>`   |
| Tests                                        | `tests/unit/domain/buying-guide.test.ts`                 |

## The entries

| Retailer   | Locale | Kind     | Target                                                                                                                    |
| ---------- | ------ | -------- | ------------------------------------------------------------------------------------------------------------------------- |
| Rose Bikes | fr     | search   | `https://www.rosebikes.fr/search?q={q}`                                                                                   |
| Rose Bikes | en     | search   | `https://www.rosebikes.com/search?q={q}`                                                                                  |
| Alltricks  | fr     | category | chains `C-40598-toutes-les-chaines`, brake pads `C-372000-toutes-les-plaquettes`, fallback `C-1239709-composants-de-velo` |
| Alltricks  | en     | category | fallback `https://www.alltricks.com/`                                                                                     |
| Decathlon  | fr     | search   | `https://www.decathlon.fr/search?Ntt={q}`                                                                                 |
| Decathlon  | en     | search   | `https://www.decathlon.co.uk/search?Ntt={q}`                                                                              |

## Manual verification checklist

Do this before launch, after any change to `retailers.ts`, and at least once a
quarter. Use a normal browser session (not a headless tool: the shops block
those), in a private window so no cookie or login changes the result.

For **each retailer and each locale**:

1. Build the URL by hand: replace `{q}` with the encoded query for a chain —
   `cha%C3%AEne` in French, `chain` in English. For a category entry, open the
   URL for `chain` (or the fallback when there is none).
2. Open it. The page must be a list of products that are bicycle chains (or,
   for a fallback, the bike-components section of the shop) — not a home page,
   an empty result, a 404, a country-selection wall or a captcha.
3. Repeat with `cassette 11 vitesses 11-34 hg` (FR) / `cassette 11 speed 11-34 hg`
   (EN), the query from plan §5.8. The results should contain 11-speed cassettes.
4. Check the address bar: still `https://`, still the domain in the table, no
   redirect to another country store.
5. If everything holds, set `verifiedAt` to today's date (`YYYY-MM-DD`) for
   that retailer and add a row to the log below. If anything fails, fix the
   template or category URL (or set `verifiedAt: null`) and note why.

`verifiedAt` is per retailer, so set it only when **both** locales passed.
(Known gap: Rose Bikes carries the 2026-09-07 date of the FR check recorded in
the plan; its EN template has only been confirmed by an automated fetch and is
the first item of the next human pass.)

## Verification log

| Date       | Retailer   | Locale | Who / how                                 | Result                                                                                                   |
| ---------- | ---------- | ------ | ----------------------------------------- | -------------------------------------------------------------------------------------------------------- |
| 2026-09-07 | Rose Bikes | fr     | human, browser (plan §2.5)                | search page for the query — `verifiedAt` set                                                             |
| 2026-09-13 | Rose Bikes | fr, en | automated fetch while writing W1-T2       | both templates return a search-results page for `chaine` / `chain`; EN still needs the human check above |
| 2026-09-13 | Decathlon  | fr, en | automated fetch while writing W1-T2       | HTTP 403 (bot protection) — not verified, `verifiedAt: null`                                             |
| 2026-09-13 | Alltricks  | fr     | web search of alltricks.fr category pages | category URLs taken from the search index, not opened — `verifiedAt: null`                               |

An automated check never sets `verifiedAt`: it only tells a human where to look
first.
