# 008 — the whole catalogue on every page, and what it actually costs

**Date** 2026-09-18 · **Status** resolved (payload), **open** (the TBT gate itself) · **Branch** `fix/home-tbt`

## Symptom

On CI (2-core runner, applied throttling) the home page is the only content page
still failing its Lighthouse budget, and only on one audit:

| URL                             | perf | LCP     | **TBT**    |
| ------------------------------- | ---- | ------- | ---------- |
| `http://localhost:3100/fr`      | 0.98 | 1927 ms | **321 ms** |
| `…/fr/guides/check-brakes-disc` | 0.97 | 1899 ms | 161 ms     |
| `…/fr/connexion`                | 0.97 | 1695 ms | 160 ms     |

Threshold 300 ms. 7 % over, and reproducibly 320–340 across runs.

The lead from `.debug/007`'s follow-up note: `app/[locale]/layout.tsx` mounted
`<NextIntlClientProvider>` with no `messages`, so next-intl handed the client the
whole merged catalogue — **86 116 B of RSC flight, on every page of the site**,
46 % of the home document and 57 % of its flight. Trimming it looked like the
obvious lever.

## Investigation

**It is a real payload problem and it is not the main-thread problem.** Both
halves of that sentence are measured.

Local baseline, Lighthouse with the repo's own settings (mobile, applied
throttling, median of 5), on a quiet machine:

| build                                       | `fr.html` | doc transfer | bootup-time | react-dom chunk | TBT (local) |
| ------------------------------------------- | --------- | ------------ | ----------- | --------------- | ----------- |
| baseline                                    | 187 632 B | 43 254 B     | 760 ms      | 796 ms          | 48 ms       |
| **A** — provider given home's 5 namespaces  | 129 581 B | 26 113 B     | 746 ms      | 805 ms          | 42 ms       |
| **B** — A, and `illustrations={{}}` as well | ~91 000 B | 21 786 B     | 744 ms      | 780 ms          | 39 ms       |
| **D** — baseline, tree not rendered         | —         | 38 502 B     | 737 ms      | 730 ms          | 29 ms       |
| _reference_: `/fr/guides/check-brakes-disc` | 186 121 B | 46 690 B     | 468 ms      | 433 ms          | 24 ms       |

Read the table rather than the hypothesis:

- **Control A takes 53 kB of messages out of the document — 31 % of it, 40 % of
  what goes over the wire — and moves `bootup-time` by 14 ms**, which is inside
  the run-to-run spread. Control B takes another 38 kB (every drawing) and moves
  it by 2 ms more. The RSC payload is **not** what the main thread is busy with.
- The guide page is the control that settles it: **the same document size,
  186 121 B against 187 632 B, and 433 ms of react-dom against 796 ms.** Size is
  not the variable.
- `.debug/007` recorded that "the main-thread cost tracks the document almost
  linearly". That was two points from two different pages, and it does not hold:
  those two pages differ by 1.5 kB of document and by 1.9× of main thread.

**Where home's extra main-thread time is.** `bootup-time` attributes 796 ms of
the 760 ms total to `chunks/34wvn5zw0a69w.js`, which is `react-dom-client` — so
that number is React _doing_ things (flight decode, hydration, render), not
parsing a big file. Under 4× CPU throttling and a 1.6 Mbit/s profile, driving the
page from a CDP session and recording `longtask` entries:

```
/fr                       2 long tasks   74 ms @1830,  78 ms @1983   (crude TBT 52)
/fr/guides/check-…        1 long task    78 ms @1695                 (crude TBT 28)
```

Both of home's tasks sit immediately after `chunks/34wvn5zw0a69w.js` lands at
1837 ms. The second one is the one the guide page does not have, and control D —
the home page with `<DecisionTreeFrame>` not rendered, everything else including
its imports untouched — is the control that names it: local TBT falls to the
guide's level (29 ms) while `bootup-time` barely moves. **The extra long task is
the decision tree's client render**, and it is a client render rather than a
hydration because the tree reads `useSearchParams` and therefore lives under a
`<Suspense>` whose prerendered fallback React throws away (§ `.debug/007`). The
page pays for the skeleton's hydration and then for building the tree again.

That is the 7 %. It is not the catalogue.

## Root cause

Two separate things, and only the first is fixed here.

1. **Payload.** The locale layout is shared by every route, so the provider it
   mounts cannot know what the page below will render; given no `messages` prop,
   next-intl fills it from the request configuration, i.e. all 13 namespaces.
   Every page of the site, and every `_rsc` prefetch of one, carried 86 116 B of
   messages for the three to six namespaces its client components read.
2. **TBT.** The home page hydrates a skeleton and then client-renders the tree
   over it, in a second long task. That is the audit's 7 %.

## Fix

**Each route declares what its own client subtree reads.**

- `lib/i18n/client-namespaces.ts` — the table, keyed by the file that reads it.
- `components/i18n/ClientMessages.tsx` — a server component that mounts
  `NextIntlClientProvider` with exactly those namespaces. The locale layout
  mounts one for the shell; a segment layout mounts one where the segment has
  one (`velo/[id]`, `(protected)` — so their `error.tsx` is covered); otherwise
  the page mounts one around everything it returns.
- `lib/i18n/request.ts` is untouched: the **server** still has the whole
  catalogue, so `getTranslations` is unaffected.

**A nested provider replaces messages — it never merges** (`use-intl`'s
`IntlProvider`: `messages: undefined === i ? parent?.messages : i`). That is what
makes the arrangement checkable — a client component sees exactly what its
nearest provider names — and it is also why a missing namespace is not a smaller
payload but a component rendering `decision.brake-type.title` at the visitor.

**`tests/unit/i18n/client-namespaces.test.ts` is the proof.** It rebuilds, from
the source, what each route can read:

1. walk the module graph from every route entry under `app/` with
   `ts.preProcessFile` — TypeScript's own scanner, so multi-line imports,
   `export … from`, `import type` and `import()` are all seen;
2. mark everything reachable **through** a `"use client"` module as client code;
3. read each client module's `useTranslations` calls **from its syntax tree**
   (a grep reads the doc comments, which in these files quote the very call
   they warn about);
4. resolve the provider covering the route — its own, or the nearest layout
   above — and require the declaration to cover the set.

Every uncertainty resolves **against the payload, never against the page**: an
import that resolves to nothing fails the run instead of silently pruning a
branch, and a `useTranslations()` with no literal namespace requires all 13,
because nothing static can say which message a `t(node.titleKey)` will reach.

That last rule is why the tree had to change. `DecisionTree`, `QuestionStep`,
`OptionGrid`, `HelpDisclosure`, `DefaultCallout` and `Summary` each called
`useTranslations()` and cast it through `as unknown as Translate` to pass the
fully-qualified keys the decision data carries. They now go through
`useDecisionText()` (`components/decision-tree/decision-text.ts`), one
`useTranslations("decision")` behind the same signature — five casts become one,
and the namespace is a literal a reader and a test can both see.

Five components on the `/velo` and `/compte` routes still do it the old way
(`PartInfo`, `PartEditForm`, `MeasureCard`, `MeasurementForm` over `parts.*`
keys; `form-parts.tsx` resolves a message KEY a server action returned, so the
namespace is genuinely a runtime value). Their routes therefore declare the whole
catalogue — the honest answer, not a guess — and that is a visible line in the
table rather than a silent risk.

## Result

Built as CI builds it (`ENABLE_TEST_PAGES=1 NEXT_PUBLIC_TEST_HOOKS=1
NEXT_PUBLIC_SITE_URL=http://localhost:3100`):

| document                      | before    | after         |         |
| ----------------------------- | --------- | ------------- | ------- |
| `fr.html`                     | 187 632 B | **129 991 B** | −30.7 % |
| `en.html`                     | 177 096 B | **124 607 B** | −29.6 % |
| `fr/guides/check-brakes-disc` | 186 121 B | **147 941 B** | −20.5 % |
| message flight on `/fr`       | 86 249 B  | **33 337 B**  | −61 %   |

Over the wire (Lighthouse `resource-summary`, document): `/fr` 43 258 →
**25 880 B**, `/en` 40 328 → **24 413 B**, the guide 46 690 → **37 146 B** — and
the same saving again on every `_rsc` prefetch of a route (the home page issues
eight while it loads).

Main thread on `/fr`, the two builds measured back to back on a quiet machine:
`bootup-time` 793 → **747 ms** (−5.8 %); a second pair measured 760 → 713.
Local TBT stays in the 39–49 ms band either way, which is the band this machine
cannot resolve — `.debug/007`'s calibration still holds, TBT does not reproduce
here.

`npm run lhci` passes on the six non-3D URLs on every run, with **no console
error on any of the 21 runs** — itself a check on the trim, since a namespace a
provider was not given makes use-intl call `onError`, i.e. `console.error`.
`/fr/velo/demo` straddles its own 3000 ms LCP limit on this Mac under
SwiftShader, before this change (median 2936) as after (2963, then 3008): that
page's document grows by 57 B here, because `/velo` declares the whole catalogue
and now also pays for the layout's `auth` + `common`.

First-load JS is unchanged by design (`/[locale]` 195 739 → 195 870 B gzip,
against a 216 064 B ceiling): this moves RSC flight, not client chunks.

**What this does not do is clear the TBT gate.** Control A is the same
intervention measured on its own, and it moved `bootup-time` by 14 ms of 760.
The audit's 7 % is the second long task, and that is the decision tree's client
render — see **Follow-up**.

## How to detect a regression

- `tests/unit/i18n/client-namespaces.test.ts` — the whole contract. It fails
  with the exact set to write into `CLIENT_NAMESPACES`, and it fails just as
  loudly if a route stops wrapping itself, if a declaration names a file that
  does not exist, or if a route inlines its list instead of reading its entry.
- The same suite pins the two properties the analysis rests on: that
  `app/[locale]/page.tsx` requires fewer than all 13 namespaces (it goes back to
  13 the moment `useDecisionText` becomes a bare `useTranslations()`), and that
  an unscoped translator is read as a claim on everything.
- `tests/unit/i18n/messages-parity.test.ts` is unchanged and still the authority
  on FR/EN parity; `global.d.ts` still types `t()` from
  `lib/i18n/namespaces.ts`.
- `npx tsx scripts/perf/bundle-budget.ts --json` — first-load JS is unchanged by
  design (this moves RSC flight, not client chunks); a jump there means a
  provider leaked into a client module.

## Follow-up: what would actually move TBT

The measured cause is the second long task, and the change that removes it is
architectural: the tree reads the query string during render, so it sits under a
`<Suspense>` boundary on a static route, so its prerendered fallback is thrown
away and the tree is built on the client instead of hydrated. Reading the query
in an effect instead would let the whole tree be server-rendered and hydrated
once — but it moves the tree's state source off the router, and `.debug/007`'s
LCP fix, `DecisionTreeSkeleton.test.tsx`, `DecisionTreeFrame.test.tsx` and the
repo-wide "every `useSearchParams` consumer sits inside a `<Suspense>` boundary"
rule all sit on the current arrangement. It is a task of its own, with its own
e2e pass — not a line to slip into a payload change.
