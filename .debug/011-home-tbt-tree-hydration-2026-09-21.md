# 011 — the home page's second long task: a tree that was built, not hydrated

**Date** 2026-09-21 · **Status** resolved · **Branch** `perf/home-tbt`

## Symptom

The one audit `.debug/008` left open. On CI (2-core runner, applied throttling)
`/fr` and `/en` fail `total-blocking-time` and nothing else:

| URL                             | perf | LCP     | **TBT**      |
| ------------------------------- | ---- | ------- | ------------ |
| `http://localhost:3100/fr`      | 0.98 | 1927 ms | **328.7 ms** |
| `http://localhost:3100/en`      | 0.97 | 1913 ms | **314.4 ms** |
| `…/fr/guides/check-brakes-disc` | 0.97 | 1899 ms | 161 ms       |

Threshold 300 ms; 297.8–357.4 across runs. `.debug/008` had already ruled out
the payload by measurement — trimming 53 kB of messages moved `bootup-time` by
14 ms of 760, and the guide page has a document the same size and half the
main-thread time — and named the cause instead:

> the tree reads the query string during render, so it sits under a `<Suspense>`
> boundary on a static route, so its prerendered fallback is thrown away and the
> tree is built on the client instead of hydrated.

Its control D — the home page with `<DecisionTreeFrame>` not rendered, every
import untouched — dropped local TBT to the guide's level while `bootup-time`
barely moved. **Under 4× CPU throttling the home page had two long tasks where
every other page had one.** This note removes the second.

## Investigation

The measurement first, because it is the whole of the argument. Same method as
`.debug/008`: a CDP session at Lighthouse's own mobile profile (4× CPU,
1.6 Mbit/s, 562 ms RTT, cache disabled), recording `longtask` entries, five
loads per URL, median.

```
BEFORE  /fr                         2 long tasks   64 ms @2429,  73 ms @3414   crude TBT 40
BEFORE  /fr/guides/check-brakes-…   1 long task    65 ms @2426                 crude TBT 12
```

Two tasks a second apart: the first is hydration, the second is the tree being
built. The guide page, same build, same machine, has only the first.

**Why the boundary is not optional.** `useSearchParams()` read during render on
a statically prerendered route makes Next render the nearest `<Suspense>`
fallback into the HTML and mark the boundary for client rendering. That is the
documented behaviour and it is also what keeps `/[locale]` static — the rule in
`CLAUDE.md` exists for a reason. The cost is that React does not hydrate what is
inside such a boundary; it **discards the prerendered DOM and renders the
subtree from scratch**. The home page therefore paid for the skeleton's
hydration and then for building the whole first question — progress bar, heading,
four Radix radio cards, the help disclosure, its drawing frame — a second time.

So the fix is not to make the tree cheaper. It is to stop reading the query
during render.

## Root cause

`DecisionTree` called `useSearchParams().toString()` in its render body, so
`DecisionTreeFrame` had to wrap it in `<Suspense fallback={<DecisionTreeSkeleton/>}>`,
so the tree was client-rendered on a static route. Everything else followed from
that one line: the skeleton existed to be the fallback, and `.debug/007`'s LCP
fix existed because the fallback→content swap re-created the `<h1>` block.

## Fix

**The tree reads `window.location.search` instead, after hydration.**

- `components/decision-tree/location-search.ts` — `useLocationSearch()`, a
  `useSyncExternalStore` whose **server snapshot is `""`**. The prerendered HTML
  and the first client render are therefore both the landing screen (anything
  else is a hydration mismatch); React re-reads the real URL once hydration is
  done, which changes nothing on `/fr` and costs one render on a deep link.
  Same shape as `tree-drawings.ts`, and for the same reason — a browser-only
  value with a server snapshot is exactly what that hook is for, and it says so
  in one place instead of a `setState` on mount, which `react-hooks` rejects
  outright ("Calling setState synchronously within an effect can trigger
  cascading renders" — and cascading renders are the thing being removed here).
- `popstate` is the store's own subscription. `history.pushState` /
  `replaceState` fire no event, so `writeUrl` calls
  `notifyLocationSearchChanged()` after writing.
- `components/decision-tree/RouterSearch.tsx` — the one `useSearchParams`
  consumer left, reduced to a subscription that renders `null`. It covers the
  case neither `window.location` nor `popstate` can: a **router navigation that
  changes the query without leaving the route** — the header logo, which is a
  `Link` to `/`, clicked from `/fr?drive=…&step=discipline`. The App Router
  writes that URL with its own `history.pushState`, silently. Its `<Suspense>`
  boundary has an empty fallback, so what React discards and re-renders is
  nothing at all: that is the entire difference between this and where we
  started, and it is why the repo-wide "every `useSearchParams` consumer sits
  inside a `<Suspense>` boundary" rule still holds, unchanged.
- `RouterSearch` deliberately says **nothing on mount**. The query the page
  loaded with is the one `useLocationSearch()` already reads; reporting it again
  would make a deep link's arrival indistinguishable from a navigation.

**The focus rule needed a new way to tell those two apart.** "Never steal focus
on page load: only a screen change moves it" used to work because the tree's
first render already had the deep link's screen — there was nothing to correct.
Now arriving at step 4 IS a screen change, one render after mount. `DecisionTree`
therefore records what the visitor asked for (`askedForScreen`, set by
`writeUrl`, by the `popstate` listener and by `RouterSearch`) instead of
inferring it, and the focus effect reads that. Two tests fail without it —
including the pre-existing "Nothing is focused on page load".

**`DecisionTreeSkeleton` is deleted.** It existed to be a fallback and there is
no fallback; nothing else rendered it. `DecisionTreeHero` moved out of that file
into `components/decision-tree/DecisionTreeHero.tsx` so the filename stops
lying, and `messages/{fr,en}/decision-tree.json` lose `tree.loading`, which only
the skeleton read.

**The hero stays a prop**, and the reason has changed rather than gone. The
fallback swap that `.debug/007` diagnosed cannot happen any more, but:

1. `DecisionTreeHero` has no `"use client"`. Rendered from the page it is server
   code and ships no JavaScript; imported by `DecisionTreeFrame` (which does
   have it) it would join the first-load bundle of `/[locale]`, the tightest
   budget on the site.
2. It is still the LCP element. Created outside `DecisionTreeFrame`, it is a
   node no re-render in the tree can touch — the property `.debug/007` paid
   1.7 s of LCP to establish, kept independently of what made it necessary.

## Result

Measured back to back on a quiet machine, both builds `ENABLE_TEST_PAGES=1
NEXT_PUBLIC_TEST_HOOKS=1 npm run build`. The guide page is the control: it is
untouched by this change, and its numbers do not move.

**Long tasks under 4× CPU, median of 5** — the number this was about:

| URL              | before               | after         | guide (control) |
| ---------------- | -------------------- | ------------- | --------------- |
| `/fr` long tasks | **2** (64 ms, 73 ms) | **1** (62 ms) | 1 (62 ms)       |
| `/fr` crude TBT  | 40 ms                | **12 ms**     | 12 ms           |

The home page now has exactly the shape of a page that passes.

**Lighthouse, the repo's own settings, median of 5:**

| audit                     | `/fr` before | `/fr` after | `/en` before | `/en` after | guide before → after |
| ------------------------- | ------------ | ----------- | ------------ | ----------- | -------------------- |
| `bootup-time`             | 740 ms       | 728 ms      | 734 ms       | 722 ms      | 418 → 416 ms         |
| `total-blocking-time`     | 22 ms        | 16 ms       | 21 ms        | 14 ms       | 17 → 15 ms           |
| `cumulative-layout-shift` | **0.059**    | **0.000**   | 0.059        | **0.000**   | 0.000 → 0.000        |
| LCP (== FCP)              | 1610 ms      | 1600 ms     | 1597 ms      | 1598 ms     | 1592 → 1593 ms       |
| LCP candidates            | 1            | 1           | —            | —           | 1 → 1                |

Read `bootup-time` the way `.debug/008` taught: it moves 12 ms of 740, inside
the spread, **and that is the point**. The total amount of script the page runs
is not what changed; how it is cut into tasks is. Local TBT stays in the band
this Mac cannot resolve (`.debug/007` §calibration), which is why the long-task
count is the criterion and CI is the arbiter.

**CLS was an unbilled cost of the same boundary.** The skeleton and the real
first screen are not the same height, so the swap shifted the page — 59 % of the
0.1 budget, on every load, for as long as the boundary existed. It is now 0.000,
like every other page.

The document grows, because the first question is in it now: `fr.html`
131 527 → **138 322 B** (+5.2 %), `en.html` 126 143 → **132 819 B**. That is the
trade — 6.8 kB of HTML instead of a client render of the same markup — and it is
the right way round on a 1.6 Mbit/s link with a 4× CPU.

First-load JS is unchanged: `/[locale]` 191.2 kB gzip against a 211.0 kB
ceiling, `forbidWebgl` still clean. `/[locale]` is still `● /fr`, `● /en` in the
build output (§6.8 AC2).

## How to detect a regression

- **`tests/e2e/decision-tree.spec.ts` — "the home DOCUMENT carries the landing
  screen, not a loading state"**. It fetches `/fr` and `/en` with
  `page.request.get()` — no JavaScript runs at all — and requires
  `data-testid="decision-tree"`, `data-question="drive"`, the question's title,
  a `role="radiogroup"` and `data-testid="home-hero"` to be in the HTML, and the
  skeleton not to be. This is the assertion that fails the day the tree goes
  back under a boundary, and it is the one that replaces
  `DecisionTreeSkeleton.test.tsx`.
- `components/decision-tree/RouterSearch.test.tsx` — renders nothing, says
  nothing about the query the page loaded with, reports a navigation once.
- `components/decision-tree/DecisionTree.test.tsx` — "does not steal focus when
  a deep link corrects the screen on load" (fails without `askedForScreen`), and
  "adopts a query changed by a router navigation", which now also asserts that
  the new screen TAKES the focus: that is the one behaviour only `RouterSearch`
  produces, so deleting it from the tree fails this test.
- `components/decision-tree/DecisionTreeFrame.test.tsx` — the landing heading is
  the only `<h1>` on the first screen and steps aside for the question's.
- `lighthouserc.cjs` — `total-blocking-time ≤ 300` and
  `cumulative-layout-shift ≤ 0.1` on `/fr` and `/en`, on CI, which is the only
  machine that can see the first of those.
- `npx tsx scripts/perf/bundle-budget.ts` — the hero must not become a client
  import.

## What is still open

Nothing about this page, pending the CI run. The other half of `.debug/008`'s
follow-up — `/velo` and `/compte` still declaring all 13 namespaces — is
untouched and still in `docs/backlog.md`.
