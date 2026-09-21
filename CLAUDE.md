# CLAUDE.md

Guidance for Claude Code (claude.ai/code) working in this repository.

> **Rule: update this file in the same commit as any architecture change.**
> A new folder contract, a new naming contract, a changed script, a changed
> ownership boundary — it lands here or it did not happen.

---

## Environment

The Bash tool does **not** load `~/.zshrc`, so `node`/`npm`/`npx` are not on the
PATH by default. Prefix every shell call with:

```bash
source "$HOME/.nvm/nvm.sh" && nvm use 24 >/dev/null && cd /Users/alienard/Code/velo-atelier &&
```

`node -v` must print `v24.x` (`.nvmrc` = `24`, `engines.node` = `24.x`; a CI job
fails if the two disagree). Docker Desktop must be running for anything that
touches the database. The GitHub account is **`lienardale`** (the macOS user is
`alienard` — never use it as a GitHub handle).

**npm only.** No `pnpm`, no `yarn`, no `bun`, no committed `.npmrc`, and never
`--legacy-peer-deps`. `bun.lock` and `pnpm-lock.yaml` are gitignored on purpose:
a stray `/Users/alienard/Code/pnpm-lock.yaml` one directory up is why
`next.config.ts` pins `turbopack: { root: process.cwd() }`.

---

## Stack

| Layer      | Choice                                               | Notes                                                                             |
| ---------- | ---------------------------------------------------- | --------------------------------------------------------------------------------- |
| Framework  | Next.js **16.3.4** (App Router, Turbopack)           | `eslint-config-next` pinned to the same exact version                             |
| Language   | TypeScript **5.9.x**                                 | capped `<7`; the TS 7 Go port breaks `next build` and `@typescript-eslint`        |
| Runtime    | Node **24**                                          | `.nvmrc`, `engines.node`, CI `node-version-file`                                  |
| i18n       | next-intl **v4**                                     | `localePrefix: 'always'`, `localeDetection: false`                                |
| Styling    | Tailwind **v4**, CSS-first                           | tokens in `styles/globals.css`; no `tailwind.config.*`, no `dark:` variants       |
| UI         | shadcn/ui + hand-rolled `components/ui-ext/`         | no `vaul`; `MobileSheet` is hand-rolled                                           |
| 3D         | React Three Fiber 9 + drei 10                        | **parametric geometry in code**, no glTF assets                                   |
| Database   | PostgreSQL 16 + Prisma **7.10.0**                    | driver adapter `@prisma/adapter-pg`; client generated into `lib/generated/prisma` |
| Auth       | Auth.js **v5** (beta)                                | Credentials + Google, JWT sessions                                                |
| Validation | zod **4**                                            | classic `zod` server/test-side, `zod/mini` in bundled code                        |
| Tests      | Vitest **4.1**, Playwright **1.63.0**, Lighthouse CI | coverage gate 80 %                                                                |
| Hosting    | Vercel (`cdg1`) + Neon Postgres                      | migrations run only when `VERCEL_ENV=production`                                  |

---

## Commands

```bash
npm run dev            # tree drawings, then Turbopack dev server on :3000
npm run build          # tree drawings, content:generate (structural check + lib/content/generated), next build
npm run drawings       # render the decision tree's drawings to public/tree-drawings.json
npm run drawings:check # fail if that file is stale (runs in scripts/ci/content.sh)
npm run lint           # ESLint (flat config)
npm run format:check   # Prettier
npm run typecheck      # prisma generate, content-collections build, content:generate, tsc --noEmit
npm test               # every Vitest project (integration is dropped, with a warning, when no _test DB answers)
npm run test:coverage  # Vitest + the coverage thresholds (this is the gate, not a report)
npm run e2e            # Playwright, every project (needs a production build first; pass --project=<name>)
npm run e2e:mobile     # Playwright on the mobile profiles
npm run e2e:docker     # Playwright in the amd64 CI image: the Linux reproducer (scripts/ci/e2e-docker.sh)
npm run perf           # Playwright perf + perf-mobile (hard WebGL counters + the @soft timings)
RUN_LOCAL_PERF=1 npm run perf:local  # the real-GPU gate: p95 frame cost <= 16.7 ms, writes .perf/local-<date>.json
npm run lhci           # Lighthouse CI
npm run db:up          # docker compose up -d --wait (main checkout only)
npm run db:setup       # docker compose + migrate + seed (localhost only)
npm run db:seed        # prisma db seed — idempotent upserts; refuses a non-local host unless ALLOW_REMOTE_SEED=1
npm run db:reset       # destroy the volume and rebuild from scratch
npm run content:check  # validate content/** (--strict)
npm run content:new    # scaffold content/guides/<kind>-<slug>/{fr,en}.mdx; --part flags go after a --
npm run ci:local       # bash scripts/ci.sh, the local mirror of the GitHub Actions pipeline
```

---

## Folder layout

No `src/`. The `@` alias is the repository root.

```
app/[locale]/…       routes (FR default, EN via routing.pathnames)
auth.ts auth.config.ts proxy.ts     Auth.js split; proxy.ts is Node-only in Next 16
lib/domain/          pure TS data + engine — zero React, zero Prisma
lib/bike3d/          pure geometry (three imports allowed, no React)
lib/content|checkup|shop|geometry|bike|guest|auth|security|db|actions|i18n|hooks|seo|a11y|testing
lib/env.ts           the environment contract (see "Contracts": not called at boot yet)
components/ui/       generated shadcn — do not hand-edit
components/ui-ext/   hand-rolled primitives (Stepper, Callout, MobileSheet, …)
components/i18n/     ClientMessages — the per-route next-intl provider
components/bike3d/   R3F scene; components/bike3d/parts/** are declarative only
content/             MDX guides + YAML data (CC BY-SA 4.0)
messages/{fr,en}/    one JSON file per namespace
prisma/              schema, migrations, seed
tests/               unit, ui, bike3d, integration, security, e2e, perf
scripts/             ci/, db/, perf/, content tooling
docs/                contributor and operator docs — every one is linked from README.md
.debug/              NNN-*.md investigation notes, indexed in .debug/README.md
```

---

## Contracts to respect

- **Part identity** — `PartId` is kebab-case with a position suffix when paired
  (`brake-caliper-front`). Every `PartDefinition` carries exactly one of
  `meshId` (it is rendered) or `hostPartId` (it is clickable through its host).
- **Bike state** — `answers` is the source of truth and is persisted; `spec` and
  `parts` are derived (`buildBikeSpec`, `partsForSpec`) and recomputed on every
  write. `validateBuild(unknown)` is the only entry point for user-supplied JSON.
- **Guide frontmatter** — the discriminator field is `kind`
  (`check | replace | clean | adjust | measure`), never `type`.
- **Server actions** — always `withUser()` (which runs `auth()` +
  `assertSameOrigin()`), a `.strict()` zod schema, an ownership predicate that
  nests `bike: { userId }`, and an `ActionResult<T>` return. Expected failures
  are returned, never thrown. Messages are **keys**, never French strings.
- **Not-found over forbidden** — another user's resource returns 404, not 403.
- **Session cookie** — the `jwt` callback drops a token whose `sessionVersion`
  differs from the row on EVERY trigger, `update` included (a stolen cookie must
  not adopt a new number). `changePasswordAction` keeps its own device signed in by
  re-issuing the cookie (`lib/auth/session-cookie.ts`), never via `unstable_update()`.
  Background requests must never write OR delete it — a late answer for an old
  token would overwrite or delete a newer cookie. Auth.js writes the JWT cookie on
  every read, so `proxy.ts` keeps that refresh only on a document navigation with a
  token at least 24 h old (`sessionRefreshPolicy`, the plan's `updateAge`), drops
  every session cookie on router/prefetch requests and action POSTs, and
  `GET /api/auth/session` writes none (`withoutSessionWrites`). See `.debug/003`.
- **Protected pages** are guarded by `authorized()` in `proxy.ts`, and read the user
  with `requireSignedInUser(locale, page)` / `redirectToSignIn()` — never a bare
  redirect to `/connexion`: a session the proxy still believes but `@/auth` rejects
  must go through `/api/session-expired` (clears the cookie) or it loops.
- **Adding a first password** (Google-only accounts) requires a Google sign-in within
  10 minutes (`lib/auth/reauth.ts`, `authAt` / `authProvider` claims) and signs
  every other device out.
- **Domain data** — `validateBuild` is hand-written (zod-free barrel); rule messages
  are keyed per rule group (`rules.<group>.{message,fix}`); `parts.units.*` messages
  take `{ value }`.
- **Messages** — next-intl keys are leaves: a key is either a string or an
  object, never both; ids that become key segments never contain `.`. Every
  user-facing string exists in **both** `messages/fr/` and `messages/en/`;
  `tests/unit/i18n/messages-parity.test.ts` enforces it.
- **The catalogue the SERVER reads is whole; what reaches the BROWSER is
  declared per route.** `lib/i18n/request.ts` still merges all 16 namespaces
  (`lib/i18n/namespaces.ts`) for `getTranslations`. `NextIntlClientProvider`
  does not: every route mounts
  `components/i18n/ClientMessages.tsx` with its own entry of
  `lib/i18n/client-namespaces.ts` — the locale layout for the shell, a segment
  layout where one exists (`velo/[id]`, `(protected)`, so their `error.tsx` is
  covered), the page otherwise, wrapping everything it returns. Handing the
  provider the merged catalogue cost every page 86 116 B of RSC flight, 46 % of
  the home document (`.debug/008`).
  **A nested provider REPLACES messages, it never merges**, so a namespace left
  out is a component rendering its keys at the visitor, not a smaller payload.
  `tests/unit/i18n/client-namespaces.test.ts` is what makes that unshippable: it
  walks each route's client module graph and fails with the exact set to
  declare. It resolves every uncertainty against the payload — an import it
  cannot resolve fails the run, and a `useTranslations()` with **no literal
  namespace** requires all 16 — so client code never uses a root translator.
  A message key chosen at RUNTIME (an action's `fieldErrors`, a part's
  `labelKey`, a build-list line's reason or compatibility rule) is resolved with
  `translateScopedKey` (`lib/i18n/scoped-key.ts`) inside translators bound by
  literal `useTranslations("…")` calls: `usePartsText()` (`parts`),
  `useBikeActionText()` (`bike`, `errors`), `form-parts.tsx`'s
  `useActionMessage()` (`errors`, `auth`) and `useListText()`
  (`components/build-list/list-text.ts`: `guides`, `rules`); a key outside those
  namespaces is reported missing, never resolved elsewhere. No route declares
  the whole catalogue any more (W4). `app/[locale]/velo/[id]/controle` and
  `app/[locale]/velo/[id]/liste` mount their own `ClientMessages` inside the `velo/[id]`
  layout's, and a nested provider replaces messages, so each declares
  everything its subtree reads. `useDecisionText()`
  (`components/decision-tree/decision-text.ts`) is the one-namespace version of
  the same idea.
- **Navigation** — always import `Link`, `redirect`, `usePathname`, `useRouter`
  and `getPathname` from `@/lib/i18n/navigation`, never from `next/link` or
  `next/navigation`.
- **URL state** — the App Router has no shallow routing. Decision-tree answers
  and `?part=` are written with `history.replaceState` / `pushState`, and every
  `useSearchParams` consumer sits inside a `<Suspense>` boundary. **That
  boundary is not free, so keep what is inside it small.** A `useSearchParams()`
  read during render on a statically prerendered route makes Next render the
  fallback into the HTML and mark the boundary for client rendering — React then
  DISCARDS the prerendered DOM and builds that subtree again instead of
  hydrating it. The decision tree used to be inside one, and that second render
  was the home page's extra long task and the 7 % `/fr` and `/en` were over
  their 300 ms TBT budget by, plus 59 % of their CLS budget in the
  fallback-to-content swap (`.debug/008` measured it, `.debug/011` removed it).
  The tree reads `window.location.search` through
  `components/decision-tree/location-search.ts` (a `useSyncExternalStore` with
  an empty **server snapshot**, so the prerendered HTML and the first client
  render agree), subscribes to `popstate`, and calls
  `notifyLocationSearchChanged()` after its own history writes, which fire no
  event. Its one surviving `useSearchParams` consumer is `RouterSearch`, which
  renders `null` and exists only to notice a router navigation that changes the
  query without leaving the route (the header logo): an empty fallback means
  React discards nothing.
  **A prerendered tree is on screen before it is listening**, so it sets
  `data-hydrated="true"` on its `<section>` from a ref callback and e2e waits
  for that, not for the element: a click in that window is dropped, and
  `networkidle` is not "Next has finished prefetching" either (`.debug/011`).
- **`server-only`** is imported only in `app/**` server files,
  `components/mdx/index.ts` (the MDX rendering boundary: importing that barrel
  from a client component fails the build), `lib/auth/password-policy.ts` and
  `lib/actions/with-user.ts`. Everything reachable from `prisma/seed.ts` and
  `scripts/**` must be plain Node (`tests/unit/no-server-only-in-scripts.test.ts`
  walks the graph).
- **Prisma** — import the client from `@/lib/generated/prisma/client`, never
  from `@prisma/client` (ESLint enforces it; a type-only import is allowed for
  the adapter cast in `auth.ts`).
- **No logic in `components/bike3d/parts/**`** — no `if`, no `switch`, no
  ternary, no `&&` / `||` / `??`, no loops. Decide in `lib/bike3d/**`, pass a
  prop. ESLint enforces it via `no-restricted-syntax` scoped to that folder.
- **Illustrations are RSC-rendered** — `components/illustrations/index.ts` is the
  generated barrel of all 68 drawings (72 exports: the 68, the placeholder, the
  props type, and the name → component map with its lookup;
  `docs/illustrations.md`). Only server files may import
  it: guides go through `components/mdx/Illustration.tsx`, the decision tree
  through `components/decision-tree/tree-illustrations.tsx`, which hands the
  client tree already-rendered nodes, and the build list's "Comment mesurer"
  through `components/build-list/measure-drawings.tsx` (ids registered in
  `lib/shop/measure-drawings.ts`). A `"use client"` file that imports the
  barrel puts all 68 drawings in the route's first-load JS. A drawing with numbered
  `data-callout`s always ships with its legend (`illustrations.<id>.callouts.<n>`),
  in the guide renderer and in the tree's `HelpFigure` alike.
- **The decision tree's drawings are split: frame here, shapes over the wire**
  (`.debug/007`). The tree navigates on the client, so every drawing it can
  reach has to be in the browser before the visitor asks for it — and putting
  all 54 in the page's RSC payload cost the home page 139 kB of shapes for the
  one drawing the first screen shows (LCP 3.6 s, TBT 336 ms, perf 0.81).
  `scripts/gen-tree-drawings.ts` (`npm run drawings`, run by `build` and `dev`)
  renders them with `components/illustrations/tree-geometry.tsx` into
  **`public/tree-drawings.json`**, which is **committed** — the `lighthouse` and
  `e2e` jobs restore only `.next/` from the build artifact while `next start`
  serves `public/` from the checkout — and kept fresh by
  `gen-tree-drawings --check` in `scripts/ci/content.sh`.
  `components/decision-tree/TreeDrawing.tsx` (client) draws the `<svg>` frame,
  the `<title>` and the callout legend, and fetches the map once after
  hydration. `treeFrameAttrs()` is the one definition of that frame, shared with
  `TreeIllustrationFrame` and pinned by `tree-geometry.test.tsx`. The rendering
  cannot move into `app/**`: Turbopack refuses `react-dom/server` there, and the
  RSC runtime cannot run the synchronous DOM renderer at all.
- **That artifact is data over a closed vocabulary, never markup.**
  `components/illustrations/tree-drawing-node.ts` lists the tags, attributes and
  `style` properties a drawing may use; `renderTreeGeometry()` parses its own
  renderer's output with a narrow tokenizer that throws on anything else, and
  asserts every tag, attribute, value and declaration against those lists, so
  the build fails the day a drawing introduces something new. Adding to either
  list is a security decision: the tag must be inert and the attribute must not
  be able to reference anything outside the drawing. This is what lets
  `TreeDrawing` replay the shapes as ordinary React elements — the repository
  uses React's raw-HTML escape hatch nowhere outside `components/mdx/`, and
  `tests/security/xss-form-inputs.test.ts` greps every source file, comments
  included, to keep it that way.
- **The home page's `<h1>` block is rendered by the SERVER and handed to
  `DecisionTreeFrame` as a node** (`app/[locale]/page.tsx` → `hero=`), never
  imported by it. Two reasons: `DecisionTreeHero` has no `"use client"`, so that
  way it ships no JavaScript on the site's tightest first-load budget; and it is
  the LCP element, so it must be a node nothing re-renders — `.debug/007` is
  LCP 3.6 s on a 1.7 s FCP, caused by Chrome reporting a re-created node as a
  second, much later candidate. Every other page of the site has LCP == FCP; the
  home page did not. `tests/e2e/decision-tree.spec.ts` asserts on the raw
  document, with no JavaScript run, that the hero AND the tree's first question
  are both in it.
- **Build-time flags must be literals** — Next only inlines a `NEXT_PUBLIC_*`
  variable that EXISTS at build time; an unset one stays a runtime lookup, so
  `process.env.X === "1" ? dynamic(…) : null` keeps its `import()` in the graph
  and the "gated" code ships. `next.config.ts` therefore normalises
  `NEXT_PUBLIC_TEST_HOOKS` to `"1"`/`"0"` in `env`, and `scripts/bundle-guard.ts`
  asserts on the build output that `window.__va` is present iff the flag is on
  (and that no `new Function`/`eval` ships at all). It runs after every build:
  `scripts/ci/build.sh` and `scripts/vercel-build.sh`. **`scripts/ci/build.sh`
  exports `NEXT_PUBLIC_TEST_HOOKS=0` unless the caller set one** — `.env.example`
  ships `1` for `npm run dev` and `next build` reads `.env.local`, so without
  that pin every local build had the hooks on and `ci:local` asserted the
  _present_ direction, the same one CI's `build` job asserts (`.debug/009`).
- **`window.__va.bike.camera()` is a read.** `CameraState`
  (`lib/testing/e2e-hooks.ts`) has `position`/`target` as the last frame drew
  them and `endPosition`/`endTarget` where camera-controls is heading. Unlike
  `screenPositionOf`, it never calls `update()`. `reduced-motion.spec.ts`
  asserts on the gap between the two, sampled per rendered frame
  (`renderFrames(1)`), never per wall-clock second: under `reduce` it is below
  1e-4 one frame after a focus (measured 0); with motion it is above 1e-3 and
  closes over more than one frame. A frame count is an annotation only — it
  measures the machine (`.debug/015` §3, §10).
- **`lib/env.ts` declares the environment contract; nothing enforces it at
  boot yet.** `parseEnv()` requires `AUTH_URL` and the Google pair in
  production and refuses `ENABLE_TEST_PAGES`, `NEXT_PUBLIC_TEST_HOOKS` and
  `NEXT_PUBLIC_DEMO_LOGIN` there (`tests/unit/db/env.test.ts`), but `getEnv()`
  has no caller outside that test, and `scripts/bundle-guard.ts` follows the
  hooks flag rather than refusing it. The comments in
  `components/auth/SignInForm.tsx` and `app/[locale]/(auth)/connexion/page.tsx`
  that say the boot fails are wrong. Wiring it needs the production test scoped
  to `VERCEL_ENV` first: the `next` CLI defaults `NODE_ENV` to `production` for
  every `next start` (unless it is set), the CI boot check and the e2e server
  included (`docs/backlog.md`, W5). Until then the Vercel env list in
  `docs/deploy.md` is the only guard.
- **The `/velo/[id]` route** — no `generateStaticParams` and no `loading.tsx`
  under `app/[locale]/velo/[id]/`, and both absences are load-bearing (see
  `.debug/006`). Enumerating `demo` makes every UUID render in Next's on-demand
  _static_ mode, where reading the session is `DYNAMIC_SERVER_USAGE` (a 500); a
  `loading.tsx` streams the response, so the `notFound()` for a foreign bike can
  no longer set a 404. A route-level `loading.tsx` anywhere must also be
  **silent**: it gets no `params`, so it cannot `setRequestLocale`, and one
  `useTranslations` in it turns the whole segment dynamic.
  **§6.8 AC2, as amended** (W4 ruling — the plan's third clause also wanted
  `/[locale]/velo/demo` static, which cannot hold beside §4.7's 404 for a
  foreign bike, and the 404 wins; `.debug/010` §7): the criterion reads
  "`/[locale]` and `/[locale]/guides/[slug]` static; `/velo/[id]` dynamic by
  design (§4.7)". `npm run build` prints `●` for `/fr`, `/en` and every guide
  path, and `ƒ` for `/[locale]/velo/[id]` and its sub-routes. **§6.8 AC9's
  LCP-element clause, as found** (W4): Chrome never takes an inline `<svg>` as an
  LCP candidate, so the bike page's LCP element is the server-rendered `<h1>` —
  painted in the first frame, never the canvas, which is what the clause is for.
- **Nothing the 3D viewer paints after the first paint may be text larger than
  the page's `<h1>`.** LCP is the largest text painted before input, so a late
  line moves LCP to whenever it appeared: `/en/bike/demo`'s LCP was the
  transient "Loading the 3D view…" notice (4 520 ms on CI). That notice is
  `sr-only` — announced, not painted (`BikeViewer`, `.debug/014`): 2 179 ms.
- **The checkup is planned on the server, answered in the browser** (W3-T1).
  `planCheckup(build, scope, guides)` (`lib/checkup/plan.ts`) is a pure function
  of the bike and the corpus, recomputed on every request; the client sends back
  a step KEY and nothing else (§4.4). What is STORED is answers, never questions
  — `StoredCheckup` has no `steps` and no `cursor`, and `reconcile()` marries
  the stored answers to a freshly computed plan on load, so a corpus that grew a
  question costs nobody the fourteen they already answered. The payload's
  vocabulary is pinned to the GENERATED enums (`lib/content/generated/slugs`
  and `reason-keys`), which is why `scripts/ci/test-unit.sh` generates them like
  `test-integration.sh` does. `lib/checkup/**` is zod/mini-only (ESLint) and
  carries a 100 % statements/branches gate.
- **A checkup run is its `startedAt`.** The server's `existingCheckup` treats the
  same `startedAt` as the same run, so a re-finish updates its own list. The
  wizard stamps every NEW run with `createCheckupState`'s now — including after
  a finished checkup reached through `?step=`, which only positions the new run
  — and resumes only an unfinished stored run (`tests/e2e/checkup-second-run.spec.ts`).
  Before W4 a second checkup reused the finished one's `startedAt` and was
  written INTO it (`.debug/013` §6).
- **Quotas (§4.2 c), literally**: 20 bikes/user, 50 checkups/bike, 10
  lists/bike, 50 lines/list, each `TOO_MANY`, each checked BEFORE the first
  write. `finishCheckupAction` names the limit in `fieldErrors.form`
  (`checkup.finish.tooMany{Checkups,Lists,Lines}`); the wizard shows it as
  `role="alert"` and stays on the summary. Every finished checkup creates its
  list, and nothing writes `BuildList` `DONE`/`ARCHIVED`, so a bike holding 10
  lists finishes no further checkup until a list lifecycle exists
  (`docs/backlog.md`).
- **A build-list line is an `(action, partId)` pair, never a part.**
  `recheckedLines(state)` (`lib/checkup/build-list.ts`) is the ONE rule for what
  a checkup closes: the pairs an OK step's `ko[]` names, minus every pair a KO of
  the same state derives. The guest merge and `closeRecheckedItems` both apply
  it and write `doneReason: 'recheck-ok'`; a hand tick is `manual`
  (`setBuildListItemDoneAction`). `tests/unit/checkup/line-identity.test.ts`
  holds both paths to it over all seven presets' real plans.
- **`CheckupItem.reasonKeys` and `BuildListItem.doneReason`** arrive in
  migration `20260921090547_checkup_symptoms_done_reason`, written with
  `prisma migrate diff --from-schema <previous schema> --to-schema prisma/schema.prisma --script`
  (no database needed). Symptoms survive a reload of a saved bike's checkup
  (`writeItems` → `loadStoredCheckup`); `toItem` (`app/[locale]/velo/[id]/liste/load.ts`) reads
  `doneReason` back.
- **The `/velo/[id]` sub-routes read through owner-scoped `load.ts` files**
  beside their `actions.ts` (`app/[locale]/velo/[id]/controle/load.ts`,
  `app/[locale]/velo/[id]/liste/load.ts`), for the reason
  below. The §7.3 budget (≤ 3 queries) covers `/velo/[id]`, `/liste` and
  `/controle` in `tests/unit/bike/load-bike.test.ts`, and
  `tests/integration/query-budget.test.ts` counts the same loads on Postgres
  through `countingClient`.
- **`/acheter?item=` pre-fills from the build-list line.** A guest's line is
  read through `readGuestBuildList`, loaded with a dynamic `import()` only when a
  guest `?item=` is present (a static import put `zod/mini` and the checkup
  storage in `/acheter`'s first load, +24 KB over its pin); a saved bike's line
  through `loadBuildListItemAction` (owner- and bike-scoped), handed down by the
  static page as a prop — an action passed as a prop is a reference, so the route
  stays `●`. The panel is `aria-busy` until the read answers.
- **Server-side data reaches the list's client form only as props.** `/liste`
  passes the brand tiers of THIS bike's parts (`content/brands.yaml`, read per
  request — safe because Turbopack traces `content/` into the route's
  `page.js.nft.json`) and the "Comment mesurer" drawings rendered by
  `components/build-list/measure-drawings.tsx`, a SERVER module (it imports the
  illustration barrel) that no `"use client"` file may import.
- **`chosenProduct`'s link rule lives once**, in `lib/shop/chosen-product.ts`:
  https, no credentials, on the named retailer's hosts — or `vendor: 'other'`;
  any other vendor is refused. The guest import applies it on write; the
  `/liste` loader and the guest list's parser apply it on read.
- **`clientIp()` returns a rate-limit bucket, not an address.** IPv4 as is; an
  IPv4-mapped IPv6 address becomes its IPv4; any other IPv6 address its /64.
  Ports and zone ids are stripped. Header precedence is still §4.3's; a
  trusted-proxy switch is post-MVP.
- **`loadClientMessages` narrows its import specifier at run time**: an unknown
  locale becomes the default, an unknown namespace throws.
- **Every server action needs a row in `tests/security/csrf-and-actions.test.ts`.**
  The test reads the exports of every `"use server"` module under `app/`,
  whatever the file is called: a `withUser` export needs a row in
  `EVERY_WITH_USER_ACTION`, every other export (sign-in, sign-up, sign-out,
  Google) one in `ANONYMOUS_ACTIONS`, and an export it cannot name or an inline
  `"use server"` fails the run.
- **A `use server` file cannot hold a function that takes a `userId`.** Every
  export becomes a callable server reference, so
  `app/[locale]/velo/[id]/controle/load.ts` sits NEXT TO `actions.ts` rather
  than inside it: the page needs to read a checkup during a document GET, which
  `withUser` refuses (no `Origin` header, `lib/security/origin.ts`).
- **`"use server"` files export only async functions.** A zod schema next to an
  action fails the module at request time (`found object`), with `tsc` and
  `next build` both green. Keep input schemas module-private.
- **State updaters never read an event.** `event.currentTarget` is `null` by the
  time a `setState(prev => …)` updater runs; read the value in the handler.
- **Bike writes go through `lib/bike/rules.ts`** — `deriveBike(answers,
previousParts)` is the only way a `Bike` row's `answers`/`spec`/`parts` are
  produced, in the server actions, in the guest repo and in `prisma/seed.ts`
  alike. `lib/bike/repo.ts` is the one interface over the three destinations
  (demo = read-only, local = `localStorage`, db = server actions), so no
  component branches on the ref kind.
- **The guest import is a contract, not three storage shapes forwarded.**
  `/import` is a server page (`auth()` + `buildMetadata`, like its `(protected)`
  siblings) wrapping one client component, which is what reads `localStorage`:
  it projects `va:bike:local`, `va:checkup:local` and
  `va:buildlist:local` onto the `GuestState` payload of `lib/guest/schema.ts`
  (`zod/mini`, `strictObject` everywhere, caps in the schema), and
  `importGuestStateAction` validates only that. Idempotency is a database fact:
  a bike is created only when `(userId, guestLocalId)` is absent, so a second
  device's older copy is answered `skipped: 'already-imported'` with **nothing
  written** — never a merge, never a compare. `Checkup.guestKey` is globally
  unique, so it is stored user-scoped (`${userId}:${CheckupState.id}`): two
  people importing from one shared browser hold the same state id. Only the
  `local` keys are read and cleared — `va:*:demo` belongs to the demo bike,
  which no account owns.
- **Two content collections, one import.** `content-collections.ts` compiles
  `guides` (`content/guides/<slug>/{fr,en}.mdx`) and `legalPage`
  (`content/legal/<id>.{fr,en}.mdx`, schema and accessors in
  `lib/content/legal.ts`); the generated module's export is `all` + the
  collection name pluralised, and `lib/content/collection.ts` is the single
  place that imports it (`GUIDES`, `LEGAL`). Both bodies are rendered in RSC —
  `components/mdx/{GuideContent,LegalContent}.tsx` — which is what keeps
  `script-src` free of `'unsafe-eval'`. The legal pages import `LegalContent`
  **by path**, never through `components/mdx/index.ts`: the barrel also exports
  `Step`, `StepScope` and `Measure`, and pulling it in adds `guides` and `parts`
  to a legal page's browser payload for components it never renders
  (`client-namespaces` fails with exactly that list).
- **A file-convention `opengraph-image` must sit in the SAME segment as the page
  it is for.** `lib/seo/metadata.ts` gives every page an explicit `openGraph`
  object, and on Next 16.3.4 an explicit `openGraph` in a descendant segment
  replaces the parent's — images included. An `app/opengraph-image.tsx` at the
  app root (where §1.1 draws it) therefore reached exactly one route, Next's own
  `/_not-found`, which then warned five times per build that it had no
  `metadataBase` to resolve it against, while `/fr` and `/en` built with no
  `og:image` at all. The site card lives in `app/[locale]/`; the guide card
  already lived beside its page, which is why that one always worked. An image
  route inherits no `params` from the layout above it either — both spell out
  their own `generateStaticParams`.
- **Generated trees** — `lib/generated/**`, `.content-collections/**` and
  `lib/content/generated/**` are gitignored and excluded from ESLint, `tsc` and
  coverage. Escape `[locale]` in globs (`app/\\[locale\\]/**`) or they silently
  match nothing.
  **Every CI job is a fresh checkout, so a job that compiles or runs code which
  imports one of these must generate it first** — `prisma generate`,
  `content-collections build`, `content-check --emit`. Locally these trees
  survive from an earlier build, so the mistake always looks green here and red
  on CI: `prisma/seed.ts` importing `lib/content/generated/*` took down
  typecheck, integration and build at the W2 integration. To check a gate
  honestly, delete the tree first (`rm -rf lib/content/generated`) and run it.

---

## Quality gates

Every gate but CodeQL is a `scripts/ci/*.sh` script that runs the same way
locally. `npm run ci:local` chains them all except the browser tiers (e2e, perf,
Lighthouse), which need a production build and run on their own, and the
PR-only `visual-baseline-guard`.

- ESLint + Prettier, `tsc --noEmit`, content validation. `npm run content:check`
  runs `--strict` (the corpus-level ★ rules) since the W2-T4 guides landed.
- Vitest projects `unit | ui | bike3d | integration | security`; coverage
  thresholds (`vitest.config.ts`, never lowered to pass): 80 % overall; 100 % on
  `lib/domain/**`; 100 % statements and branches on `lib/checkup/**`; `lib/**`
  90 % lines / functions / statements and 85 % branches; `components/**` 75 %
  lines / functions / statements and 70 % branches. CI's two test jobs write
  blob reports and `scripts/ci/coverage.sh` evaluates the thresholds on the
  merge. The glob thresholds are live on their own: `lib/checkup/**` at 99.59 %
  branches failed a run whose global numbers all passed, so run the full
  `npx vitest run --coverage` after touching `lib/checkup/**` or
  `lib/domain/**`. `coverage.include` also takes `components/**/*.ts`,
  `app/**/load.ts` and `app/{sitemap,robots}.ts` (`components/bike3d/types.ts`,
  declarations only, is excluded); coverage-v8 4.1.11 honours both `c8 ignore`
  and `v8 ignore`. Node-tier tests build localized URLs with
  `tests/_fakes/routes.ts`. §7.6 AC3's raw-SQL / `dangerouslySetInnerHTML` grep
  runs over TRACKED sources (`git grep … -- app lib components`): after
  `prisma generate`, the gitignored client under `lib/generated/` declares
  `$queryRawUnsafe`.
- Playwright on desktop, Pixel 7, landscape, 320 px, WebKit (non-blocking) and
  a no-WebGL profile; axe sweep with zero serious/critical violations. e2e runs a
  production build (`ENABLE_TEST_PAGES=1 NEXT_PUBLIC_TEST_HOOKS=1 bash scripts/ci/build.sh`
  first — not a bare `npm run build`, which bakes `.env.local`'s `:3000` origin
  into the canonicals `seo.spec.ts` and Lighthouse check on `:3100`) and reuses a
  running server locally — stop stale servers on :3100. Each
  test gets its own `x-real-ip` so rate limits never collide between tests. Use
  `--project=<name>` (equals form): `--project` is variadic and eats a spec path.
  `PLAYWRIGHT_PORT` moves the whole run (one per worktree): `AUTH_URL` and
  `NEXT_PUBLIC_SITE_URL` are derived from it, and `.env.test`'s pinned `:3100`
  never wins — only a value exported in the shell does. A test database's name
  must end in `_test` (`assertTestDatabaseUrl`).
- **Every e2e spec runs in FR and EN** (`forEachLocale`, hrefs from `href()`),
  including subjects with no locale of their own (the viewer, the sheet, the
  camera). A test stays single only when there is nothing locale-specific to
  visit, and its spec header says why: the bare-origin redirect (`smoke`),
  `sitemap.xml`/`robots.txt` (`seo`), the scan of the built client chunks (`csp`), the
  prerender-manifest check (`shop`), auth-login's EN-cookie case, locale-switch's
  pathnames meta-test, and the 7 preset images of `visual.spec.ts` (the canvas
  draws no text).
- **Visual baselines are Linux-rendered and recorded only by CI.**
  `tests/e2e/visual.spec.ts` (`@snapshot`, `colorScheme: light` +
  `reducedMotion: reduce`, the canvas after `renderFrames(3)`) takes 20 images:
  the 7 presets through `/dev/bike3d?preset=` on desktop-chromium and
  mobile-chromium (`maxDiffPixelRatio` 0.02), and home, a guide and the
  checkup's tool list in FR and EN on mobile (0.03). It skips unless
  `process.platform === "linux"`; only those two projects hold baselines, every
  other one inverts `@snapshot`. To record: `gh workflow run perf.yml --ref
<branch> -f update_snapshots=true` — `e2e.sh` with `UPDATE_SNAPSHOTS=1` runs
  `--grep @snapshot --update-snapshots=changed` only, in the read-only
  `record-snapshots` job, and `update-snapshots` — the write-token job, which
  runs no project code and commits nothing but PNGs — opens a bot PR labelled
  `visual-baseline`. A PR opened with `GITHUB_TOKEN`
  starts no workflow: close and reopen it to run CI. Compare locally with
  `npm run e2e:docker -- --grep @snapshot`; never `-u` on the host, never a PNG
  made on macOS. `.github/workflows/visual-baseline-guard.yml` is its own
  workflow (`opened|synchronize|reopened|labeled|unlabeled`, paths
  `tests/e2e/__screenshots__/**`): it fails a baseline change without the label,
  re-runs when the label changes, and is never a required check.
- **`mobile-webkit` is non-blocking, but read.** `continue-on-error` carries its
  reason next to the key in `ci.yml`. Its `@webgl` specs do run (WebGL without a
  GPU). Two WebKit behaviours a Chromium run never shows (`.debug/015`):
  `page.mouse.wheel` throws on a mobile WebKit descriptor (scroll by script),
  and a `page.goto` issued while a `router.push` is in flight is overruled —
  WebKit cancels the RSC fetch and Next 16 falls back to a browser navigation to
  the push target, so after a click that navigates, wait for that URL. On this
  Mac's emulated amd64 container every WebKit sign-up hangs: it is not the local
  WebKit for sign-up flows.
- **A controlled input on a prerendered page drops text typed before
  hydration** (react-dom 19.2.8 keeps it in the DOM, never in state), and a guest
  bike's `MeasurementForm` also re-seeds once `va:bike:local` resolves. e2e
  types only once React owns the field (`fit.spec.ts` waits for the header's
  "Mon vélo" link, `shop.spec.ts` for its search box); the product fix is open
  (`docs/backlog.md`).
- **Compose runs from the main checkout only.** `docker-compose.yml` pins
  `container_name`, so `docker compose up` from a linked worktree creates a
  second project fighting over that name, or — with the project name forced —
  recreates the container every checkout shares. `bash scripts/ci.sh` (and so
  the pre-push hook) therefore skips `npm run db:up` when the integration
  database already answers and refuses to run it from a worktree; a worktree
  exports its own `POSTGRES_URL`/`POSTGRES_URL_NON_POOLING` (two separate
  `export`s — `export A=… B=$A` leaves `B` empty) pointing at its own `*_test`
  database on the shared container.
- **A green local e2e run does not mean CI is green.** CI's Linux Chromium is a
  different browser build with software GL, and at least one input API scrolls
  on macOS while doing nothing there (`.debug/005`). Reproduce a CI-only failure
  with `npm run e2e:docker -- <playwright args>` (`scripts/ci/e2e-docker.sh`).
  It joins the running Postgres container's network (host `db`) and takes the
  database NAME from the shell's `POSTGRES_URL` (a plain `*_test` name), so a
  worktree runs against its own database; its `node_modules`/`lib/generated`
  volumes are keyed by the lockfile (+ schema) hash and it never deletes one.
  Build on the host first.
- Bundle budget is a per-wave ratchet: `perf.budgets.json` ceilings are re-pinned
  at each wave integration to measured + 10 % (sizes print as KiB).
  `npx tsx scripts/perf/bundle-budget.ts --json` prints the raw gzip bytes and
  the `nextPin` to write; the pin history in `perf.budgets.json` says why each
  jump happened.
- **Lighthouse**: `scripts/ci/lighthouse.sh` runs `lhci autorun`, then
  `scripts/perf/lighthouse-report.ts` prints every run and the median per URL
  plus the bike-page pin proposal. The rule only tightens and works from the
  worse bike URL's median: performance `max(current, min(0.70, floor(median −
0.05)))` (floored on exact hundredths), LCP/TBT `min(current, max(target,
ceil50(median × 1.15)))`; the content bar is frozen. Pins come from a
  nightly's five-run medians, never a laptop's, and TBT from the worse of the
  nightlies available (same-day runs differ 20–40 %). Local lhci only on an idle
  machine: with the CI GL flags Chrome rasterises the page through SwiftShader
  (`.debug/014`).
- **Perf**: hard counters per tier (draw calls, triangles, programs, DPR, one
  context) fail the job; the `@soft` tier writes `.perf/<project>.json` —
  frame COST (`gl.render` + a 1-px `readPixels`; rAF intervals are
  display-pinned on a real GPU), long frames, build time, tap latency (the
  median of five taps between the two farthest-apart parts), counters, runner
  label and three version — and `scripts/perf/compare.ts` ladders it against
  `tests/perf/baselines/*.json`: warn > 150 %, fail > 300 %, long frames on
  `(run+1)/(baseline+1)` (the fail line sits two frames later than a plain ratio
  at every non-zero baseline). `scripts/ci/perf.sh` runs the two projects
  serially (`--workers=1`), so no soft timing measures the other project.
  Baselines are recorded ONLY by `perf.yml` `workflow_dispatch update_baseline=true`,
  whose `perf baseline PR` job opens a bot PR. **A job holding a write token
  builds and tests nothing**: `perf.yml`'s two (`perf baseline PR`,
  `update-snapshots`) take what a read-only job recorded (`perf`,
  `record-snapshots`), validate it — `perf-baseline.sh` under node and a
  Prettier installed `--ignore-scripts`, or a PNG-only check — and open a PR,
  with `HUSKY=0` and a checkout that does not persist the token.
  `UPDATE_PERF_BASELINE=1` outside Actions exits 1.
- **`RUN_LOCAL_PERF=1 npm run perf:local`** swaps the SwiftShader flags for
  `--ignore-gpu-blocklist --enable-gpu` (headless reaches the GPU on Apple
  Silicon; `PERF_HEADED=1` otherwise), refuses any software or masked renderer
  (SwiftShader, llvmpipe, WARP, "Apple Software Renderer", a masked "WebKit
  WebGL"), requires p95 frame cost ≤ 16.7 ms on all 7 presets and writes
  `.perf/local-<date>.json` — the one committed perf file (`.gitignore`:
  `/.perf/*` + `!/.perf/local-*.json`), never compared, never a baseline.
  `PERF_PRESETS=<id>` is a local smoke knob, refused on CI.
- **Bundle budget** sizes print in KiB. `--budget '<route>=<bytes>'` overrides
  one ceiling for one run (§7.6 AC8's 1000 → exit 1).
  `scripts/perf/bundle-breakdown.ts '<route>'`, after
  `npx next experimental-analyze --output`, explains a route's first load per
  chunk and per package.
- gitleaks, `audit-ci`, semgrep, trivy, CodeQL.

Husky runs the fast subset pre-commit and, pre-push, the local mirror without
its `build` step (`SKIP_BUILD=1`; `RUN_BUILD=1` keeps it).

---

## Debug notes

Non-obvious findings go in `.debug/NNN-description-YYYY-MM-DD.md` and are
indexed in [`.debug/README.md`](./.debug/README.md). Add the entry in the same
commit as the fix.

<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->
