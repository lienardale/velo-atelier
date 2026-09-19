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
npm run build          # tree drawings, content-check, then next build
npm run drawings       # render the decision tree's drawings to public/tree-drawings.json
npm run drawings:check  # fail if that file is stale (runs in scripts/ci/content.sh)
npm run lint           # ESLint (flat config)
npm run format:check   # Prettier
npm run typecheck      # prisma generate && tsc --noEmit
npm test               # every Vitest project
npm run test:coverage  # Vitest + the 80 % gate (this is the gate, not a report)
npm run e2e            # Playwright (needs a production build first)
npm run e2e:mobile     # Playwright on the mobile profiles
npm run e2e:docker     # full Playwright suite in the amd64 container
npm run lhci           # Lighthouse CI
npm run db:up          # docker compose up -d --wait
npm run db:setup       # docker compose + migrate + seed (localhost only)
npm run db:reset       # destroy the volume and rebuild from scratch
npm run content:check  # validate content/** frontmatter
npm run ci:local       # local mirror of the GitHub Actions pipeline
```

---

## Folder layout

No `src/`. The `@` alias is the repository root.

```
app/[locale]/…       routes (FR default, EN via routing.pathnames)
auth.ts auth.config.ts proxy.ts     Auth.js split; proxy.ts is Node-only in Next 16
lib/domain/          pure TS data + engine — zero React, zero Prisma
lib/bike3d/          pure geometry (three imports allowed, no React)
lib/content|checkup|shop|geometry|bike|guest|auth|security|db|actions|i18n|hooks
components/ui/       generated shadcn — do not hand-edit
components/ui-ext/   hand-rolled primitives (Stepper, Callout, MobileSheet, …)
components/i18n/     ClientMessages — the per-route next-intl provider
components/bike3d/   R3F scene; components/bike3d/parts/** are declarative only
content/             MDX guides + YAML data (CC BY-SA 4.0)
messages/{fr,en}/    one JSON file per namespace
prisma/              schema, migrations, seed
tests/               unit, ui, bike3d, integration, security, e2e, perf
scripts/             ci/, db/, perf/, content tooling
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
  declared per route.** `lib/i18n/request.ts` still merges all 13 namespaces for
  `getTranslations`. `NextIntlClientProvider` does not: every route mounts
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
  namespace** requires all 13 (which is why five `/velo` and `/compte`
  components still pin their routes to the whole catalogue). Making a route
  lighter means making what it reads visible: `useDecisionText()`
  (`components/decision-tree/decision-text.ts`) is how the tree does it.
- **Navigation** — always import `Link`, `redirect`, `usePathname`, `useRouter`
  and `getPathname` from `@/lib/i18n/navigation`, never from `next/link` or
  `next/navigation`.
- **URL state** — the App Router has no shallow routing. Decision-tree answers
  and `?part=` are written with `history.replaceState` / `pushState`, and every
  `useSearchParams` consumer sits inside a `<Suspense>` boundary.
- **`server-only`** is imported only in `app/**` server files,
  `lib/auth/password-policy.ts` and `lib/actions/with-user.ts`. Everything
  reachable from `prisma/seed.ts` and `scripts/**` must be plain Node.
- **Prisma** — import the client from `@/lib/generated/prisma/client`, never
  from `@prisma/client` (ESLint enforces it; a type-only import is allowed for
  the adapter cast in `auth.ts`).
- **No logic in `components/bike3d/parts/**`** — no `if`, no ternary, no `&&`
  rendering, no loops. Decide in `lib/bike3d/**`, pass a prop. ESLint enforces
  it via `no-restricted-syntax`.
- **Illustrations are RSC-rendered** — `components/illustrations/index.ts` is a
  72-component barrel. Only server files may import it: guides go through
  `components/mdx/Illustration.tsx`, the decision tree through
  `components/decision-tree/tree-illustrations.tsx`, which hands the client tree
  already-rendered nodes. A `"use client"` file that imports the barrel puts all
  ~70 drawings in the route's first-load JS. A drawing with numbered
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
- **The home page's `<h1>` block sits above the tree's `<Suspense>` boundary**
  (`app/[locale]/page.tsx` → `DecisionTreeFrame hero=`). It is the LCP element,
  and React destroys a fallback's DOM when the hydrated tree replaces it —
  Chrome then reports the re-created node as a second, much later LCP candidate.
  Every other page of the site has LCP == FCP; the home page did not.
  `DecisionTreeSkeleton.test.tsx` fails if the heading moves back inside.
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
- **The `/velo/[id]` route** — no `generateStaticParams` and no `loading.tsx`
  under `app/[locale]/velo/[id]/`, and both absences are load-bearing (see
  `.debug/006`). Enumerating `demo` makes every UUID render in Next's on-demand
  _static_ mode, where reading the session is `DYNAMIC_SERVER_USAGE` (a 500); a
  `loading.tsx` streams the response, so the `notFound()` for a foreign bike can
  no longer set a 404. A route-level `loading.tsx` anywhere must also be
  **silent**: it gets no `params`, so it cannot `setRequestLocale`, and one
  `useTranslations` in it turns the whole segment dynamic.
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

Every gate runs locally exactly as it runs in CI (`npm run ci:local`).

- ESLint + Prettier, `tsc --noEmit`, content validation. `npm run content:check`
  runs `--strict` (the corpus-level ★ rules) since the W2-T4 guides landed.
- Vitest projects `unit | ui | bike3d | integration | security`; coverage
  thresholds 80 % overall, 100 % on `lib/domain/**`.
- Playwright on desktop, Pixel 7, landscape, 320 px, WebKit (non-blocking) and
  a no-WebGL profile; axe sweep with zero serious/critical violations. e2e runs a
  production build (`ENABLE_TEST_PAGES=1 NEXT_PUBLIC_TEST_HOOKS=1 npm run build`
  first) and reuses a running server locally — stop stale servers on :3100. Each
  test gets its own `x-real-ip` so rate limits never collide between tests. Use
  `--project=<name>` (equals form): `--project` is variadic and eats a spec path.
  `PLAYWRIGHT_PORT` moves the whole run (one per worktree): `AUTH_URL` and
  `NEXT_PUBLIC_SITE_URL` are derived from it, and `.env.test`'s pinned `:3100`
  never wins — only a value exported in the shell does. A test database's name
  must end in `_test` (`assertTestDatabaseUrl`).
- **A green local e2e run does not mean CI is green.** CI's Linux Chromium is a
  different browser build with software GL, and at least one input API scrolls
  on macOS while doing nothing there (`.debug/005`). Reproduce a CI-only failure
  with `npm run e2e:docker -- <playwright args>` (`scripts/ci/e2e-docker.sh`),
  which runs the CI image on the compose network; build on the host first.
- Bundle budget is a per-wave ratchet: `perf.budgets.json` ceilings are re-pinned
  at each wave integration to measured + 10 % (sizes print as KiB).
  `npx tsx scripts/perf/bundle-budget.ts --json` prints the raw gzip bytes and
  the `nextPin` to write; the pin history in `perf.budgets.json` says why each
  jump happened.
- Lighthouse CI, a bundle budget, and WebGL draw-call/triangle counters.
- gitleaks, `audit-ci`, semgrep, trivy, CodeQL.

Husky runs the fast subset pre-commit and the full local mirror pre-push.

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
