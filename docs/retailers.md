# Retailer links

The buying guide and the build list link out to three shops. The links are
plain outbound URLs: **no scraping, no affiliate ids, no click tracking**
(plan §2.5, §5.5). Because Alltricks and Decathlon refuse automated requests,
every link is checked **by a human in a real browser**, and the date of that
check is recorded as `verifiedAt` in `lib/domain/data/retailers.ts`. No CI job
and no agent ever opens these URLs: an automated check never sets `verifiedAt`.

While a retailer's `verifiedAt` is `null`, the vendor buttons on the build list
and on `/acheter` carry a small note naming it: "lien non vérifié récemment" /
"link not checked recently" (`components/build-list/VendorButtons.tsx`,
`shop.outbound.unverified`).

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
| Alltricks  | en     | category | fallback `https://www.alltricks.com/`                                                                                     |
| Decathlon  | fr     | search   | `https://www.decathlon.fr/search?Ntt={q}`                                                                                 |
| Decathlon  | en     | search   | `https://www.decathlon.co.uk/search?Ntt={q}`                                                                              |

`verifiedAt` is one date per retailer:

| Retailer   | `verifiedAt` | What the date covers                                                                 |
| ---------- | ------------ | ------------------------------------------------------------------------------------ |
| Rose Bikes | `2026-09-07` | the FR template, opened by hand; EN only by an automated fetch (the known gap below) |
| Alltricks  | `null`       | nothing yet                                                                          |
| Decathlon  | `null`       | nothing yet                                                                          |

How a link is built (`outboundUrl`):

- **Search retailer**: `{q}` is replaced by `encodeURIComponent(query)`. The
  query depends on where the visitor is — the build list sends
  `buildSearchQuery`'s text for the part (`chaîne 11 vitesses`), a category card
  on `/acheter` sends its `query` from `categories.yaml` (`chaîne vélo` /
  `bike chain`), and the free-text box sends what was typed.
- **Category retailer**: the part's own category page when there is one, the
  fallback otherwise. On Alltricks FR that means chains → `C-40598`, front and
  rear brake pads → `C-372000`, **every other part — the cassette included —
  the fallback**; on Alltricks EN, every part lands on the home page.

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
   an empty result, a 404, a country-selection wall or a captcha. The one
   exception is Alltricks EN, whose fallback is its home page by design: there
   the check is that it opens in English, on `alltricks.com`.
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

## The next pass, URL by URL

Every URL below was built from `lib/domain/data/retailers.ts` by substitution
(`encodeURIComponent` on the query) on 2026-09-21, and none of them has been
opened by a tool. **Rose Bikes FR is not in this pass**: it was verified by
hand on 2026-09-07 (plan §2.5).

| #   | Retailer   | Locale | Checks                                                      | Open                                                                        | Expect                                               |
| --- | ---------- | ------ | ----------------------------------------------------------- | --------------------------------------------------------------------------- | ---------------------------------------------------- |
| 1   | Rose Bikes | en     | chain query                                                 | <https://www.rosebikes.com/search?q=chain>                                  | bicycle chains                                       |
| 2   | Rose Bikes | en     | cassette query                                              | <https://www.rosebikes.com/search?q=cassette%2011%20speed%2011-34%20hg>     | 11-speed cassettes                                   |
| 3   | Alltricks  | fr     | category: `chain`                                           | <https://www.alltricks.fr/C-40598-toutes-les-chaines>                       | bicycle chains                                       |
| 4   | Alltricks  | fr     | category: `brake-pads-front`, `brake-pads-rear`             | <https://www.alltricks.fr/C-372000-toutes-les-plaquettes>                   | brake pads                                           |
| 5   | Alltricks  | fr     | fallback: every other part, the cassette included           | <https://www.alltricks.fr/C-1239709-composants-de-velo>                     | the bike-components section                          |
| 6   | Alltricks  | en     | fallback: every part, chain and cassette included           | <https://www.alltricks.com/>                                                | the shop's home page, in English, on `alltricks.com` |
| 7   | Decathlon  | fr     | chain query                                                 | <https://www.decathlon.fr/search?Ntt=cha%C3%AEne>                           | bicycle chains                                       |
| 8   | Decathlon  | fr     | cassette query                                              | <https://www.decathlon.fr/search?Ntt=cassette%2011%20vitesses%2011-34%20hg> | 11-speed cassettes                                   |
| 9   | Decathlon  | en     | chain query                                                 | <https://www.decathlon.co.uk/search?Ntt=chain>                              | bicycle chains                                       |
| 10  | Decathlon  | en     | cassette query                                              | <https://www.decathlon.co.uk/search?Ntt=cassette%2011%20speed%2011-34%20hg> | 11-speed cassettes                                   |
| 11  | Alltricks  | fr     | the seed's `chosenProduct` (demo "Révision printemps" list) | <https://www.alltricks.fr/Acheter/chaine-shimano-cn-hg601>                  | the Shimano CN-HG601 chain's product page            |

Row 11 is not a template: it is the product the demo build list records for its
chain (`prisma/seed-data.ts`). The card shows its brand and model, not the link,
so it is checked as data — `verifiedAt` does not cover it. If it no longer
lands on that chain, change it in `prisma/seed-data.ts`.

Then, per retailer, step 5 above: when every row of both its locales passed,
its `verifiedAt` becomes the date of the pass; when a row failed, it stays (or
becomes) `null`, and the log says which row and why. Alltricks needs rows 3–6
and Decathlon rows 7–10. For Rose Bikes, rows 1–2 are the EN half of the known
gap: once they pass, both of its locales have been opened by hand.

## Verification log

| Date       | Retailer   | Locale | Who / how                                 | Result                                                                                                   |
| ---------- | ---------- | ------ | ----------------------------------------- | -------------------------------------------------------------------------------------------------------- |
| 2026-09-07 | Rose Bikes | fr     | human, browser (plan §2.5)                | search page for the query — `verifiedAt` set                                                             |
| 2026-09-13 | Rose Bikes | fr, en | automated fetch while writing W1-T2       | both templates return a search-results page for `chaine` / `chain`; EN still needs the human check above |
| 2026-09-13 | Decathlon  | fr, en | automated fetch while writing W1-T2       | HTTP 403 (bot protection) — not verified, `verifiedAt: null`                                             |
| 2026-09-13 | Alltricks  | fr     | web search of alltricks.fr category pages | category URLs taken from the search index, not opened — `verifiedAt: null`                               |

An automated check never sets `verifiedAt`: it only tells a human where to look
first.
