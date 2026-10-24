# 018 — The fit page's cards re-seeded each other: a save in one card took what was typed in another

**Date** 2026-10-13 · **Status** resolved; §5 open (text typed before React holds the field) ·
**Touches** `components/bike/MeasurementForm.tsx`, `components/bike/MeasurementForm.test.tsx`,
`tests/e2e/fit.spec.ts`, `docs/backlog.md`, `CLAUDE.md`

Pre-existing: the code is `main`'s (`9ae46bf`), not a branch's. Found while
`w5/part-form` was open; that branch does not touch the lines repaired here
(§6).

---

## 1. Symptom

On the fit page (`/velo/[id]/reglages`) a number typed in one card and not yet
saved was lost when ANOTHER card was saved.

**A guest bike** (`/fr/velo/local/reglages?spec=…`): inseam 84 saved in the
saddle-height card, then "72" typed with the keyboard into the rider-weight
field — the field shows "2". And a "7" typed there BEFORE that save is still
"7" after it, then "" on the next key.

**A saved bike**, sooner: "38" typed in the reach card, the saddle-height card
saved — the reach field is empty under the other card's "Enregistré", with no
key pressed.

Some eaten values are still inside their field's range (a sag of "25" that
becomes "5"), so a wrong number could be saved without the form saying
anything. In the measured case it did say something: 2 kg is under the rider's
20 kg minimum and the pressure card's button was disabled.

## 2. Investigation

Playwright 1.63.0, Chromium 153.0.8010.12, a production build with the test
hooks, `desktop-chromium` and `mobile-chromium` — the two gave the same values.
A throwaway probe, typed with `pressSequentially`:

| bike  | step                                             | the field under test |
| ----- | ------------------------------------------------ | -------------------- |
| guest | "3" typed in reach, then the saddle card saved   | `3`                  |
| guest | one more key, "8"                                | **empty**            |
| guest | "72" typed in rider weight, never touched before | **`2`**              |
| saved | "38" typed in reach, then the saddle card saved  | **empty**, at once   |
| saved | 1.5 s later                                      | empty                |
| saved | one more key, "0"                                | `0`                  |

The saved card itself was right in both: inseam `84`, saddle height `742`. The
saved bike's save was ONE request — `POST` to the page's own URL, 200,
`text/x-component`.

jsdom, two `MeasurementForm`s over one bike, the unfixed form:

| bike  | step                                                         | result                                            |
| ----- | ------------------------------------------------------------ | ------------------------------------------------- |
| guest | "7" in rider weight, saddle card saved, then "2"             | `7`, then **empty**                               |
| guest | the pressure card saved after that                           | "Enregistré", and no `riderKg` in `va:bike:local` |
| saved | a new `fit` prop while "72" is typed in another card         | **empty**                                         |
| saved | one card, saved, and NO new prop (nothing re-renders a page) | its own inputs **empty** under "Enregistré"       |

## 3. Root cause

`MeasurementForm` kept `stored`, the record its inputs were seeded from, and on
every render:

```ts
if (stored !== known) {
  setStored(known);
  setDraft(draftOf(fields, known));
}
```

— every field of the card, whatever had been typed in it. And `known` changes
for reasons that are not this card's:

1. **Another card of a guest bike is saved.** `known` comes from
   `useLocalBikeSnapshot()`, whose snapshot is re-read at every render. The
   save writes `va:bike:local` in THIS tab, which fires no `storage` event, so
   nothing renders the other cards: each notices at its own next render, and
   that is the visitor's next keystroke there. That render already holds the
   keystroke in `draft`, and replaced `draft`. Hence one key eaten, with
   everything typed before it — and why it takes a keyboard to see it.
2. **Another card of a saved bike is saved.** `updateBikeFitAction` calls
   `revalidatePath`, the action's answer carries the page again, and every card
   is handed a fresh `fit` object. No keystroke needed.
3. **The guest bike is read for the first time**, in the render after
   hydration (the hook's server snapshot is "pending"). This is `.debug/015`
   §2's `mobile-webkit` row with React already attached. Not reproduced in a
   browser this time — nothing can place a keystroke between a hydration and
   the render it schedules — but in jsdom, with the hook held at "pending".
4. **Another tab saves** (the `storage` event), for a guest.

One more, which only jsdom showed: after its own save the card did
`setStored(result.data)`, which made `stored !== known` true again at the next
render and re-seeded from `known` — for a saved bike, the `fit` it was mounted
with. A browser hides it, because reason 2 delivers a fresh `fit` in the same
breath; anything that kept the page from rendering again would have shown an
empty card under "Enregistré".

## 4. Fix

The form no longer asks "has the record changed" for the card, but, for each
field, "is this still what the record showed" (`follow()`):

- a field that still shows what was on record **follows** the record;
- a field showing anything else — emptied by hand included — is the visitor's,
  and is left exactly as typed until THIS card is saved;
- a save shows what was stored (not always what was typed: `patchFor` stores
  the formula's saddle height) in every field **left alone since the save was
  sent**; a field typed in while the save was on its way is a new number, not
  saved;
- **another bike** in the record's place re-seeds the whole card, as before: a
  guest bike with another id in the slot, or one where there was none; another
  saved bike. What was typed was typed for the first.

Four decisions in that, each pinned by a test:

- **Compared as the text in the input**, not through a "touched" flag. A
  number typed and then deleted is an untouched field again, and there is no
  state that can disagree with what is on screen. It has two corners, both
  left as they are: a number typed and not saved that the record then comes to
  hold (another tab saved the same one) is an untouched field from there on,
  and follows the next change; and a number input reports "" for text it
  cannot read (a lone "-"), so a half-typed field over an empty record counts
  as untouched until it reads as a number.
- **`Card.shown` is not `Card.known`.** `known` is the record as last read,
  compared by identity to notice that it was read again; `shown` is what an
  untouched field shows — `known`, or what this card stored since. Keeping
  them apart is what repairs the last paragraph of §3: a save no longer makes
  the card look changed to itself.
- **Neither the first read nor the removal is another bike.** `Card.owner` is
  the guest bike's own id, `null` for no bike, and `LOCAL_BIKE_PENDING` until
  storage has been read. Leaving "pending" follows field by field (reason 3).
  So does the bike going away — the guest import in another tab clears the
  slot — because nothing has taken its place: what was typed stays (it cannot
  be saved, and the card says "Introuvable."), and the fields nobody typed in
  go empty with the record. The bike that comes next is another one.
- **A save on its way follows the record too** (`Card.sent`), see §7.

After, same build flags — `fit.spec.ts` on `desktop-chromium`,
`mobile-chromium`, `mobile-landscape` and `no-webgl` on the host, and on
`mobile-webkit` and `mobile-chromium` in CI's Linux image
(`npm run e2e:docker`); the counts are in §7:

| bike  | step                                                     | the field under test                                                                   |
| ----- | -------------------------------------------------------- | -------------------------------------------------------------------------------------- |
| guest | "38" typed in reach, the saddle card saved, then "0"     | `38`, then `380`                                                                       |
| guest | "72" typed in rider weight after the save                | `72`                                                                                   |
| guest | the pressure card saved with bike weight 9               | `va:bike:local.fit` is `{ inseamCm: 84, saddleHeightMm: 742, riderKg: 72, bikeKg: 9 }` |
| saved | "38" typed in reach, the saddle card saved, then "0"     | `38`, then `380`                                                                       |
| saved | a rider weight of 68 written to the row before that save | `68` in its untouched field                                                            |

The fit route's first-load JS with the hooks went from 212.8 KiB to 213.0 KiB
(budget 234.0 KiB).

## 5. Open: text typed before React holds the field

Not repaired here, and measured again on the repaired form: with the JS chunks
held back 3 s, "380" typed into the reach field at 72 ms and at 297 ms (React
not attached) was on screen, and the field was **empty** after hydration and
the first read — while the stored inseam, 80, had arrived in its own field.

That text is in the DOM only (react-dom 19.2.8, `.debug/015` §9), so the form
has never seen it typed and there is nothing for `follow()` to keep: the first
render after hydration writes the state back over it. It is the first half of
the backlog entry "A controlled input on a prerendered page drops text typed
before hydration" — read the field's DOM value into state on mount — and it is
every controlled input's, not this form's. What this repair closed is the
window AFTER React attached and before the guest bike was read.

## 6. `w5/part-form`, and PR #27

Open, not merged, when this was written (`9efff1f`). It rebuilds the form's
repo for the guest bike its inputs were seeded from, and pins in
`MeasurementForm.test.tsx` ("a guest bike's fit goes to the bike the inputs
were seeded from") that another guest bike in the slot re-seeds the inputs and
that a save for the first is refused. The rule here is the same one: another
id is another bike, and re-seeds whole.

A trial merge of `9efff1f` into this change, in a throwaway branch: the form,
its test file, `fit.spec.ts`, `CLAUDE.md` and `docs/backlog.md` merge without
conflict (the two import lines both sides edit in the test file are edited
identically, on purpose); `tsc` and ESLint are clean on the merged tree; and
`MeasurementForm.test.tsx` passes 36 of 36 — that branch's three cases beside
the nineteen added here. The one conflict is this note's row in
`.debug/README.md`: that branch re-flows the whole table.

On 2026-10-19 the commit was rebased onto PR #27 (`w5/checkup-scope`, then at
`d904672`), which carries that branch and Next 16.3.8, and on 2026-10-20 onto
its next tip, `3ef82a3` (one test file of its own, no conflict): `main` was still red on
`audit` (`next` 16.3.6), so the pre-push hook would have refused the commit
there. The one conflict was that same row. #27 had also replaced
`new StorageEvent("storage", { key })` with a bare `new Event("storage")` in
its tests — CodeQL's `js/superfluous-trailing-arguments`, whose model of
`StorageEvent` takes no arguments, and the subscription reads no key — and the
tests here now do the same. What was run on that base is at the end of §7.

On 2026-10-23, #27 having landed, the commit was rebased onto `main`
(`a257f05`, Next 16.4.1 after the advisory fixes of 2026-10-22 and 23). The
one conflict was this note's row again.

## 7. Review, and what it changed

A second agent was given the code and the contract — not the conclusion — and
told to break it, with a jsdom probe for every suspicion. It found one
ordering the app can produce that still took typed text (item 4) and three
other things that changed this change:

1. **"A field emptied by hand stays empty" did not pin its rule.** With every
   empty field counted as untouched, all 26 cases of the first version passed:
   the test typed before the card rendered again, so `follow()` never saw the
   emptied field. It now empties, then moves the record.
2. **Nothing held `shown` to what a save stored.** Removing that line passed
   26 of 26. Two cases now do: a field emptied while the save is on its way
   stays empty through the answer and the page that follows it, and a saved
   field follows the record again from what was stored.
3. **The record moving while the card's own save was on its way.** A field the
   save had sent untouched followed the record, so it no longer matched what
   was sent, and the answer took it for "typed since": inseam 84 sent, a fit of
   80 / 706 arriving first, then the answer 84 / 742 — the card showed 84 and
   **706** under "Enregistré", and went on showing it. `Card.sent` is now moved
   with the record exactly as the inputs are. The reviewer found no path to
   this in the app — read in React 19.2.8 and Next 16.3.6, a router update
   waits for a pending action — and that was not observed either way; the form
   does not lean on it.
4. **The guest bike's removal re-seeded the card**, which the rule in §4 does
   not allow: nothing had taken its place. It now follows field by field.

A saved bike following a fresh `fit` was covered by the browser case only; it
has a jsdom case too.

Then fourteen mutants of the form against its test file — re-seed everything,
never follow, the first read or the removal as a replacement, never a
replacement, an empty field as untouched, `shown` or `sent` not moved, a save
that re-seeds the whole card or none of it, and so on: thirteen killed. The
fourteenth, "a failed save does not clear `sent`", survived because the line
did nothing a test could see; it was removed.

Gates on the final code, 2026-10-13:

| gate                                                                                                             | result                                                                                       |
| ---------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------- |
| `scripts/ci.sh`: nvmrc, lint, typecheck, content, test-unit, test-integration, coverage, secrets, sast, build    | pass — 3 571 tests; `MeasurementForm.tsx` at 97 % statements, 92 % branches                  |
| `scripts/ci.sh`: audit                                                                                           | red — five advisories, every one on `next` 16.3.6; nothing here touches a dependency         |
| `scripts/ci.sh`: trivy                                                                                           | red — CVE-2026-94483 on `next` 16.3.6, fixed in 16.3.8; the same                             |
| e2e on the host: `fit`, `a11y` and `seo` × `desktop-chromium`, `mobile-chromium`, `mobile-landscape`, `no-webgl` | 272 passed                                                                                   |
| e2e in CI's Linux image: `fit` × `mobile-webkit`, `mobile-chromium`                                              | 40 passed, no retry used                                                                     |
| not run                                                                                                          | the rest of the e2e suite, perf, Lighthouse; nothing on GitHub Actions — the branch is local |

On the stacked base (#27 at `d904672`, Next 16.3.8), 2026-10-19: `fit`,
`a11y` and `seo` × the four Chromium projects on the host, 272 passed (the fit
route's first-load JS with the hooks 210.4 KiB, budget 234.0 KiB); the
`MeasurementForm` and `BikeWorkspace` jsdom files, 96 of 96; `tsc` and ESLint
clean. WebKit was not run again on this base — CI's `mobile-webkit` job is that
run. The full local mirror is the pre-push hook's own run. Two runs of it made
first, the same day, were red on `test-unit` alone, on timeouts in files this
change does not touch (`password-policy` with the real zxcvbn, the content
CLI, `BuildList.long-answer`) while another session held the load average
between 22 and 47 on 8 cores; each of those files then passed on its own (75
of 75, 126 of 126). No timeout was raised.

## How to detect a regression

- `components/bike/MeasurementForm.test.tsx`, "two cards over one guest bike"
  and "two cards over one saved bike": nineteen cases. Eleven fail on `main`'s
  form; the eight that do not are pins that were true before (the saved card
  shows what was stored; a number typed and deleted follows again; another
  bike, or a first one, re-seeds whole; a saved bike follows a fresh `fit`).
- `tests/e2e/fit.spec.ts`, "what is typed in one card survives the save of
  another, key by key" and "a saved bike: the save of one card takes nothing
  typed in another, and an untouched field follows", FR and EN. On the unfixed
  build both fail in both locales: `toHaveValue("380")` received `""`, and
  `toHaveValue("38")` received `""`.
- Type with `pressSequentially`, never `fill`: `fill` is one event carrying the
  whole value and cannot show which key went missing.
- A saved bike's test must not take "Enregistré" for the page having rendered
  again — it is the action's answer. The spec writes a rider weight to the row
  from outside and waits to see it.
