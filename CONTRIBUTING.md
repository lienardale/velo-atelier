# Contributing to vélo-atelier

Thanks for wanting to help people fix their own bikes.

**Language policy.** `README.md` is bilingual (FR + EN). Everything else in the
repository — code, comments, commit messages, issues, pull requests, these docs,
`.debug/` notes — is in **English**, so that contributors who do not read French
can work here. **Vous pouvez écrire en français** dans une issue ou une PR si
c'est plus simple pour vous : quelqu'un traduira. What the _visitor_ reads is
the exact opposite: guides (`content/**`) are written in French first, and the
English version is mandatory before merge; every interface string exists in
both `messages/fr/` and `messages/en/`.

---

## Getting set up

The README's quick start is the reference sequence (§4.8 AC1). Day to day:

```bash
nvm use                 # Node 24 (.nvmrc)
npm ci                  # exactly package-lock.json; never --legacy-peer-deps
cp .env.example .env.local
npm run db:setup        # Docker Postgres + migrate + seed (Docker must be running)
npm run dev             # http://localhost:3000
```

npm only: no `pnpm`, `yarn` or `bun`, and no committed `.npmrc`. When you add a
dependency, always give a range (`npm install <pkg>@<range>`): the latest
`typescript` (7.x), `eslint` (10.x) and `@types/node` (26.x) are majors this
repository cannot take yet.

The demo accounts live in `prisma/seed-data.ts` (and in the README); the e2e
fixtures import that file, so the seed and the tests can never disagree.

## Before you push

```bash
npm run ci:local        # bash scripts/ci.sh — the exact scripts CI runs (scripts/ci/*.sh)
```

`.husky/pre-push` runs the same script with `SKIP_BUILD=1` (set `RUN_BUILD=1` to
include the build). `.husky/pre-commit` runs lint-staged (ESLint and Prettier on
the staged files, the content check on staged `content/` and `messages/` files),
`tsc --noEmit`, `vitest related` on the unit and ui projects, and
`gitleaks protect --staged` when gitleaks is installed. A step whose target does
not exist prints `SKIP` in the summary table — never `PASS`.

| Knob                     | Effect                                                                    |
| ------------------------ | ------------------------------------------------------------------------- |
| `SKIP_BUILD=1`           | skip `next build` (the pre-push default; CI always builds)                |
| `SKIP_DB=1`              | skip the integration tier when Docker is not running                      |
| `SKIP_SECURITY=1`        | skip gitleaks / audit-ci / semgrep / trivy — never before a push          |
| `STEPS="lint typecheck"` | run only these steps, in this order                                       |
| `KEEP_GENERATED=1`       | keep the generated trees `ci.sh` otherwise deletes to mimic a fresh clone |

Browser suites are deliberately not in `ci:local`: they need a production build
and several minutes. Run them explicitly.

```bash
# build.sh, not `npm run build`: it serves the origin the tests expect (:3100)
# instead of .env.local's :3000, which seo.spec.ts and Lighthouse's SEO check.
ENABLE_TEST_PAGES=1 NEXT_PUBLIC_TEST_HOOKS=1 bash scripts/ci/build.sh
npm run e2e -- --project=desktop-chromium   # one project; --project is variadic, use the = form
npm run e2e:docker                          # the suite in CI's amd64 Linux image
```

### A production server on your machine

Every `next start` is a production server, and since W5 it validates its
environment before it answers (`instrumentation.ts` → `lib/env.ts`). Three
consequences for a checkout set up from `.env.example`; the reasons are in
[`CLAUDE.md`](./CLAUDE.md), under "Contracts to respect".

- **`npm run dev` works with `AUTH_GOOGLE_ID` / `AUTH_GOOGLE_SECRET` empty;
  `npm run start` does not.** Next prints "Ready" all the same and then answers
  500 for every page; the reason is only in the server's log
  (`EnvValidationError`, `AUTH_GOOGLE_ID is required in production`). Give the
  pair any non-empty value, as `.env.test` does, and keep `AUTH_URL` set.
- **`bash scripts/ci/build.sh` ends with the `boot` Vitest project**
  (`tests/boot/**`): four `next start` against the build it has just made,
  which need the Docker database up, like its own boot check one step earlier.
  The same project joins `npm test` and `npm run test:coverage` whenever
  `.next/BUILD_ID` exists, and there it tests whatever build is on disk, not
  your working tree: `rm -rf .next`, or name the projects you want
  (`--project=unit`), to run without it.
- **`npm run lhci` is `bash scripts/ci/lighthouse.sh`**, never a bare
  `lhci autorun`: the script gives the server lhci starts a complete
  environment from `.env.test`. That includes the database — the audited
  server runs on the `_test` database unless your shell exports
  `POSTGRES_URL` and `POSTGRES_URL_NON_POOLING`.

## Branches and commits

- Branch from `main`: `feat/decision-tree-help`, `fix/checkup-abandon`,
  `docs/retailers`.
- Conventional commits, scope required:
  `feat(checkup): mark a step as skipped`, `fix(bike3d): …`, `test(e2e): …`,
  `docs(guides): …`, `chore(deps): …`.
- One logical change per PR. A refactor and a behaviour change in the same diff
  cannot be reviewed.
- `CLAUDE.md` changes in the same commit as any architecture change (a folder,
  a naming contract, a script, an ownership boundary).
- `main` is protected at launch (W5, [`docs/deploy.md`](./docs/deploy.md)):
  linear history, no force-push, twenty required checks green. With linear
  history, a PR lands by squash or rebase, never as a merge commit.

## What CI will hold you to

- **ESLint + Prettier + `tsc --noEmit`.** No warning suppressed without a comment
  saying why.
- **Coverage**, as thresholds in `vitest.config.ts` that `vitest run --coverage`
  enforces by exiting non-zero: 80 % overall; 100 % on `lib/domain/**`; 100 % of
  the statements and branches of `lib/checkup/**`; `lib/**` at 90 % of lines,
  functions and statements and 85 % of branches; `components/**` at 75 % of
  lines, functions and statements and 70 % of branches.
- **Both locales.** Every user-facing string exists in `messages/fr/<ns>.json`
  _and_ `messages/en/<ns>.json`, with the same ICU placeholders;
  `tests/unit/i18n/messages-parity.test.ts` fails naming the missing keys.
- **Playwright** on desktop, Pixel 7, landscape, 320 px wide and with WebGL
  disabled (WebKit runs too, non-blocking). Mobile is not an afterthought here:
  the target user is holding a phone in a garage.
- **A build that boots.** CI's `build` job starts the production server it has
  just built — `/api/health` must report `ok` — and then runs `tests/boot/**`,
  which holds the environment contract on a real server: a deployment carrying
  a test flag is refused, a clean one boots.
- **Security tier**: gitleaks, audit-ci, semgrep, trivy and CodeQL, plus
  `tests/security/**` (IDOR, mass assignment, CSRF and origin checks, open
  redirects, rate limits, path traversal, quotas, …).

Two more workflows sit outside the twenty required checks, on purpose — beside
`visual-baseline-guard` (below) and the scheduled `perf.yml` (the reasons are
in [`CLAUDE.md`](./CLAUDE.md), under "Quality gates"):

- **`renovate-config-validator`** runs only on a pull request, or a push to
  `main`, that touches `renovate.json`, `scripts/ci/renovate-config.sh` or its
  own workflow file.
  It is not required — a path-filtered check that never reports would block
  every other pull request — so GitHub lets a PR merge with it red. Read it
  anyway: an invalid `renovate.json` stops Renovate entirely.
  `bash scripts/ci/renovate-config.sh` runs the same validator locally; its
  first run downloads the whole of Renovate, about 350 MB.
- **`migrate-preview` never runs on your pull request.** Every preview
  deployment shares one database, and that database receives a migration only
  after the migration has landed on `main`. So **if your PR adds a Prisma
  migration, its preview deployment runs your code against the old schema
  until the PR merges** — test the migration locally (`npm run db:setup`, then
  the integration tier), not on the preview. Dispatching the workflow on your
  branch is not the way round it: its script refuses any ref but `main`, so
  that one branch's unmerged migration never reaches the database every other
  preview reads ([`docs/deploy.md`](./docs/deploy.md) §1).

## Rules that surprise people

Enforced by ESLint (`eslint.config.mjs`), so `npm run lint` fails on them:

1. **No logic in `components/bike3d/parts/**`.** No `if`, no `switch`, no
   ternary, no `&&` / `||` / `??`, no `for` / `for…of` / `for…in` / `while` /
   `do…while` loop — `no-restricted-syntax` is scoped to that folder. Those
   components are declarative meshes. Every decision — which parts exist, where
   they sit, which variant to draw — belongs in `lib/bike3d/**`, where it is
   unit-testable without a WebGL context; pass the result as a prop.
2. **Prisma comes from `@/lib/generated/prisma/client`**, never from
   `@prisma/client` (a type-only import is allowed).
3. **Bundled code uses `zod/mini`**: classic `zod` is refused under
   `components/**`, `lib/checkup/**` and `lib/hooks/**`.

Enforced by tests:

4. **Client message namespaces are declared per route**
   (`lib/i18n/client-namespaces.ts`): a client component whose namespace is
   missing would render its keys, so `tests/unit/i18n/client-namespaces.test.ts`
   fails with the exact set to declare.
5. **No raw-HTML escape hatch outside `components/mdx/`** —
   `tests/security/xss-form-inputs.test.ts` greps every source file for it.

Held by review — no tool checks these, so reviewers do:

6. **Messages are keys, never strings.** A server action returns a key such as
   `errors.invalidCredentials`, and the form renders `t(code)`. French strings
   in TypeScript are a bug.
7. **Import `Link`, `redirect`, `usePathname`, `useRouter` and `getPathname`
   from `@/lib/i18n/navigation`**, never from `next/link` or `next/navigation`,
   or the locale prefix is lost. (`notFound`, `useParams` and `useSearchParams`
   still come from `next/navigation`.)

## Adding a guide

```bash
npm run content:new <kind>-<slug>    # e.g. npm run content:new replace-chainring
npm run content:check                # frontmatter, partIds, reasons, tools, callouts
```

`<kind>` is one of `check | replace | clean | adjust | measure`, and the slug is
kebab-case English. The script writes `content/guides/<slug>/{fr,en}.mdx` with
the same frontmatter in both (only the placeholder title, summary and step title
are in each file's language), `status: stub` and one `<Step>` placeholder, and
refuses to overwrite an existing guide. To pre-fill `partIds`, put the flags
after a `--` — without it npm keeps `--part` for itself and the guide is
scaffolded with `partIds: [frame]`:

```bash
npm run content:new -- replace-chainring --part chainring
```

- Write **French first**, then English. A guide without both is not merged.
- `kind` is the discriminator — the field is always `kind`, never `type`.
- Every `partId` must exist in `lib/domain`; every `KoConsequence` must point at
  a guide whose `kind` matches its `action` (`fix` maps to an `adjust` guide).
- Say what tools are needed **and their alternatives**. "You need a torque
  wrench" stops a beginner; "a torque wrench, or go slowly and check the marked
  value at a shop" does not.
- Anything involving hydraulic bleeding, wheel truing, bearing replacement or a
  motor/battery is an `inspect-shop` outcome, not a guide. Send people to a
  mechanic rather than to A&E.
- A drawing for the guide: [`docs/illustrations.md`](./docs/illustrations.md).
  The authoring rules and the template: [`content/README.md`](./content/README.md).

## Adding a user-facing string

1. Add the key to `messages/fr/<namespace>.json` **and**
   `messages/en/<namespace>.json`.
2. Namespaces are files; a new one is registered in `lib/i18n/namespaces.ts`
   (the list and the type map).
3. If a client component reads it, the route that renders the component declares
   the namespace in `lib/i18n/client-namespaces.ts`.
4. next-intl keys are leaves: a key is either a string or an object, never both,
   and an id that becomes a key segment never contains a `.`.

## Visual baselines and performance

- Screenshot baselines are pixel comparisons made in CI's amd64 Linux image,
  and committed baselines are recorded only by CI: the `perf.yml` workflow run
  with `update_snapshots=true` opens a PR labelled `visual-baseline`. Locally,
  `npm run e2e:docker -- --grep @snapshot` compares against them in the same
  image; `npm run e2e:update-snapshots` records into your working tree for a look
  only — never commit those, and never a PNG made by a laptop's own browser.
- A PR touching `tests/e2e/__screenshots__/**` must carry the
  **`visual-baseline`** label — a human saying they looked at every image. The
  `visual-baseline-guard` check fails without it.
- A PR touching `lib/bike3d/**` or `components/bike3d/**` must carry
  **`perf-verified`**: CI renders WebGL in software and cannot say whether a
  real device keeps its frame rate. The real-device procedure is in
  [`docs/bike3d-perf.md`](./docs/bike3d-perf.md).

## Reporting a problem

- A guide that is wrong or dangerous: open a **Guide error** issue. Please say
  which bike and which step.
- A security issue: **do not** open an issue — see [SECURITY.md](./SECURITY.md).

## Licences

Code is MIT. Everything under `content/` is CC BY-SA 4.0. By contributing you
agree your work is published under the licence of the directory it lands in.
