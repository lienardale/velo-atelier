# Retailer links

The buying guide and the build list link out to three shops. The links are
plain outbound URLs: **no scraping, no affiliate ids, no click tracking**
(plan §2.5, §5.5). Because Alltricks and Decathlon refuse automated requests,
every link is checked **in a real browser session**, and the date of that check
is recorded as `verifiedAt` in `lib/domain/data/retailers.ts`. No CI job ever
opens these URLs, and a headless fetch never sets `verifiedAt`. The 2026-09-21
pass was made by Claude in the maintainer's own Chrome, at the maintainer's
explicit request (the log below says so); any later pass follows the same
checklist.

While a retailer's `verifiedAt` is `null`, the vendor buttons
(`components/build-list/VendorButtons.tsx`: on every build-list item, and under
the part questions on `/acheter`) carry a small note naming it: "lien non
vérifié récemment" / "link not checked recently" (`shop.outbound.unverified`).
The category cards and the free-text search on `/acheter` show no such note.

## Where things live

| What                                         | File                                                                  |
| -------------------------------------------- | --------------------------------------------------------------------- |
| Templates, category URLs, `verifiedAt`       | `lib/domain/data/retailers.ts`                                        |
| Contract (https only, `{q}` exactly once)    | `lib/domain/schema/retailer.ts` (`RetailerDefSchema`)                 |
| Query text (`cassette 11 vitesses 11-34 hg`) | `lib/domain/engine/buying-guide.ts` (`buildSearchQuery`)              |
| The outbound URL itself                      | `lib/shop/outbound.ts` (`outboundUrl`)                                |
| `/acheter`'s category queries                | `content/shop/categories.yaml` (`query`)                              |
| Retailer names                               | `messages/{fr,en}/parts.json` → `parts.retailers.<id>`                |
| Tests                                        | `tests/unit/domain/buying-guide.test.ts`, `lib/shop/outbound.test.ts` |

## The entries

| Retailer   | Locale | Kind     | Target                                                                                                                    |
| ---------- | ------ | -------- | ------------------------------------------------------------------------------------------------------------------------- |
| Rose Bikes | fr     | search   | `https://www.rosebikes.fr/search?q={q}`                                                                                   |
| Rose Bikes | en     | search   | `https://www.rosebikes.com/search?q={q}`                                                                                  |
| Alltricks  | fr     | category | chains `C-40598-toutes-les-chaines`, brake pads `C-372000-toutes-les-plaquettes`, fallback `C-1239709-composants-de-velo` |
| Alltricks  | en     | category | chains `C-40598-chains`, brake pads `C-372000-toutes-les-plaquettes`, fallback `C-1239709-cycling-components`             |
| Decathlon  | fr     | search   | `https://www.decathlon.fr/search?Ntt={q}`                                                                                 |
| Decathlon  | en     | search   | `https://www.decathlon.co.uk/search?Ntt={q}`                                                                              |

`verifiedAt` is one date per retailer:

| Retailer   | `verifiedAt` | What the date covers                                               |
| ---------- | ------------ | ------------------------------------------------------------------ |
| Rose Bikes | `2026-09-21` | both templates, both queries (FR was first verified on 2026-09-07) |
| Alltricks  | `2026-09-21` | every FR and EN category page and fallback                         |
| Decathlon  | `2026-09-21` | both templates, both queries                                       |

How a link is built (`outboundUrl`):

- **Search retailer**: `{q}` is replaced by `encodeURIComponent(query)`. The
  query depends on where the visitor is — the build list sends
  `buildSearchQuery`'s text for the part (`chaîne 11 vitesses`), a category card
  on `/acheter` sends its `query` from `categories.yaml` (`chaîne vélo` /
  `bike chain`), and the free-text box sends what was typed.
- **Category retailer**: the part's own category page when there is one, the
  fallback otherwise. On Alltricks FR that means chains → `C-40598`, front and
  rear brake pads → `C-372000`, **every other part — the cassette included —
  the fallback** `C-1239709`; Alltricks EN is the same map on `alltricks.com`
  (on that site the brake-pad page's own `rel=canonical` keeps the French slug,
  so the table does too).

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

## The URLs, one by one

Built from `lib/domain/data/retailers.ts` by substitution (`encodeURIComponent`
on the query). This is the list a pass opens; the result column is the
2026-09-21 pass.

| #   | Retailer   | Locale | Checks                                                      | Open                                                                                                                 | 2026-09-21                                                     |
| --- | ---------- | ------ | ----------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------- |
| 1   | Rose Bikes | en     | chain query                                                 | <https://www.rosebikes.com/search?q=chain>                                                                           | pass — chains (Shimano CN-HG40, SRAM Force)                    |
| 2   | Rose Bikes | en     | cassette query                                              | <https://www.rosebikes.com/search?q=cassette%2011%20speed%2011-34%20hg>                                              | pass — 26 results, 11-speed cassettes first                    |
| 3   | Rose Bikes | fr     | chain query                                                 | <https://www.rosebikes.fr/search?q=cha%C3%AEne>                                                                      | pass — 636 results; chain locks rank next to chains            |
| 4   | Rose Bikes | fr     | cassette query                                              | <https://www.rosebikes.fr/search?q=cassette%2011%20vitesses%2011-34%20hg>                                            | pass — 25 results, CS-HG700 / CS-HG800 11 vitesses             |
| 5   | Alltricks  | fr     | category: `chain`                                           | <https://www.alltricks.fr/C-40598-toutes-les-chaines>                                                                | pass — "Chaînes Vélo", 539 articles                            |
| 6   | Alltricks  | fr     | category: `brake-pads-front`, `brake-pads-rear`             | <https://www.alltricks.fr/C-372000-toutes-les-plaquettes>                                                            | pass — "Plaquettes", 1 073 articles                            |
| 7   | Alltricks  | fr     | fallback: every other part, the cassette included           | <https://www.alltricks.fr/C-1239709-composants-de-velo>                                                              | pass — "Tous les composants"                                   |
| 8   | Alltricks  | en     | category: `chain`                                           | <https://www.alltricks.com/C-40598-chains>                                                                           | pass — "Bike Chains", 345 items                                |
| 9   | Alltricks  | en     | category: `brake-pads-front`, `brake-pads-rear`             | <https://www.alltricks.com/C-372000-toutes-les-plaquettes>                                                           | pass — "Brake Pads", 467 items                                 |
| 10  | Alltricks  | en     | fallback: every other part, the cassette included           | <https://www.alltricks.com/C-1239709-cycling-components>                                                             | pass — "All Cycling Components"                                |
| 11  | Decathlon  | fr     | chain query                                                 | <https://www.decathlon.fr/search?Ntt=cha%C3%AEne>                                                                    | pass — 5 685 results, bike chains first                        |
| 12  | Decathlon  | fr     | cassette query                                              | <https://www.decathlon.fr/search?Ntt=cassette%2011%20vitesses%2011-34%20hg>                                          | pass — 694 results, Shimano 105 R7000 11v first                |
| 13  | Decathlon  | en     | chain query                                                 | <https://www.decathlon.co.uk/search?Ntt=chain>                                                                       | pass — 1,259 results, bike chains                              |
| 14  | Decathlon  | en     | cassette query                                              | <https://www.decathlon.co.uk/search?Ntt=cassette%2011%20speed%2011-34%20hg>                                          | pass — 199 results, Shimano 105 CS-R7000 11-speed first        |
| 15  | Alltricks  | fr     | the seed's `chosenProduct` (demo "Révision printemps" list) | <https://www.alltricks.fr/F-32737-chaines/P-486335-chaine_shimano_105_slx_cn_hg601_11v_116_maillons__attache_rapide> | pass — the CN-HG601 11V 116-link chain, in stock (see the log) |

Rows 8–10 replace the single Alltricks EN fallback the table used to carry —
`https://www.alltricks.com/`, the home page, which step 2 does not accept. Row
15 is not a template: it is the product the demo build list records for its
chain (`prisma/seed-data.ts`). The card shows its brand and model, not the link,
so it is checked as data and `verifiedAt` does not cover it.

## Verification log

| Date       | Retailer   | Locale | Who / how                                                           | Result                                                                                                                                                                                                                                      |
| ---------- | ---------- | ------ | ------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 2026-09-07 | Rose Bikes | fr     | human, browser (plan §2.5)                                          | search page for the query — `verifiedAt` set                                                                                                                                                                                                |
| 2026-09-13 | Rose Bikes | fr, en | automated fetch while writing W1-T2                                 | both templates return a search-results page for `chaine` / `chain`; EN still needs the human check above                                                                                                                                    |
| 2026-09-13 | Decathlon  | fr, en | automated fetch while writing W1-T2                                 | HTTP 403 (bot protection) — not verified, `verifiedAt: null`                                                                                                                                                                                |
| 2026-09-13 | Alltricks  | fr     | web search of alltricks.fr category pages                           | category URLs taken from the search index, not opened — `verifiedAt: null`                                                                                                                                                                  |
| 2026-09-21 | Rose Bikes | fr, en | Claude, in the maintainer's Chrome, at the maintainer's request (1) | rows 1–4 pass; closes the EN gap left on 2026-09-07 — `verifiedAt` 2026-09-21                                                                                                                                                               |
| 2026-09-21 | Alltricks  | fr, en | same (1)                                                            | FR rows 5–7 pass. EN FAILED as configured: its only target was the home page. Replaced by the EN category pages of the FR map (rows 8–10, found through alltricks.com's own redirects and canonicals), which pass — `verifiedAt` 2026-09-21 |
| 2026-09-21 | Decathlon  | fr, en | same (1)                                                            | rows 11–14 pass — `verifiedAt` 2026-09-21                                                                                                                                                                                                   |
| 2026-09-21 | (seed)     | fr     | same (1)                                                            | the old seed URL `…/Acheter/chaine-shimano-cn-hg601` answered "aucun produit"; replaced by row 15, which opens the product                                                                                                                  |

(1) A real Chrome session driven by Claude through Claude in Chrome, not a
headless fetch: the maintainer asked for it on 2026-09-21 instead of opening
the pages themselves. The maintainer's normal profile, not a private window;
every consent banner was answered with its refuse option ("Reject",
"Continuer sans accepter", "Disagree to all", "Reject non-essential"); Alltricks
FR's "redirect to alltricks.com?" prompt (raised by the browser's English UI)
was answered No. No sign-in, no cart, no form.

A headless or automated fetch never sets `verifiedAt`: it only tells a person
where to look first.
