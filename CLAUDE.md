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

**`overrides` in `package.json` is the security fix; the audit allowlist is the
last resort.** A transitive dependency whose patched release its parent's
declared range excludes is pinned there — `toml`, `uuid`, `tmp`, `mysql2` and
`basic-ftp` today, plus the scoped `argparse` entry and the exact
`@modelcontextprotocol/sdk` pin described below — and its
GHSA id is then **removed** from `audit-ci.json`,
so a regression fails the `audit` job instead of passing it silently. Every
override is an untested version for its parent, so each one carries a
compatibility note and a green `bash scripts/ci.sh` + `npm run build` in
[`audit-ci-allowlist.md`](./audit-ci-allowlist.md), which also justifies every
id that stays. A dependency whose parent already admits the patched release
needs no override, only `npm update <pkg>` — **unless the newest release that
range admits is inside the 7-day hold**: `npm update` takes the newest, so the
lowest clearing release is then pinned exactly (`mysql2`, and
`@modelcontextprotocol/sdk` at 1.31.0 while 1.32.1 was a day old). The first five are written **unscoped**
(`"toml": "^4.2.0"`, not `"mdx-bundler": { "toml": … }`) on purpose — and the
reason is what the unscoped form _did_, not what the tree already looked like.
`main` resolved two of them TWICE: `uuid@8.3.2` beside
`mdx-bundler/node_modules/uuid@9.0.1`, and `tmp@0.1.0` beside
`external-editor/node_modules/tmp@0.0.33`. The unscoped entry is what collapsed
each pair to a single copy, which also moved `mdx-bundler` off uuid@9 and
`external-editor` off tmp@0.0.33 — larger jumps than the one top-level number
suggests, which is why
[`audit-ci-allowlist.md`](./audit-ci-allowlist.md) names and checks every call
site. A scoped entry would have pinned one copy and left the duplicate
vulnerable; an unscoped one also covers a second parent arriving later, which
is the direction that matters for a security pin. Scope one the day two parents
need different majors.

**The scoped override is that day, and a different shape:**
`"js-yaml@^3": { "argparse": "^2.0.1" }` pins a package that is not vulnerable
in order to remove one that is. `sprintf-js` (GHSA-hp3w-g68c-fv3c) has no
patched release, its only parent in the lockfile is `argparse@1`, and
`argparse@1` is required by nothing but `js-yaml@3`'s command-line tool, which
nothing here runs — so the edge is swapped for the dependency-free `argparse@2`
that `js-yaml@4` already installs. It is scoped because the two `js-yaml`
majors do need different `argparse` majors, and because of what each form does
the day another `argparse@1` consumer arrives: unscoped, that package silently
gets the v2 shim; scoped, `sprintf-js` returns and `audit` goes red. Reach for
this shape only when the swapped package is provably not loaded by its parent's
library code — the proof, and the one flag of the CLI it costs, are in
[`audit-ci-allowlist.md`](./audit-ci-allowlist.md), with the two things a
scoped key does that are easy to miss: a ranged key (`js-yaml@^3`) also
rewrites every `js-yaml` range that intersects it to `^3`, and **Renovate reads
an override as a dependency** — it would have proposed `argparse` 3, so
`renovate.json` caps it below 3. An override that must not float needs its cap
there in the same commit.

**A shipped direct dependency is bumped — never overridden, never
allow-listed.** `overrides` exists for a transitive whose parent pins it too
low, and the allowlist for a transitive **under** a dev tool that cannot reach
a request. Every id in the array today is one of those: `deepmerge-ts` under
`prisma`, `extract-zip` and `qs` under `@lhci/cli`, and `braces` under three
dev-tool glob chains. No entry is on a direct
dependency of any kind, and whether a direct `devDependency` could itself be
allow-listed has never come up here — do not read one out of this rule. A
`dependencies` entry has neither excuse: it ships, and this repository owns
its version, so an advisory on one is answered by changing that version.
`next` is the worked example: GHSA-vcvr-r3jv-pc5j
(critical, CVSS v4 9.5, RCE in `next/og` `ImageResponse`, range
`>=16.2.0 <16.3.6`) went
live against the 16.3.4 pin while this branch was open, and both
`app/[locale]/opengraph-image.tsx` and
`app/[locale]/guides/[slug]/opengraph-image.tsx` build their card with exactly
that API. The answer was `next` **and** `eslint-config-next` to 16.3.6
together — the two are one pin, and the Stack table is where the number lives.

**Take the LOWEST release that clears the advisory, not the newest.**
`renovate.json` holds every update for 7 days — "a freshly published version
can be a compromised one" — and waives the hold only under
`vulnerabilityAlerts`, so that a security response is never _delayed_ by it.
The waiver is not a licence to skip the hold when nothing is delayed:
16.3.6 was the first patched release and 8 days old, so it cleared the
advisory **and** the hold. 16.3.7 (1 day old) and 16.3.8 (published 79 minutes
_after_ the advisory went public) fix nothing this tree needs and sit squarely
inside the window the hold exists for, on the largest single body of code the
site ships. Reach past the first patched release only when a later one fixes
something this tree needs — and when you do, record the skipped hold in
`audit-ci-allowlist.md` so it is a decision and not an oversight.

---

## Stack

| Layer      | Choice                                               | Notes                                                                             |
| ---------- | ---------------------------------------------------- | --------------------------------------------------------------------------------- |
| Framework  | Next.js **16.3.6** (App Router, Turbopack)           | `eslint-config-next` pinned to the same exact version                             |
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
| Hosting    | Vercel (`cdg1`) + Neon Postgres                      | `vercel-build.sh` migrates production; `migrate-preview.yml` the `preview` branch |

---

## Commands

```bash
npm run dev            # tree drawings, then Turbopack dev server on :3000
npm run build          # tree drawings, content:generate (structural check + lib/content/generated), next build
npm run start          # next start: a PRODUCTION server — refused (500s, EnvValidationError in its log) while
                       # AUTH_GOOGLE_ID / AUTH_GOOGLE_SECRET are empty, as .env.example ships them (dev is fine)
npm run drawings       # render the decision tree's drawings to public/tree-drawings.json
npm run drawings:check # fail if that file is stale (runs in scripts/ci/content.sh)
npm run lint           # ESLint (flat config)
npm run format:check   # Prettier
npm run typecheck      # prisma generate, content-collections build, content:generate, tsc --noEmit
npm test               # every Vitest project (integration is dropped, with a warning, when no _test DB answers)
                       # WARNING: `boot` joins whenever .next/BUILD_ID exists — i.e. in any worktree that has
                       # built. It spawns `next start` four times against the build ON DISK (a stale .next
                       # is what it tests, not your working tree) and NEEDS a reachable database; unlike
                       # integration it has no graceful drop: without one, two of its four cases fail at
                       # once on a 503 (about half a second each, not a 90 s wait).
                       # `rm -rf .next` or `--project=unit …` to run without it.
npm run test:coverage  # Vitest + the coverage thresholds (this is the gate, not a report) — same boot caveat
npm run e2e            # Playwright, every project (needs a production build first; pass --project=<name>)
npm run e2e:mobile     # Playwright on the mobile profiles
npm run e2e:docker     # Playwright in the amd64 CI image: the Linux reproducer (scripts/ci/e2e-docker.sh)
npm run perf           # Playwright perf + perf-mobile (hard WebGL counters + the @soft timings)
RUN_LOCAL_PERF=1 npm run perf:local  # the real-GPU gate: p95 frame cost <= 16.7 ms, writes .perf/local-<date>.json
npm run lhci           # Lighthouse CI = bash scripts/ci/lighthouse.sh (needs a build; audits a server on
                       # .env.test's _test database unless the shell exports POSTGRES_URL[_NON_POOLING])
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
lib/env.ts           the environment contract — checked at the Vercel build, enforced again at every boot
instrumentation.ts   register() calls getEnv() once per server start; Next never runs it during a build
components/ui/       generated shadcn — do not hand-edit
components/ui-ext/   hand-rolled primitives (Stepper, Callout, MobileSheet, …)
components/i18n/     ClientMessages — the per-route next-intl provider
components/bike3d/   R3F scene; components/bike3d/parts/** are declarative only
content/             MDX guides + YAML data (CC BY-SA 4.0)
messages/{fr,en}/    one JSON file per namespace
prisma/              schema, migrations, seed
tests/               unit, ui, bike3d, integration, security, e2e, perf
scripts/             ci/, db/, perf/, content tooling; vercel-build.sh + check-env.ts are the Vercel build
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
  **Errors are EVENTS, not stdout**: the client is built with
  `log: [{ emit: "event", level: "error" }]` and `lib/db/prisma.ts` prints them
  itself, dropping exactly one line — `lib/db/log.ts`'s
  `isExpectedNotFoundLog`, which matches the target `authAttempt.update` +
  P2025's "required but not found" **on the last non-empty line of the
  message**, the engine's own sentence. Never the whole message: outside
  production Prisma's `colorless` format opens with the caller's source lines,
  and a comment quoting the wording above an `update(` made a P1001 — the
  database unreachable — on that target read as the expected miss under
  `NODE_ENV=development` and `test` (measured on Prisma 7.10.0 from a probe
  written that way; `rate-limit.ts` holds no such comment, and production's
  `minimal` format has no frame to match). Prisma logs where it THROWS
  (`handleAndLogRequestError`), so `createPrismaRateLimiter`'s two conditional
  `UPDATE`s — which read "no row" as their verdict, not as a failure — wrote
  two P2025s to the log per fresh key (both statements miss), one per expired
  window and none for an open one: up to six on a first sign-in, which
  consumes three fresh buckets (`lib/auth/authorize.ts`; all counted on
  PostgreSQL with Prisma 7.10.0). A `catch` downstream could not stop it:
  the filter has to be in the listener. Do NOT widen it into "ignore P2025",
  and do not add a read to avoid the miss — the single conditional `UPDATE` is
  what makes the limiter correct under a burst. Register the listener on the
  freshly constructed value: the `PrismaClient` annotation collapses the log
  generic to `never`, so `prisma.$on(…)` off the export does not typecheck.
  Neither literal is ours, so
  `tests/integration/prisma-error-log.test.ts` drives the real limiter against
  real PostgreSQL and checks that what Prisma emits is still what the filter
  recognises, last line included — and fails loudly if Prisma ever stops
  emitting it at all, which would make the filter dead code to delete rather
  than keep. (That tier runs with `NODE_ENV=test`, so it holds the FRAMED
  format; production's frameless one is held by the recorded messages in
  `tests/unit/db/log.test.ts`.)
  **Taking the events made our listener the only thing that prints a Prisma
  error**, so silencing it is now a silent outage rather than a noisy one: a
  `() => {}` in place of the body dropped 43 real `[prisma]` lines from a
  local run with all 389 integration tests still green (found in review, W5 —
  the commit that recorded it says "a CI run", on a branch that had never run
  on GitHub Actions). The
  body is therefore `lib/db/log.ts`'s `reportPrismaError` — one call, so it
  can be unit-tested in both directions — and the WIRING is pinned separately
  on the shared singleton, by two tests in `prisma-error-log.test.ts` that
  listen differently ON PURPOSE. That it still SPEAKS: `console.error`, our
  `[prisma]` prefix, exactly one line for a `bike.update` on an absent row — a
  unit test of the function alone stays green with the `$on` deleted. That the
  noise has not COME BACK: the real limiter through the singleton on a fresh
  key, with `console.log`, `info`, `warn` and `error` all recorded, every
  argument joined, no prefix filter, and not one line carrying the wording.
  That second recorder is what fails when `"error"` or
  `{ emit: "stdout", level: "error" }` goes back into the client's `log` —
  instead of the event entry or, the quiet mistake, BESIDE it, where `tsc`,
  ESLint, the unit tests and the speaking test all stay green (measured) and
  two `prisma:error` lines per fresh key return. Prisma's own print is
  `console.log("prisma:error", message)`: stdout, two arguments, no `[prisma]`
  prefix — which is why the first version of that test, `console.error` plus
  our prefix, passed with the very line this change removes back in the log.
  Keep both; either on its own proves nothing about the other.
  `event.message` is Prisma's text, printed verbatim: for a
  `PrismaClientValidationError` it includes the call's arguments, so the
  `[prisma]` line must not be forwarded unredacted to a third-party sink
  (unchanged from `log: ["error"]`, which printed the same message). And the
  listener belongs to the client, which outlives a hot reload on `globalThis`:
  an edit to `lib/db/log.ts` needs a dev-server restart to take effect (shown
  by re-evaluating both modules — same client, same listener — not observed
  under `next dev` itself).
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
- **`lib/env.ts` is the environment contract, and two things run it** (W5):
  `scripts/check-env.ts` during the Vercel build, and `instrumentation.ts`
  every time a server starts. `register()` calls `getEnv()` once, gated on
  `NEXT_RUNTIME === "nodejs"`. **Next does NOT run it during a build**
  (`NEXT_PHASE=phase-production-build` returns early), so `next build` — and
  with it `npm run build` and `scripts/ci/build.sh` — still needs no database
  and no secret. That same fact is why the hook alone was not enough: a scope's
  VALUES (a 31-character `AUTH_SECRET`, an `AUTH_URL` without its scheme, a
  forbidden flag) would first be evaluated by the DEPLOYED server, after a
  green build and, on production, after `prisma migrate deploy` — a live
  deployment whose pages answer 500, not a failed deploy (the 500s measured
  under `next start`; on Vercel expected, not observed — "None of the above
  was observed on Vercel", below). And a pull request's preview only ever
  evaluates the Preview scope, so Production's values would be met for the
  first time by production.
  **So `scripts/vercel-build.sh` refuses first, in this order, before the
  database is touched**: (1) a `VERCEL_ENV` that is not `production`,
  `preview` or `development`, unset included; (2) `NEXT_PUBLIC_TEST_HOOKS`;
  (3) the whole contract — `npx tsx scripts/check-env.ts`, which is
  `parseEnv(process.env)`, unweakened. Only then (4) `prisma migrate deploy`
  (production only), `npm run build`, `scripts/bundle-guard.ts`. A violation
  fails the BUILD with the variable's name (never its value) and nothing is
  migrated. Vercel's documentation says the production domains move only to a
  deployment that succeeded, so the previous one should keep serving — that
  half is documented, NOT observed: none of this had run on Vercel when it was
  written. `check-env` has ONE caller. It is not in `npm run build` and not in
  `scripts/ci/build.sh`, because CI builds without a production secret
  (`migrate-on-deploy.test.ts` keeps it out); `vercel-build-guard.test.ts`
  executes the script and the preflight for real — its `npx` stub passes that
  one command through, or a broken preflight would be swallowed green. A
  MISSING variable stops zod before the cross-field rules, so one refused
  build may not name the forbidden flag or the absent `AUTH_URL` beside it;
  `check-env` says so when that can be the case ("the next build may name
  more").
  **Step 1 exists because every guard keys off `VERCEL_ENV`** — the hooks
  refusal, the contract's flag refusal and its production requirements,
  `bundle-guard`, the migrate gate — and without the variable all of them
  failed OPEN at once: run with it unset, this script built with
  `NEXT_PUBLIC_TEST_HOOKS=1` and exited 0, having skipped the migration with
  one log line (measured in review). Vercel documents `VERCEL_ENV` as present
  only while the project's "Enable access to System Environment Variables"
  setting is on; what a build sees with it off was not observed, and step 1 is
  what makes that not matter. Nothing but `vercel.json`'s `buildCommand` runs
  that script — a local or CI build is `npm run build` /
  `bash scripts/ci/build.sh`.
  **A boot refusal is NOT an exit code** (Next 16.3.6, measured with
  `next start` — the W5 plan assumed otherwise). `prepareImpl()` awaits
  `register()`, but `NextNodeServer`'s constructor fires
  `this.prepare().catch(err => console.error("Failed to prepare server", err))`,
  so the rejection is logged and swallowed there and `start-server.js`'s
  `process.exit(1)` is never reached. Next prints "Ready" all the same, the
  socket stays bound, and for as long as the process lives **every page, route
  handler and metadata route answers 500** — `/api/health`, `/fr`,
  `/fr/connexion`, `/robots.txt`, `/sitemap.xml` and `/favicon.ico` were the
  ones polled — **while files under `/_next/static` and `public/` are still
  served**: Next's router server answers those itself, before a request
  reaches the server whose `prepare()` rejected. "Serves nothing" would be one
  word too many, and the difference is the real reason the hooks flag has to
  be refused at BUILD time: a boot refusal keeps every page from loading a
  poisoned bundle and leaves the chunk itself one URL away (on a refused
  hooks-on build the 4 862-character chunk carrying `__va` answered 200).
  `scripts/ci/build.sh`'s boot check (curl `/api/health`) is what turns a
  refusal into a failed step, and `tests/boot/**` samples the status instead
  of waiting for an exit.
  **A 500 from `/api/health` is a verdict, never a boot race.** A request that
  arrives while `register()` is still running is HELD and answered once it
  settles (`start-server.js` awaits its handlers, `handleRequest` awaits
  `prepare()`); before the port is bound the connection is refused, and that
  is the only thing worth retrying. A healthy server never answered 500 on its
  way up — none in the 2 700 to 3 000 answers each of three servers gave four
  clients polling from the moment of spawn, and none in review with
  `register()` held open for four seconds — and the route itself only returns
  200 or 503.
  **None of the above was observed on Vercel.** Expect LESS than "everything
  is down" there: static assets and prerendered routes are normally served
  from the CDN without invoking a function, so a refused deployment may well
  go on answering 200 for a page. `/api/health` answering 500 is the
  diagnostic, the runtime log has the variable's name, and
  [`docs/deploy.md`](./docs/deploy.md) has the recovery (Instant Rollback).
  **On a deployment, a passing check prints one line** —
  `[env] contract enforced (VERCEL_ENV=…)`, once per process. Next loads the
  hook from its own build output and treats a missing file as "no
  instrumentation" without a word, so a 200 alone cannot tell "the contract
  passed" from "the hook never shipped"; the runtime log can. A local or CI
  server (no `VERCEL_ENV`) prints nothing: the line would be noise in every
  Playwright run. `tests/unit/deploy/instrumentation.test.ts` holds what the
  hook itself does (the line on each of the three scopes, silence locally, the
  rejection, the `NEXT_RUNTIME` guard) — the boot tier cannot stand in for it,
  because it tests a BUILD.
  **The three test flags are refused when `VERCEL_ENV` is SET, not when
  `isProduction`**, and that distinction is what made the wiring possible: the
  `next` CLI defaults `NODE_ENV` to `production` for every command but `dev`,
  so the CI boot check, Playwright's web server, Lighthouse and perf all start
  a production server ON PURPOSE with `ENABLE_TEST_PAGES=1`. `VERCEL_ENV` is
  set by Vercel and by nothing else. The flags are refused on every value it
  can hold — a PREVIEW URL is public, and `development` is pinned too — and in
  every spelling `flag` reads as on (`1 | true | yes`, any case). The converse
  is the sharp edge: with `VERCEL_ENV` ABSENT the refusal is off, by design
  for a local production server and by accident for a deployment that has
  lost the variable. Nothing in `lib/env.ts` can tell those two apart, which
  is what step 1 of `vercel-build.sh` is for; a production server that is not
  on Vercel accepts the three flags, and that is the rule, not an oversight.
  `VERCEL_ENV` itself is an enum that fails CLOSED: `staging` is an
  `EnvValidationError` (pinned in `tests/unit/db/env.test.ts`), never "not
  production". Do not widen it — an unknown value read as non-production
  would drop the `AUTH_URL` and Google requirements without anyone having
  chosen to. Vercel documents three values for it and puts a Custom
  Environment's name in `VERCEL_TARGET_ENV`, which nothing here reads; what
  `VERCEL_ENV` actually holds on such a deployment was not observed (the
  project has Production and Preview only), so read the first one's build
  log rather than assuming either way. `AUTH_URL` and the Google pair are
  unchanged: required when `isProduction`.
  `NEXT_PUBLIC_TEST_HOOKS` is inlined by the bundler, so no boot check can take
  it back: **`scripts/vercel-build.sh` exits 1 on it before the contract
  preflight and before `prisma migrate deploy`** (step 2 — its message says
  what the flag DOES, and it needs nothing installed), and
  `scripts/bundle-guard.ts` refuses the same pair again after the compile
  instead of following the flag
  (`tests/unit/deploy/bundle-guard-deployment.test.ts` executes it). The two
  read the flag differently ON PURPOSE: vercel-build.sh takes `1 | true | yes`
  like `lib/env.ts` does, because it is asking what an operator MEANT;
  bundle-guard takes `"1"` only, because it is asking what is in the bytes,
  and `next.config.ts` inlines the literal `"1"` for nothing else — on `true`
  the hooks are never compiled and the ABSENCE rule is the correct one to run.
  Consequence for every step that starts a server: the environment has to be
  complete. **`npm run dev` works with the Google pair empty; `npm run start`
  does not.** From the README's `.env.local` a `next start` prints "Ready" and
  then answers 500 for every page, and the reason is only in its log:
  `EnvValidationError`, `AUTH_GOOGLE_ID is required in production` (measured).
  A local production server needs a non-empty pair — any value, as `.env.test`
  has — and `AUTH_URL`; `.env.example` says so beside the pair.
  `scripts/ci/{build,lighthouse}.sh` call
  `load_env_contract_defaults` (`scripts/ci/_lib.sh`), which fills unset
  variables from the committed `.env.test` — **never the three test flags**,
  which a step sets deliberately or not at all
  (`tests/unit/deploy/env-contract-defaults.test.ts` runs the function and
  checks both halves, and pins the wiring below). **`npm run lhci` is
  `bash scripts/ci/lighthouse.sh`** for that reason: a bare `lhci autorun`
  starts `npm run start` from whatever the shell holds and takes "Ready" as
  its cue, so from that `.env.local` it would go on to audit a server that
  answers 500 (the server's half measured; lhci itself was not run against
  it). The price is WHICH DATABASE: the defaults include the database URLs,
  and an exported variable beats every `.env*` file `next start` loads, so a
  local `npm run lhci` audits a server on `.env.test`'s `_test` database, not
  `.env.local`'s — export `POSTGRES_URL` and `POSTGRES_URL_NON_POOLING` to
  point it elsewhere. Arguments after `npm run lhci --` are not forwarded to
  lhci. Playwright (and so perf) already load `.env.test` in
  `playwright.config.ts` and need nothing.
  `tests/boot/env-contract.test.ts` spawns the real server for four cases; see
  the `boot` project under "Quality gates".
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
  same `startedAt` as the same run, so a re-finish updates its own lines —
  and, since W5, a re-finish is the ONLY thing allowed to delete one: a run
  that is already the open list's `checkupId` may drop the rows it wrote and
  no longer derives (the visitor withdrew the verdict), while every other
  finish only adds, reopens or closes. The
  wizard stamps every NEW run with `createCheckupState`'s now — including after
  a finished checkup reached through `?step=`, which only positions the new run
  — and resumes only an unfinished stored run (`tests/e2e/checkup-second-run.spec.ts`).
  Before W4 a second checkup reused the finished one's `startedAt` and was
  written INTO it (`.debug/013` §6).
- **Quotas (§4.2 c), literally**: 20 bikes/user, 50 checkups/bike, 10
  lists/bike, 50 lines/list, each `TOO_MANY`, each checked BEFORE the first
  write. `finishCheckupAction` names the limit in `fieldErrors.form`
  (`checkup.finish.tooMany{Checkups,Lists,Lines}`); the wizard shows it as
  `role="alert"` and stays on the summary. Since W5 the two list limits are
  counted over the bike's OPEN list, not over the checkup: `listsPerBike` only
  on the path that would CREATE one, which a bike with an open list never
  takes — so ten lists is reachable only by a bike whose lists something
  closed, and nothing writes `BuildList` `DONE`/`ARCHIVED` yet
  (`docs/backlog.md`) — and `itemsPerList` over the union of the lines that
  list already holds and the pairs this checkup derives (less the ones a
  re-finish prunes), so the 50 cannot be walked past one checkup at a time.
- **One OPEN build list per bike** (W5 ruling). `finishCheckupAction` does not
  open a list of its own: it merges into the bike's newest `OPEN` `BuildList`
  — by the very rule `/liste` renders with (`loadBuildList`) — and creates one
  only when the bike has none. `BuildList.checkupId` is no longer unique; it
  records the LAST checkup that wrote there. A derived pair updates its row
  (`reasonKey`, `guideSlug`, `checkupItemId`, `sortOrder`) and REOPENS it,
  never touching the `refinement` / `chosenProduct` the visitor typed; a pair
  `recheckedLines` names is closed `recheck-ok` on that same list — the
  old "every list but the current one" exclusion is gone, and is not needed
  because `recheckedLines` already excludes what this state's KOs derive; a
  hand tick survives only a re-finish of its own run. Everything else
  survives, across as many checkups as the bike has. This is the guest's
  `mergeGuestBuildList` semantics, and
  `tests/unit/checkup/line-identity.test.ts` now asserts the two paths produce
  the SAME list, line for line, over all seven presets.
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
  **`BuildList.checkupId` stopped being unique** in
  `20260930094543_one_open_build_list_per_bike` (W5), written the same way from
  the schema as `origin/main` had it: `DROP INDEX "BuildList_checkupId_key"` +
  `CREATE INDEX "BuildList_checkupId_idx"`, and `Checkup.buildList BuildList?`
  became `buildLists BuildList[]`. No data migration — a bike that already
  holds one list per checkup keeps them, and its newest OPEN one is the one
  every later checkup writes into. `tests/integration/schema.test.ts` holds
  both indexes and the `SetNull` that still fires for two lists at once.
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
  object, and on Next 16.3.4 — re-checked on 16.3.6, where the built `/fr` and
  `/en` documents still carry the `app/[locale]` card — an explicit `openGraph`
  in a descendant segment replaces the parent's, images included. An
  `app/opengraph-image.tsx` at the app root (where §1.1 draws it) therefore
  reached exactly one route, Next's own `/_not-found`, which then warned five
  times per build that it had no `metadataBase` to resolve it against, while
  `/fr` and `/en` built with no `og:image` at all. The site card lives in
  `app/[locale]/`; the guide card already lived beside its page, which is why
  that one always worked. An image route inherits no `params` from the layout
  above it either — both spell out their own `generateStaticParams`.
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
- **A generator never decides whether to touch someone else's file by asking
  first.** `scripts/gen-illustration-placeholders.ts` writes a placeholder with
  the exclusive `wx` flag (catching `EEXIST`) and reads the barrel and the
  component folder with `ENOENT` caught as a value — no `existsSync` anywhere.
  For a placeholder, test and use are one syscall, so "a real drawing is never
  touched" stops being a convention the script follows and becomes one the
  kernel enforces (CodeQL `js/file-system-race`). The barrel is still
  read-compare-write, two syscalls apart, and that is fine: the generator is its
  only writer, and rewriting its own output is not a race over anyone's work. **No CI job runs it**, so the table under
  "What it prints" in [`docs/illustrations.md`](./docs/illustrations.md) is the
  only guard its output has: change a line there in the commit that changes it
  here.
- **Nothing in `scripts/gen-common-passwords.ts` names a line of the list
  `password`.** CodeQL's `js/clear-text-logging` takes the identifier as its
  source and follows `.length` into `console.log`, so a script that only ever
  prints counts still raised three high alerts. The names are `entry` /
  `entries`, in `normalizeList`, `renderModule` and `main` alike — renaming one
  and not the others only moves the alert. `lib/auth/common-passwords.ts` is
  byte-identical output: `npx tsx scripts/gen-common-passwords.ts --check` is
  the proof.

---

## Quality gates

Every gate but CodeQL is a `scripts/ci/*.sh` script that runs the same way
locally. `npm run ci:local` chains them all except the browser tiers (e2e, perf,
Lighthouse), which need a production build and run on their own, and the three
workflows that sit outside the PR gate set: `visual-baseline-guard`,
`renovate-config-validator` and `migrate-preview` (the last is not a gate at
all — it deploys).

- ESLint + Prettier, `tsc --noEmit`, content validation. `npm run content:check`
  runs `--strict` (the corpus-level ★ rules) since the W2-T4 guides landed.
- **The `boot` Vitest project** (`tests/boot/**`) spawns `next start` against
  the build ON DISK and asserts the environment contract on a real server, in
  four cases. `VERCEL_ENV=production ENABLE_TEST_PAGES=1` never answers
  `/api/health` — three 500s on Next 16.3.6 — and logs the
  `EnvValidationError` with the variable's name. That same refused server
  still serves `/tree-drawings.json`: an observation the design leans on, not
  a requirement, held so it cannot quietly stop being true — it is why the
  BUILD refuses the hooks. The same build with all three flags on and no
  `VERCEL_ENV` boots, serves `/api/health` and prints no `[env]` line. And a
  clean deployment boots and logs
  `[env] contract enforced (VERCEL_ENV=production)`.
  **The two cases that must boot take the FIRST answer `/api/health` gives.**
  A 500 there is a verdict (see the contract above), so it fails the case at
  once with the server log in the message — about 0.4 s, where the retry loop
  this replaced polled to a 90 s deadline. Only a refused connection, "the
  port is not bound yet", is retried; never assert on an exit code, because
  Next keeps the process alive after `register()` throws.
  **It tests the build, not the working tree**: it builds nothing itself, so
  with `getEnv()` removed from `instrumentation.ts` and `.next` left as it was
  it stays green (`tests/unit/deploy/instrumentation.test.ts` is what fails on
  the edit). `scripts/ci/build.sh` always builds first and runs it after the
  boot check — ONE line, the only link between `tests/boot/` and any gate,
  which `tests/unit/deploy/boot-tier-gate.test.ts` holds in place.
  `vitest.config.ts` defines the project only when `.next/BUILD_ID` exists
  (or `--project boot` names it — without a build that fails in the spec's own
  guard), so `npm test` in a fresh clone never sees
  it — and it is NOT in `tests/integration/`, where the CI `integration` job's
  buildless checkout would have made it skip vacuously.
  **It needs a reachable database**, like `build.sh`'s own boot check one step
  earlier: without one the two must-boot cases fail in about half a second
  each on a 503 — the contract accepted the server, the route could not reach
  its database.
  **Its child servers read `.env.local`** (and `.env.production.local`,
  `.env.production`, `.env`) for every variable the spawn environment LACKS:
  `next start` fills those in, and never overrides one that is defined. So
  REMOVING a flag from a child's environment does not turn it off in a
  checkout set up as the README says — `.env.example` ships all three as `1`,
  and the "clean deployment" case was refused in exactly such a checkout
  (reproduced in review: green wherever there is no `.env.local` — a fresh
  worktree, a simulated CI job environment — and red beside the documented
  `.env.local`; the tier itself had not run on GitHub Actions). That case pins
  the three to `"0"` instead; a new case that needs a variable off must do the
  same.
- Vitest projects `unit | ui | bike3d | integration | security | boot`; coverage
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
- **Two path-filtered workflows, neither of them a required context.**
  `renovate-config.yml` runs `renovate-config-validator`
  (`scripts/ci/renovate-config.sh`, which also takes a path) on a pull request,
  and on a push to `main`, that touches any of THREE paths: `renovate.json`,
  that script, and the workflow file itself. Nothing else here reads
  `renovate.json` against Renovate's schema — not ESLint, not `tsc`, not
  `$schema`; Prettier formats it and one unit test parses it as JSON — and an
  invalid one stops Renovate dead, with no PRs and not even a dependency
  dashboard (`.debug/016` §4). The other two paths are the test of the test:
  the validator's version is pinned IN the script and Renovate bumps it by a
  pull request that edits the script alone, so filtered on `renovate.json`
  only — as the job first was, under a comment that said "validated by this
  very job" — it would not have started on its own bump. Expect that bump, and
  its cold install, about weekly (inferred in review from Renovate's source
  and release cadence; no such PR exists yet). It passes **`--no-global`**,
  and must: handed a filename the validator applies the self-hosted GLOBAL
  schema, which is WIDER than the repository schema the service applies —
  `baseDir` and `redisUrl` pass as a global config and are refused in a
  repository one — so without the flag the gate is quietly weaker than the
  thing it stands in for. That validator is also **pinned**
  (`RENOVATE_VERSION`, kept current by a `customManagers` entry in
  `renovate.json`, which is why nothing but the regex may share that line): it
  is downloaded by `npx` rather than installed, because it is the whole
  ~350 MB of Renovate for one path-filtered job — but never `@latest`, which
  would run whatever the registry served that minute, outside the lockfile,
  invisible to `audit-ci` and never held the seven days `minimumReleaseAge`
  holds everything else (Renovate ships several releases a day, so the pin is
  a version at least that old). `tests/unit/ci/renovate-config.test.ts` holds
  THREE facts — the flag, the pin and the VERDICT: it runs the script against
  a stand-in `npx` that exits 1 and expects the script to exit 1 with it,
  because `|| true` after the validator, an `if !` around it, or
  `continue-on-error` on the job each left every test green. A weakened
  validator and a working one print the same green tick. **A test that puts a
  stand-in `npx` on `PATH` spawns the script with an empty `HOME`**:
  `scripts/ci/_lib.sh` runs `nvm use` when `$HOME/.nvm/nvm.sh` exists, nvm
  then puts its own `bin` first, and the real `npx` wins (measured) — which
  for this script is a unit test downloading all of Renovate. **And every
  spawn of that script goes through the stand-in**, the case that expects the
  script to stop BEFORE `npx` included: it asserts the stand-in's marker
  ABSENT, so a regressed guard reaches a three-line shell script and never the
  real `npx` (the missing-file case used to run with the inherited
  environment). And green is not the service's acceptance: the validator does
  not resolve top-level `extends` presets (read from 44.108.1's source, not
  from a run), and since the context is not required GitHub merges past a red
  one.
  `migrate-preview.yml` runs `prisma migrate deploy`
  (`scripts/ci/migrate-preview.sh`) against the shared Neon `preview` branch on
  a push to `main` touching `prisma/migrations/**`, and on `workflow_dispatch`
  — which is also the bootstrap. `scripts/vercel-build.sh` migrates only when
  `VERCEL_ENV=production`, so nothing else ever migrates `preview` and W5
  found it with no `_prisma_migrations` table at all (`.debug/016` §3).
  **That push trigger has a silent limit**: per GitHub's documentation, not
  observed, a `paths:` filter is evaluated on the first 300 changed files of
  a push, and a migration outside them starts NO run — not red, not green.
  The filter stays (without it every push to `main` hands the connection
  string to a run with nothing to migrate), so after a merge of more than
  about 300 files that carries a migration, check
  `gh run list --workflow=migrate-preview.yml` and dispatch if no run
  started. The largest merge so far changed 343 files and carried none.
  **No documented command takes the connection string as an argument, and none
  may**: a command line is a line of the shell's history file. The
  maintainer's procedure is `docs/deploy.md` §4.5; the one by-hand form left
  reads the string from a prompt and costs a rotation.
  **Its inputs are one secret and two variables, on the `env:` of the migrate
  STEP and nowhere else**: `NEON_PREVIEW_DIRECT_URL` (secret),
  `PREVIEW_MIGRATIONS_ENABLED` (`1`) and `NEON_PREVIEW_ENDPOINT` (the first
  label of the preview host minus its trailing `-<id>` — public, `.debug/016`
  §3 prints it; read it from there or from `docs/deploy.md` §4.5, never from
  the panel the string is copied from, where a wrong branch selector agrees
  with itself). The job's own `env:` is `HUSKY` alone, so the checkout,
  `setup-node` and `npm ci` — ten dependencies' install scripts and this
  project's `postinstall` — never hold the string, and the checkout keeps no
  token (`persist-credentials: false`). A narrowing, not an isolation: that
  step still runs `prisma`, `dotenv` and `lib/db/env.ts` with it. `npm ci` keeps
  its lifecycle scripts, unlike the `--ignore-scripts` install in `perf.yml`:
  whether `migrate deploy` finds its schema engine without them was not
  verified.
  **The script refuses, in this order and before anything is contacted**: any
  ref but `refs/heads/main` (a dispatch on a feature branch would apply THAT
  branch's unmerged migrations to the database every open PR reads); a switch
  value other than `1`, whatever the secret; an empty secret once the switch
  is `1`; a secret WITHOUT the switch; an empty or malformed
  `NEON_PREVIEW_ENDPOINT` (it fails closed); a value that is not a well-formed
  connection URL — exactly one `@`, a username, a hostname within
  `[A-Za-z0-9.-]`, a path that is a bare database name, no `host` query
  parameter (Prisma 7.10.0 dials `?host=` instead of the URL's host) — all
  answered by ONE generic line that prints nothing from the value; a host that
  is not the named endpoint (production is in the same Neon project, one
  branch selector away, and the first version migrated a production-shaped
  host green under a summary that said `preview`); and a `-pooler` host (an
  advisory migration lock does not survive a transaction pooler). Two of
  those orders decide an answer and are each held by a case: the ref guard
  comes before the bootstrap's skip (a dispatch on a feature ref with nothing
  set up is red, not a green skip), and the endpoint before the pooled check
  (production's POOLED string is "not the preview endpoint", never "fetch the
  DIRECT one"). The refusals echo nothing they have not cut or held to a
  charset: a mistyped switch is printed only when it is letters and digits,
  eight at most, otherwise by its length — a variable is a field somebody
  pastes a connection string into — and when both sides of an endpoint
  mismatch are cut to the same 14 characters the message says the difference
  is past them.
  **One refusal comes AFTER the run: Prisma must not have CREATED the
  database.** The endpoint is asserted; the database NAME is not, and
  `migrate deploy` creates a database that is missing. On 7.10.0, against the
  local test server, a path naming one that did not exist printed
  `PostgreSQL database <name> created at <host>:<port>`, applied every
  migration to it and exited 0 — green, with the database the previews read
  untouched. `preview` never has a database to create, so the script greps
  Prisma's (already redacted) output for that line and exits 1, with no
  summary. The match is Prisma's wording, which is why
  `tests/integration/migrate-preview.test.ts` has the real Prisma create a
  scratch `_test` database (and drops it): a stand-in would go on printing
  the old line through an upgrade that reworded it. **Not caught**: a path
  naming ANOTHER database that already exists on the endpoint — migrated,
  green; the `→ <host>/<name>` line is the only tell, and a fourth input
  naming the database is the fix nobody has made.
  **Exactly one path is green without running `migrate deploy`**: no secret
  AND no switch, the bootstrap's skip. Every other green run is Prisma
  exiting 0 on the endpoint asserted, on a database that already existed —
  the one the secret's path names. GitHub hands a step the empty string for a
  secret that does not exist, so the switch is what stops that skip coming
  back the day the secret is deleted or renamed — and it is read on EVERY
  run: read only when the secret was empty, as it first was, a typo or a
  forgotten variable was green and silent with the secret present.
  **"`main` only" is the dispatched ref's own copy of the script**: it stops
  an accidental `--ref`, not a branch that edits the script; GitHub hands that
  run the repository secret all the same; outside Actions the guard says
  nothing. A GitHub Environment restricted to `main` is the upgrade, and it is
  not set up.
  **The log is public, `$GITHUB_STEP_SUMMARY` included**, so it shows the
  first 14 CHARACTERS of the host and the database name and no more — the
  endpoint's two words only because both endpoints are `ep-` + 5 + 5 letters.
  Truncating the script's own line is not what achieves that, and on its own
  it achieved nothing: `migrate deploy` prints
  `Datasource "db": … at "<the whole host>"` on the very next line and repeats
  the host in a P1001, so its output (both streams) is piped through `sed` —
  the full host and, when it is longer than 14 characters, its first label on
  its own, dots escaped; the hostname charset above is what keeps that
  program a literal match — and then through `tee`, which keeps the redacted
  text for the summary. The summary is written only on exit 0 and is Prisma's
  own words under one factual sentence: the script never says "applied".
  `pipefail`, set in `scripts/ci/_lib.sh`, is load-bearing through both
  filters: it is what still reds a failed migration, and a run with the pipe
  and without it is green on P1001.
  **Its concurrency block holds one run in progress and ONE pending.**
  `cancel-in-progress: false` on one fixed group means never cancelled in
  flight and never two at once; per GitHub's documentation a newly queued run
  replaces the pending one. Harmless between pushes to `main`, since
  `migrate deploy` applies everything not yet applied; a mistaken `--ref`
  dispatch can displace a pending `main` run (read from the documentation,
  not observed). It is also the only job in the repository with a
  `timeout-minutes`, because it is the only one whose queue is a database's
  migrations: other workflows queue their `main` runs too, and a hung run
  there delays a CI result, where one hung here on a connection or a DDL
  statement would block the preview SCHEMA for GitHub's six-hour default
  (Prisma's advisory-lock wait has a timeout of its own and is not what this
  bounds).
  Neither workflow may ever join `REQUIRED_CHECKS`: every `ci.yml`
  job runs on every PR precisely because a path-filtered required context never
  reports on most of them and blocks the merge for ever (`.debug/016` §2,
  PR #8). `tests/unit/ci/required-checks.test.ts` parses both files, holds
  `renovate-config-validator` in `NON_BLOCKING_CONTEXTS` and the RULE behind
  it (no workflow whose pull-request trigger carries `paths` or `paths-ignore`
  produces a required context), and asserts on the PARSED YAML that neither
  the validator's job nor any of its steps carries `if` or
  `continue-on-error` (a text pattern did not see `- if: false`). For
  `migrate-preview` it asserts that the workflow is never triggered by a pull
  request and never a required context — a dispatch aimed at a PR's branch
  still leaves a red, non-required check on its head commit — that the job
  has no `if:`, that its migrate step is EXACTLY `run` + `env` (a step-level
  `if:` is a green job that migrated nothing; `continue-on-error`, `shell`
  and `working-directory` fail it too), that it keeps its concurrency block
  and its read-only token, and that nothing else in the file holds the word
  `secrets` at all (`toJSON(secrets)` and `secrets[…]` got past a search for
  `secrets.`), and — a `run:` being a string nothing resolves — **stats every
  `scripts/…` path any workflow names**, since deleting one used to leave
  every test green. `tests/unit/deploy/migrate-on-deploy.test.ts` EXECUTES
  `migrate-preview.sh` for every refusal above and for the success path,
  against a stand-in `npx` that answers 0: a guard that merely warns then ends
  in a green "migration" and fails its test (the first version's ref and
  pooled tests stayed green with the guard's `exit 1` deleted, because a later
  step supplied the exit code). One case runs the real `prisma migrate deploy`
  against an unresolvable `.invalid` host (RFC 2606), because only Prisma's
  own output can show that the redaction still matches it; and
  `tests/integration/migrate-preview.test.ts` runs the unmodified script with
  the real Prisma against the tier's `_test` database — the one green run with
  nothing stubbed — and into a scratch database that does not exist, the one
  red run Prisma itself calls a success. A grep would pass against a script
  that never branched on the variable at all.
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
- **Lighthouse**: `scripts/ci/lighthouse.sh` — which is also what
  `npm run lhci` runs, never a bare `lhci autorun` (see the environment
  contract: the server lhci starts has to be given a complete environment) —
  runs `lhci autorun`, then
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
  `tests/perf/baselines/*.json` through `scripts/perf/ladder.ts`: warn > 150 %,
  fail > 300 %, long frames on `(run+1)/(baseline+1)` (the fail line sits two
  frames later than a plain ratio at every non-zero baseline) and **never above
  a warning on a software renderer** — the W4 ruling: on SwiftShader the count
  swings 0–6 between repetitions of identical code, and the first comparison
  failed at 6 against a median of 1 (`.debug/012` §12); the four durations keep
  their failure. `scripts/ci/perf.sh` runs the two projects
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
  **`audit` fetches advisories live, so it can go red with nothing in the repo
  changed** — that is the design, not a flake. Fix first (`overrides`, or
  `npm update <pkg>` when the parent's range already admits the patch), and
  allow-list only what has no reachable patch, with the reason in
  `audit-ci-allowlist.md`. A CodeQL alert is either fixed in code or dismissed
  by the maintainer with a written reason: **an agent never runs a dismissal**,
  because it changes the repository's security record.

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
