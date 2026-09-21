# Deploying vélo-atelier (W5)

The step-by-step skeleton for the launch wave: **W5-T1** (Neon, Vercel, Google,
repository settings) and **W5-T2** (the launch checklist). It was written in W4,
before anything was deployed: every step says **who** does it, **where** (the
exact command or console path) and **how to check** it. Fill in the results —
dates, the production domain — as W5 goes.

Placeholders: `<prod-domain>` is the production host. No secret and no real
connection string ever goes in this file.

Almost every step needs an account only the maintainer holds (Neon, Vercel,
Google Cloud, GitHub as `lienardale`). An agent prepares and checks; the
maintainer clicks and pastes secrets.

---

## What the repository already does

Read this before clicking anything: these are the behaviours the dashboards must
not contradict.

| Piece                     | What it does                                                                                                                                                                        |
| ------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `vercel.json`             | `framework: nextjs`, `buildCommand: npm run vercel-build` (overrides the dashboard's Build Command), `regions: ["cdg1"]`, three security headers                                    |
| `scripts/vercel-build.sh` | `prisma migrate deploy` **only** when `VERCEL_ENV=production`, then `npm run build`, then `scripts/bundle-guard.ts`; `tests/unit/deploy/migrate-on-deploy.test.ts` pins that wiring |
| `package.json`            | `engines.node: "24.x"`; `prepare` is `husky \|\| true`, so an install without `.git` never fails; `postinstall` runs `prisma generate`                                              |
| `next.config.ts`          | security headers and a static Content-Security-Policy on every route                                                                                                                |
| `GET /api/health`         | a real `SELECT 1`: `200 {"ok":true,"db":true}`, or `503 {"ok":false,"db":false}`; never cached                                                                                      |
| `prisma/seed.ts`          | refuses `VERCEL_ENV=production` outright, and any non-local host unless `ALLOW_REMOTE_SEED=1` (`lib/db/guard.ts`), which is never set against Neon: **Neon is never seeded**        |
| `.vercelignore`           | keeps `.debug/`, `.claude/`, `docs/` and `tests/` out of the upload                                                                                                                 |

**The three test flags have no runtime guard.** `lib/env.ts` declares that
`ENABLE_TEST_PAGES`, `NEXT_PUBLIC_TEST_HOOKS` and `NEXT_PUBLIC_DEMO_LOGIN` must
never be set in production, but nothing calls its `getEnv()` outside the unit
tests, and `scripts/bundle-guard.ts` asserts whatever the flag says. On Vercel,
step 2 below is the only thing keeping `/dev/*`, `window.__va` and the demo
button out of production ([`backlog.md`](./backlog.md), W5 section).

---

## 1. Neon — who: the maintainer (Neon account)

| Step | Where                                            | What                                                                                                                                                           |
| ---- | ------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1.1  | Neon console → New project                       | name `velo-atelier`, **Postgres 16**, region **AWS `eu-central-1`** (Frankfurt)                                                                                |
| 1.2  | the project's default branch                     | `main` = production                                                                                                                                            |
| 1.3  | Branches → New branch, from `main`               | `preview`, **shared** by every Vercel preview deployment (one branch per PR is post-MVP, [`backlog.md`](./backlog.md))                                         |
| 1.4  | Connection details, for each of the two branches | two strings: the **pooled** one (its host carries `-pooler`) becomes `POSTGRES_URL`, the **direct** one becomes `POSTGRES_URL_NON_POOLING`; copy them as shown |

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
| `ENABLE_TEST_PAGES`                     | **never**               | **never**              | **never**     | see "no runtime guard" above                                                                                                    |
| `NEXT_PUBLIC_TEST_HOOKS`                | **never**               | **never**              | **never**     | idem                                                                                                                            |
| `NEXT_PUBLIC_DEMO_LOGIN`                | **never**               | **never**              | **never**     | idem                                                                                                                            |
| `ALLOW_REMOTE_SEED`                     | **never**               | **never**              | **never**     | nothing on Vercel seeds                                                                                                         |

Two decisions the plan leaves open, to take here and record in this file:

- **The Development scope's database.** §4.6 sets the variables in all three
  scopes but names a Neon branch only for Production and Preview; `preview` is
  the only other branch that exists.
- **`NEXT_PUBLIC_SITE_URL` on previews.** Whatever is set is what every preview
  build prints as its canonical URL.

`<prod-domain>` is known once the project exists: its `*.vercel.app` host, or
the custom domain added under Settings → Domains. A change to
`NEXT_PUBLIC_SITE_URL` or `AUTH_URL` reaches only the builds made after it
(step 3.4).

`vercel env pull .env.vercel` downloads the Development scope — never into
`.env.local`, which must keep pointing at the Docker database (`.env.vercel` is
gitignored).

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

---

## 5. Launch checklist (W5-T2) — who: the maintainer, with an agent for the local gates

### 5.1 Before tagging

| Gate                                        | Command or place                                                                                                | Expected                                                                                            |
| ------------------------------------------- | --------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------- |
| No decision-tree drawing left a placeholder | `npx vitest run tests/unit/domain/schema.test.ts`                                                               | green                                                                                               |
| Every ★ guide is `status: full`             | `npx vitest run --project integration tests/integration/content/coverage.test.ts` (Docker up, `_test` database) | green (`FULL_SLUGS`, `tests/fixtures/content-manifest.ts`)                                          |
| A `verifiedAt` for every FR retailer entry  | `lib/domain/data/retailers.ts`, checklist in [`retailers.md`](./retailers.md)                                   | Rose Bikes has one (2026-09-07); **Alltricks and Decathlon are `null` until the maintainer's pass** |
| The W5 items of the backlog                 | [`backlog.md`](./backlog.md), "W5 — launch"                                                                     | each one done, or re-scoped with a written reason                                                   |

### 5.2 The §9 verification

1. **Local, from a clean clone** — the README's quick start, then §9.1's walk:
   log in with `DEMO_USER`, open the gravel bike, click the chain in 3D and in the
   list, run a partial checkup on the rear caliper and the chain, mark the chain
   KO, finish, open the list, refine the chain, follow the Alltricks link (a new
   tab), enter an inseam on `/velo/<id>/reglages`; then the same as a guest, from
   `/` with "Je ne sais pas" everywhere, through sign-up and `/import`.
2. **All gates** — `bash scripts/ci.sh` prints its PASS table;
   `ENABLE_TEST_PAGES=1 NEXT_PUBLIC_TEST_HOOKS=1 npm run build && npm run e2e:docker`;
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
