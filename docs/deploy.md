# Deploying vélo-atelier (W5)

The step-by-step skeleton for the launch wave: **W5-T1** (Neon, Vercel, Google,
repository settings) and **W5-T2** (the launch checklist). It was written in W4,
before anything was deployed: every step says **who** does it, **where** (the
exact command or console path) and **how to check** it. Fill in the results —
dates, the production domain — as W5 goes.

Placeholders: `<prod-domain>` is the production host — since 2026-09-29,
**`velo-atelier.vercel.app`**. No secret and no real connection string ever goes
in this file.

Almost every step needs an account only the maintainer holds (Neon, Vercel,
Google Cloud, GitHub as `lienardale`). An agent prepares and checks; the
maintainer clicks and pastes secrets.

---

## What W5 did, and when

Every row below was read back from the provider after the fact, never assumed.

| What                    | Result                                                                                                                                                           |
| ----------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Production host         | `https://velo-atelier.vercel.app` — the Vercel-assigned domain; no custom domain yet                                                                             |
| Neon project            | `velo-atelier` (`aged-bird-87792451`), AWS `eu-central-1` (Frankfurt), Postgres **16**, Free plan, 6 h history retention — created 2026-09-23                    |
| Neon branches           | `production` (default) and its child `preview` — see §1.2: the default branch is **not** called `main`                                                           |
| Vercel project          | `lienardales-projects/velo-atelier`, region `cdg1`, production branch `main` — created 2026-09-29                                                                |
| First production deploy | 2026-09-29, after one failure (`.vercelignore`, see §2). Migrations `20260911071112_init` and `20260921090547_checkup_symptoms_done_reason` applied at 08:11:43Z |
| Google OAuth client     | `velo-atelier production` (Web application), created 2026-09-29 — §3                                                                                             |
| Branch protection       | applied 2026-09-29: 20 contexts, `enforce_admins`, linear history, 0 reviews — §4.1                                                                              |
| Renovate                | app installed 2026-09-29; its first run rejected `renovate.json` — §4.4                                                                                          |

Still open at the end of W5-T1: the §5 launch checklist, the twelve CodeQL
alerts ([`backlog.md`](./backlog.md)), and the README's "_(W5)_" live-site line,
which §5.3 fills at tag time.

---

## What the repository already does

Read this before clicking anything: these are the behaviours the dashboards must
not contradict.

| Piece                     | What it does                                                                                                                                                                                                                                                                                             |
| ------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `vercel.json`             | `framework: nextjs`, `buildCommand: npm run vercel-build` (overrides the dashboard's Build Command), `regions: ["cdg1"]`, three security headers                                                                                                                                                         |
| `scripts/vercel-build.sh` | refuses `NEXT_PUBLIC_TEST_HOOKS=1` when `VERCEL_ENV` is set, then `prisma migrate deploy` **only** when `VERCEL_ENV=production`, then `npm run build`, then `scripts/bundle-guard.ts`; `tests/unit/deploy/{migrate-on-deploy,vercel-build-guard}.test.ts` pin that wiring                                |
| `instrumentation.ts`      | `register()` runs `getEnv()` once, before the server takes requests. A wrong environment makes the server serve **nothing** — every request 500s and the log names the variable — instead of an `undefined` deep inside Auth.js. Next does not run it during a build. It does not exit either: see below |
| `package.json`            | `engines.node: "24.x"`; `prepare` is `husky \|\| true`, so an install without `.git` never fails; `postinstall` runs `prisma generate`                                                                                                                                                                   |
| `next.config.ts`          | security headers and a static Content-Security-Policy on every route                                                                                                                                                                                                                                     |
| `GET /api/health`         | a real `SELECT 1`: `200 {"ok":true,"db":true}`, or `503 {"ok":false,"db":false}`; never cached                                                                                                                                                                                                           |
| `prisma/seed.ts`          | refuses `VERCEL_ENV=production` outright, and any non-local host unless `ALLOW_REMOTE_SEED=1` (`lib/db/guard.ts`), which is never set against Neon: **Neon is never seeded**                                                                                                                             |
| `.vercelignore`           | keeps `.debug/`, `.claude/`, `docs/`, the screenshot baselines and the perf baselines out of the upload. **`tests/` itself stays**: `next build` type-checks the `*.test.ts(x)` files beside the code, which import `@/tests/_helpers` and `@/tests/_fakes` (see the first-build failure in §2)          |

**The three test flags are refused at boot, on every scope** (W5). `getEnv()`
has a caller — `instrumentation.ts` — so `ENABLE_TEST_PAGES`,
`NEXT_PUBLIC_TEST_HOOKS` and `NEXT_PUBLIC_DEMO_LOGIN` now fail a deployment
instead of being a rule nothing read. Four things to know about the shape of
that guard:

- **It keys off `VERCEL_ENV` being set, not off "production".** The `next` CLI
  defaults `NODE_ENV` to `production` for every command but `dev`, so every
  `next start` is a production server — CI's boot check, Playwright, Lighthouse
  and perf included, and all four start one on purpose with the flags on.
  `VERCEL_ENV` is set by Vercel and by nothing else. Consequence: **a preview
  deployment is refused too**, which is right — a preview URL is public.
  `AUTH_URL` and the Google pair are unchanged: still required when
  `VERCEL_ENV=production` (or `NODE_ENV=production` with no Vercel), still not
  on a preview.
- **`NEXT_PUBLIC_TEST_HOOKS` is caught earlier, by `scripts/vercel-build.sh`.**
  The bundler inlines it and Next does not run `register()` during a build, so
  by the time a boot check could object, `window.__va` would already be
  compiled in. The script exits 1 before `prisma migrate deploy`;
  `scripts/bundle-guard.ts` refuses the same pair a second time after the
  compile.
- **Everything the contract requires must therefore be present, or the
  deployment serves nothing**: both database URLs, `AUTH_SECRET` and
  `NEXT_PUBLIC_SITE_URL` in every scope; `AUTH_URL` and the Google pair in
  Production. That is the table below, and it is now load-bearing rather than
  advisory.
- **What a refusal looks like, measured on Next 16.3.4.** Not a crash, and not
  an exit code: `NextNodeServer`'s constructor fires
  `this.prepare().catch(err => console.error("Failed to prepare server", err))`,
  so the error `register()` raises is logged and swallowed and
  `start-server.js`'s `process.exit(1)` is never reached. The socket stays
  bound and **every request answers 500** for as long as the process lives.
  Operationally: `/api/health` returns 500 rather than 200 or 503, the log
  carries `EnvValidationError` and the variable's name, and nothing is ever
  served — so the deployment is visibly, totally down, which is the intent.
  On Vercel it shows up as a function error on every invocation.
  **How to diagnose it** on a deployment that answers 500 everywhere: read the
  runtime logs for `EnvValidationError`, fix the named variable in the right
  scope, and redeploy.

`tests/boot/env-contract.test.ts` (the `boot` Vitest project, run by
`scripts/ci/build.sh` after the build) spawns the real thing: a deployment
carrying a flag serves nothing and logs the reason, a local production server
with all three flags on boots, and a clean deployment boots.

---

## 1. Neon — who: the maintainer (Neon account)

| Step | Where                                            | What                                                                                                                                                                                     |
| ---- | ------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1.1  | Neon console → New project                       | name `velo-atelier`, **Postgres 16**, region **AWS `eu-central-1`** (Frankfurt)                                                                                                          |
| 1.2  | the project's default branch                     | production. **Neon named it `production`, not `main`** (W5): a Neon default branch is whatever the project was created with, and the name is unrelated to the git branch of the same job |
| 1.3  | Branches → New branch, from `main`               | `preview`, **shared** by every Vercel preview deployment (one branch per PR is post-MVP, [`backlog.md`](./backlog.md))                                                                   |
| 1.4  | Connection details, for each of the two branches | two strings: the **pooled** one (its host carries `-pooler`) becomes `POSTGRES_URL`, the **direct** one becomes `POSTGRES_URL_NON_POOLING`; copy them as shown                           |

Nothing to enable by hand: the init migration
(`prisma/migrations/20260911071112_init`) runs
`CREATE EXTENSION IF NOT EXISTS citext` itself (`User.email` is `citext`).

**Check.**

- The guard, before any Neon URL exists anywhere: §4.8 AC3 —
  `POSTGRES_URL=postgresql://u:p@ep-x-pooler.eu-central-1.aws.neon.tech/db POSTGRES_URL_NON_POOLING=postgresql://u:p@ep-x.eu-central-1.aws.neon.tech/db npm run db:seed`
  exits 1 before opening a connection, and so does setting only one of the two
  (`tests/security/seed-guard.test.ts` holds the same cases).
- After the first production deploy (step 2.1): its build log shows
  `20260911071112_init` and every later migration applied.
- **And then the same for `preview`, by hand.** `scripts/vercel-build.sh` runs
  `prisma migrate deploy` only when `VERCEL_ENV=production`, so no preview
  deployment ever migrates its own branch. A `preview` branched from
  `production` _before_ the first production deploy therefore holds no schema
  at all, and nothing reports it: `/api/health` is a bare `SELECT 1`, which an
  empty database answers happily, and `/velo/demo` is code-backed. W5 branched
  in that order and found `preview` with no `_prisma_migrations` table
  (`.debug/016` §3). Migrate it once, with the **direct** URL, and assert the
  host before running:

  ```bash
  POSTGRES_URL_NON_POOLING='<preview direct>' POSTGRES_URL='<preview pooled>' npx prisma migrate deploy
  ```

  Then check both branches carry the same count:
  `select count(*) from "_prisma_migrations"`. Re-run it after any migration
  that production takes and preview has not — or reset `preview` from its
  parent in the Neon console, which is the same thing with one click.

## 2. Vercel — who: the maintainer (Vercel account)

| Step | Where                                                | What                                                                                                                                                                                                                                       |
| ---- | ---------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 2.1  | Add New → Project → import `lienardale/velo-atelier` | framework Next.js, root directory = the repository root; the build command comes from `vercel.json`. Add the Production variables below **before the first Deploy**: without the database URLs that build fails at `prisma migrate deploy` |
| 2.2  | Settings → Environment Variables                     | the table below, each variable in exactly the scopes listed                                                                                                                                                                                |
| 2.3  | Settings → General / Functions                       | Node.js 24.x (from `engines.node`), function region `cdg1` (from `vercel.json`)                                                                                                                                                            |
| 2.4  | Settings → Git                                       | production branch `main`; every other branch and PR gets a preview deployment                                                                                                                                                              |

Environment variables (§4.6):

| Variable                                | Production              | Preview                | Development   | Notes                                                                                                                           |
| --------------------------------------- | ----------------------- | ---------------------- | ------------- | ------------------------------------------------------------------------------------------------------------------------------- |
| `POSTGRES_URL`                          | Neon `main`, pooled     | Neon `preview`, pooled | see below     |                                                                                                                                 |
| `POSTGRES_URL_NON_POOLING`              | Neon `main`, direct     | Neon `preview`, direct | see below     | migrations use it; there is no fallback to the pooled URL                                                                       |
| `AUTH_SECRET`                           | its own value           | its own value          | its own value | **distinct per scope**, at least 32 characters: `npx auth secret` or `openssl rand -base64 32`                                  |
| `AUTH_TRUST_HOST`                       | `true`                  | `true`                 | `true`        |                                                                                                                                 |
| `NEXT_PUBLIC_SITE_URL`                  | `https://<prod-domain>` | to decide              | to decide     | baked in at build time: canonical, `hreflang`, sitemap, `og:url`; nothing reads `VERCEL_URL`, so one value serves every preview |
| `HUSKY`                                 | `0`                     | `0`                    | `0`           | skips the hook installation on Vercel's checkout                                                                                |
| `AUTH_URL`                              | `https://<prod-domain>` | —                      | —             | Production only; previews rely on `AUTH_TRUST_HOST`                                                                             |
| `AUTH_GOOGLE_ID` / `AUTH_GOOGLE_SECRET` | from step 3             | —                      | —             | Production only: a preview URL can never be a registered redirect URI                                                           |
| `ENABLE_TEST_PAGES`                     | **never**               | **never**              | **never**     | set in any scope → the deployment serves nothing, every request 500s (`instrumentation.ts`)                                     |
| `NEXT_PUBLIC_TEST_HOOKS`                | **never**               | **never**              | **never**     | set in any scope → the BUILD exits 1 (`scripts/vercel-build.sh`), before it migrates anything                                   |
| `NEXT_PUBLIC_DEMO_LOGIN`                | **never**               | **never**              | **never**     | set in any scope → the deployment serves nothing, every request 500s (`instrumentation.ts`)                                     |
| `ALLOW_REMOTE_SEED`                     | **never**               | **never**              | **never**     | nothing on Vercel seeds                                                                                                         |

Two decisions the plan leaves open. **Both were taken on 2026-09-29**, and the
reasoning is here because the dashboard cannot hold it:

- **The Development scope's database → the `preview` Neon branch.** §4.6 sets
  the variables in all three scopes but names a Neon branch only for Production
  and Preview; `preview` is the only other branch that exists. Development gets
  it too, never `production`: the scope is read by `vercel dev` and
  `vercel env pull`, neither of which this project uses — local development
  runs against the Docker database in `.env.local` — so the value exists to be
  harmless if something ever does read it, and pointing it at production would
  make an accident write to the live database.
- **`NEXT_PUBLIC_SITE_URL` on previews → `https://velo-atelier.vercel.app`, the
  production host, in all three scopes.** Whatever is set is what every preview
  build prints as its canonical URL. Nothing reads `VERCEL_URL`, so the honest
  alternatives were one wrong-but-stable value or one per deployment, which a
  build-time constant cannot give. A preview's canonical pointing at production
  is the harmless direction: Vercel sends every preview `x-robots-tag: noindex`
  of its own accord and sends production none (checked on both on 2026-09-29),
  so no preview is indexable anyway, and a canonical that resolves to the real page
  beats one that resolves to a deployment URL that dies with the branch.

`<prod-domain>` is known once the project exists: its `*.vercel.app` host, or
the custom domain added under Settings → Domains. A change to
`NEXT_PUBLIC_SITE_URL` or `AUTH_URL` reaches only the builds made after it
(step 3.4).

`vercel env pull .env.vercel` downloads the Development scope — never into
`.env.local`, which must keep pointing at the Docker database (`.env.vercel` is
gitignored).

**The first production build failed, and why** (W5, 2026-09-29). `.vercelignore`
excluded `tests/`, so the build machine had the code but not the helpers its
co-located tests import: `next build` type-checks the whole tsconfig project and
stopped with 200+ `TS2307: Cannot find module '@/tests/_helpers/…'` and
`TS2339: Property 'toBeInTheDocument' does not exist`. Nothing local shows this —
CI builds the whole tree, and `.vercelignore` is read only by Vercel. `tests/`
now ships; only the screenshot and perf baselines, which the type-checker never
reads, stay out.

**Check** (§4.8 AC7).

- The production build log contains `▶ prisma migrate deploy (VERCEL_ENV=production)`
  and the migration output; a preview build log contains
  `▶ skipping prisma migrate deploy (VERCEL_ENV=preview)`.
- `curl -fsS https://<prod-domain>/api/health` prints `{"ok":true,"db":true}`, and
  so does the preview URL. If a preview answers `401`, Vercel's deployment
  protection is on for previews: check it from a browser signed in to Vercel or
  with a protection-bypass token — do not switch protection off to make the
  check pass.
- The production build log's bundle-guard step prints `✓ no test hooks`: the
  bundle has no `window.__va`.

## 3. Google OAuth — who: the maintainer (Google Cloud account)

| Step | Where                                                                                  | What                                                                                                 |
| ---- | -------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------- |
| 3.1  | APIs & Services → OAuth consent screen                                                 | app name, support e-mail; the default scopes of the Auth.js Google provider (`openid email profile`) |
| 3.2  | APIs & Services → Credentials → Create credentials → OAuth client ID → Web application | authorised redirect URI **`https://<prod-domain>/api/auth/callback/google`** — and only that one     |
| 3.3  | Vercel → Environment Variables, **Production** scope                                   | `AUTH_GOOGLE_ID`, `AUTH_GOOGLE_SECRET`, `AUTH_URL=https://<prod-domain>`                             |
| 3.4  | Vercel → Deployments → Redeploy the production deployment                              | a variable change reaches only the builds made after it                                              |

Locally, Google is optional: `.env.example` documents the redirect URI
`http://localhost:3000/api/auth/callback/google` for a development client.

**What W5 created** (2026-09-29). A new Google Cloud project `velo-atelier`, an
**External** consent screen, and one Web-application client named
`velo-atelier production` whose single authorised redirect URI is
`https://velo-atelier.vercel.app/api/auth/callback/google`. No authorised
JavaScript origin: Auth.js runs the whole exchange server-side, so the browser
never calls Google's token endpoint and an origin here would only widen the
client.

**The client secret is shown once, and only once.** Google's client page now
says so outright — "Viewing and downloading client secrets is no longer
available" — and shows the existing one masked (`****abcd`). Two consequences:

- Whoever creates the client copies the secret then, or adds a new one
  afterwards. **Add secret** on the client page issues a second, live secret
  without downtime; delete the old one once Vercel has the new one and a
  production deployment has been rebuilt with it. That is also the rotation
  procedure, and it is the only way back if the secret is lost.
- Nothing may photograph, log or paste that dialogue. W5 had to rotate once for
  exactly that reason.

**Check.** The manual checklist in [`qa/google-oauth.md`](./qa/google-oauth.md),
all seven sections, on production. While the consent screen is in "Testing",
only its listed test users can sign in. On a preview the Google button is still
rendered (it always is) and cannot complete: previews are tested with e-mail +
password.

## 4. GitHub repository settings — who: the maintainer (`gh` authenticated as `lienardale`)

### 4.1 Branch protection on `main`, built from `REQUIRED_CHECKS`

The twenty required contexts are **read from the code**, never retyped:
`tests/unit/ci/required-checks.test.ts` exports `REQUIRED_CHECKS` and asserts
that `ci.yml` and `codeql.yml` produce exactly those names. Run from the
repository root:

```bash
node -e '
const src = require("node:fs").readFileSync("tests/unit/ci/required-checks.test.ts", "utf8");
const start = src.indexOf("REQUIRED_CHECKS = [");
const list = src.slice(start, src.indexOf("] as const", start));
const contexts = [...list.matchAll(/"([^"]+)"/g)].map((m) => m[1]);
if (contexts.length !== 20) throw new Error(`expected 20 contexts, found ${contexts.length}`);
process.stdout.write(JSON.stringify({
  required_status_checks: { strict: false, contexts },
  enforce_admins: true,
  required_pull_request_reviews: { required_approving_review_count: 0 },
  restrictions: null,
  required_linear_history: true,
  allow_force_pushes: false,
  allow_deletions: false,
}));
' | gh api -X PUT repos/lienardale/velo-atelier/branches/main/protection --input -
```

- **Zero approving reviews** because the project has one maintainer, who cannot
  approve their own PR (`.github/CODEOWNERS` routes reviews, it does not gate
  them); **`enforce_admins`** so that maintainer goes through the checks too.
- `strict: false`: the plan does not ask for "branches must be up to date before
  merging"; set `strict: true` if you want it.
- **Every `ci.yml` job runs on every PR, with no path filter.** A required
  context has to report on every pull request. A skipped job does not satisfy
  one, and a skipped MATRIX job reports the literal `e2e (${{ matrix.project }})`
  instead of its five expanded names, so the PR waits for a status that never
  comes. W5 hit exactly that on a two-file PR (#8, `.debug/016`) and removed the
  filters. Filtering is only safe again behind a single aggregate context.
- **Linear history** means a PR lands by squash or rebase. Settings → General →
  Pull Requests: allow squash and/or rebase merging — a merge commit cannot land
  on `main` once this rule is on.

**Check** (§7.6 AC12):

```bash
gh api repos/lienardale/velo-atelier/branches/main/protection --jq '.required_status_checks.contexts | length'                  # 20
gh api repos/lienardale/velo-atelier/branches/main/protection --jq '.enforce_admins.enabled'                                     # true
gh api repos/lienardale/velo-atelier/branches/main/protection --jq '.required_pull_request_reviews.required_approving_review_count' # 0
gh api repos/lienardale/velo-atelier --jq '.security_and_analysis.secret_scanning_push_protection.status'                         # enabled
gh repo view lienardale/velo-atelier --json visibility -q .visibility                                                             # PUBLIC
```

And the last clause of AC12, which only a real PR can show: a branch with one
deliberately failing unit test, opened as a draft PR, shows `coverage (80%)`
**failed**, not skipped. Close that PR without merging and delete its branch.

### 4.2 Security settings

| Setting                           | Where                         | State                                                                                                                                                  |
| --------------------------------- | ----------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Secret scanning + push protection | Settings → Code security      | on — check with the AC12 command above                                                                                                                 |
| Dependabot alerts                 | Settings → Code security      | on — Renovate's `vulnerabilityAlerts` rule (`renovate.json`) acts on these alerts                                                                      |
| Private vulnerability reporting   | Settings → Code security      | on — `SECURITY.md` and the issue chooser (`.github/ISSUE_TEMPLATE/config.yml`) send reporters to it                                                    |
| Discussions                       | Settings → General → Features | on — the issue chooser sends repair questions to `/discussions`                                                                                        |
| Workflow permissions              | Settings → Actions → General  | default token read-only, "Allow GitHub Actions to create and approve pull requests" on (set during W4: `perf.yml`'s `update-snapshots` job opens a PR) |

**Read back on 2026-09-29**: secret scanning and push protection `enabled`,
visibility `PUBLIC`, discussions on, workflow permissions
`{"default_workflow_permissions":"read","can_approve_pull_request_reviews":true}`,
and branch protection exactly as §4.1 asks (20 contexts, `enforce_admins`,
linear history, 0 reviews, no force pushes, no deletions). **Dependabot
security updates are off** — the row above wants the _alerts_, which Renovate
consumes; automatic Dependabot PRs would duplicate Renovate's.

### 4.3 CodeQL

`.github/workflows/codeql.yml` is an **advanced setup**: `javascript-typescript`,
`security-and-quality` queries, on PRs to `main`, on pushes to `main` and every
Monday at 04:00 UTC. In Settings → Code security → Code scanning, leave
**Default setup off**: GitHub refuses advanced-setup results while default
setup is enabled.

**Check.** Security → Code scanning lists analyses from the `CodeQL` workflow,
and the `CodeQL` context is green on `main`.

### 4.4 Renovate

Install the Renovate GitHub App on this repository only. `renovate.json` is
already committed: `config:recommended`, a dependency dashboard, Mondays before
05:00 Europe/Paris, a 7-day minimum release age, caps on TypeScript (`<7`),
ESLint (`<10`), `@types/node` (`<25`), Prisma (`<8`) and React (`<19.3`), and
grouped updates for Next + React, Prisma, the three.js stack, Vitest,
Playwright and content-collections.

**Check.** A "Dependency Dashboard" issue appears, and the first Renovate PRs
carry the `dependencies` label.

**The first run rejected the config** (W5, 2026-09-29). Renovate opened
`lienardale/velo-atelier#9`, "Action Required: Fix Renovate Configuration", and
**stopped every PR** — including the dependency dashboard — until it was fixed:

```
Configuration option `vulnerabilityAlerts.minimumReleaseAge` should be a string,
Invalid configuration option: _comment_minimumReleaseAge
```

Both were written in W1 and never executed: `renovate.json` is read by Renovate
and by nothing else, so no local gate, no CI job and no JSON-schema check ever
looked at it. Renovate's own schema settles both:

- `minimumReleaseAge` is `{"type": ["string", "null"], "default": null}`, so the
  way to exempt security updates from the 7-day hold is `null`, not `false`.
- `description` is a real Renovate option at every config level (string or array
  of strings). It is where a rationale belongs; an invented `_comment_*` key is
  rejected like any other unknown option.

**How to detect a regression**: `npx --yes --package renovate -- renovate-config-validator`
reads `renovate.json` and exits non-zero on exactly these errors. Run it after
editing the file.

---

## 5. Launch checklist (W5-T2) — who: the maintainer, with an agent for the local gates

### 5.1 Before tagging

| Gate                                             | Command or place                                                                                                | Expected                                                                                                                            |
| ------------------------------------------------ | --------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| No decision-tree drawing left a placeholder      | `npx vitest run tests/unit/domain/schema.test.ts`                                                               | green                                                                                                                               |
| Every ★ guide is `status: full`                  | `npx vitest run --project integration tests/integration/content/coverage.test.ts` (Docker up, `_test` database) | green (`FULL_SLUGS`, `tests/fixtures/content-manifest.ts`)                                                                          |
| A `verifiedAt` for every retailer (both locales) | `lib/domain/data/retailers.ts`, checklist in [`retailers.md`](./retailers.md)                                   | all three `2026-09-21` (the verification log in `retailers.md`); re-run the checklist before launch if `retailers.ts` changed since |
| The W5 items of the backlog                      | [`backlog.md`](./backlog.md), "W5 — launch"                                                                     | each one done, or re-scoped with a written reason                                                                                   |

### 5.2 The §9 verification

1. **Local, from a clean clone** — the README's quick start, then §9.1's walk:
   log in with `DEMO_USER`, open the gravel bike, click the chain in 3D and in the
   list, run a partial checkup on the rear caliper and the chain, mark the chain
   KO, finish, open the list, refine the chain, follow the Alltricks link (a new
   tab), enter an inseam on `/velo/<id>/reglages`; then the same as a guest, from
   `/` with "Je ne sais pas" everywhere, through sign-up and `/import`.
2. **All gates** — `bash scripts/ci.sh` prints its PASS table;
   `ENABLE_TEST_PAGES=1 NEXT_PUBLIC_TEST_HOOKS=1 bash scripts/ci/build.sh && npm run e2e:docker`;
   `npx lhci autorun`; `npx playwright test --project=perf --project=perf-mobile`.
3. **Mobile** —
   `npx playwright test --project=mobile-chromium --project=mobile-landscape --project=mobile-narrow --project=no-webgl`,
   then a real phone for the `perf-verified` label
   ([`bike3d-perf.md`](./bike3d-perf.md)).
4. **CI on a PR** — the twenty required checks green; a deliberately failing
   unit test turns `coverage (80%)` red; a `tests/e2e/__screenshots__` change
   without the `visual-baseline` label fails `visual-baseline-guard`.
5. **Production** — the build log contains `migrate deploy`; `/api/health`
   answers 200; Lighthouse mobile ≥ 0.85 on `/fr`, `/en` and
   `/en/guides/check-brakes-disc` (§9.5 gives `npx lhci autorun --collect.url=https://<prod-domain>/fr`;
   `lighthouserc.cjs` takes its host from `LHCI_BASE_URL` and also starts a local
   `npm run start`, so confirm the invocation before trusting its numbers); sign
   up with a real e-mail and a strong password; Google sign-in completes; a
   preview deployment builds without migrating and signs in with a password.

### 5.3 Then

- Open the first issues from [`backlog.md`](./backlog.md): one per entry marked
  _(W5-T2 opens an issue)_ — password reset by e-mail, nonce CSP, search,
  glossary, Neon preview branches, Upstash, affiliate programmes, the compose
  `seed` profile.
- Tag the release from `main`: `git tag -a v0.1.0 -m "vélo-atelier 0.1.0"` then
  `git push origin v0.1.0` (the maintainer).
- Write the production domain into the README (both languages) in place of
  "_(W5)_".
