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

| Piece                     | What it does                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| ------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `vercel.json`             | `framework: nextjs`, `buildCommand: npm run vercel-build` (overrides the dashboard's Build Command), `regions: ["cdg1"]`, three security headers                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| `scripts/vercel-build.sh` | refuses three things, in this order and **before the database is touched**: a `VERCEL_ENV` that is not `production`, `preview` or `development` (unset included); `NEXT_PUBLIC_TEST_HOOKS`; the whole environment contract (`scripts/check-env.ts`). Then `prisma migrate deploy` **only** when `VERCEL_ENV=production`, then `npm run build`, then `scripts/bundle-guard.ts`; `tests/unit/deploy/{migrate-on-deploy,vercel-build-guard}.test.ts` pin that wiring and execute the script                                                                                                               |
| `scripts/check-env.ts`    | the build-time preflight: `lib/env.ts`'s `parseEnv`, unweakened, on the variables of the scope being built. A violation exits 1 naming the variable (never its value), so the **build** fails and nothing is migrated. `vercel-build.sh` is its one caller — `npm run build` and CI never run it, and still need no secret                                                                                                                                                                                                                                                                             |
| `instrumentation.ts`      | the runtime lock: `register()` runs `getEnv()` once per server start, and requests that arrive meanwhile are held until it has settled. On a wrong environment, under `next start`, every page, route handler and metadata route answers 500 and the log names the variable — instead of an `undefined` deep inside Auth.js — while files under `/_next/static` and `public/` are still served (on Vercel: expected, not observed — see below). Next does not run it during a build. It does not exit either: see below. On a deployment a passing check logs `[env] contract enforced (VERCEL_ENV=…)` |
| `package.json`            | `engines.node: "24.x"`; `prepare` is `husky \|\| true`, so an install without `.git` never fails; `postinstall` runs `prisma generate`                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| `next.config.ts`          | security headers and a static Content-Security-Policy on every route                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| `GET /api/health`         | a real `SELECT 1`: `200 {"ok":true,"db":true}`, or `503 {"ok":false,"db":false}`; never cached                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| `prisma/seed.ts`          | refuses `VERCEL_ENV=production` outright, and any non-local host unless `ALLOW_REMOTE_SEED=1` (`lib/db/guard.ts`), which is never set against Neon: **Neon is never seeded**                                                                                                                                                                                                                                                                                                                                                                                                                           |
| `.vercelignore`           | keeps `.debug/`, `.claude/`, `docs/`, the screenshot baselines and the perf baselines out of the upload. **`tests/` itself stays**: `next build` type-checks the `*.test.ts(x)` files beside the code, which import `@/tests/_helpers` and `@/tests/_fakes` (see the first-build failure in §2)                                                                                                                                                                                                                                                                                                        |

**The environment contract is evaluated twice: when Vercel builds a scope, and
again every time a server starts** (W5). `lib/env.ts` used to be a rule nothing
read. Now `scripts/check-env.ts` runs it during the build and
`instrumentation.ts` runs it at boot, so a missing variable, a malformed one, or
any of the three test flags — `ENABLE_TEST_PAGES`, `NEXT_PUBLIC_TEST_HOOKS`,
`NEXT_PUBLIC_DEMO_LOGIN` — stops a deployment instead of shipping. Seven things
to know about the shape of that guard. Everything said to be measured was
measured locally, on the installed Next 16.3.6 with `next start`, on
2026-10-06; **nothing below was observed on Vercel**, and each place where that
matters says so.

- **A wrong scope fails the BUILD, before anything is migrated.** Next does not
  run `register()` during a build, so the boot hook alone would first meet a
  scope's VALUES on the deployed server: after a green build, after
  `prisma migrate deploy` on production, and — because a pull request's preview
  only evaluates the Preview scope — Production's values for the first time on
  production itself. `scripts/vercel-build.sh` therefore runs the same
  `parseEnv` first, with nothing relaxed. Its order:
  1. `VERCEL_ENV` must be `production`, `preview` or `development`, or exit 1;
  2. `NEXT_PUBLIC_TEST_HOOKS` must be off, or exit 1;
  3. `npx tsx scripts/check-env.ts` — the contract — or exit 1;
  4. `prisma migrate deploy` (production only), `npm run build`,
     `scripts/bundle-guard.ts`.

  A refused build's log names the variable and the rule, never a value:

  ```
  ▶ environment contract (VERCEL_ENV=production)
  Invalid environment:
    - AUTH_GOOGLE_ID is required in production
    - AUTH_GOOGLE_SECRET is required in production
    - AUTH_URL is required in production
  See .env.example for the full list.
  check-env: refused for VERCEL_ENV=production. Fix the variable(s) named above in THAT scope — Vercel → Settings → Environment Variables — then redeploy.
  ```

  Vercel's documentation says the production domains follow success — "When a
  production deployment succeeds, Vercel updates your production domains to
  point to the new deployment" — so a failed build should leave the previous
  deployment serving. **That half is documented, not observed**: this script
  had never run on Vercel when this was written.
  One refused build may not be the last. A variable that is MISSING stops the
  validation before the cross-field rules (the three flags; `AUTH_URL` and the
  Google pair in production), and `check-env` then adds that "the next build
  may name more". A too-short `AUTH_SECRET` or a URL without its scheme does
  not hide them.

- **Every guard keys off `VERCEL_ENV`, so `VERCEL_ENV` has to be there.** The
  three flags are refused when it is SET, not on "production": the `next` CLI
  defaults `NODE_ENV` to `production` for every command but `dev`, so every
  `next start` is a production server — CI's boot check, Playwright, Lighthouse
  and perf included, and all four start one on purpose with the flags on.
  `VERCEL_ENV` is set by Vercel and by nothing else. Consequence: **a preview
  deployment is refused too**, which is right — a preview URL is public — and
  so is the Development scope. `AUTH_URL` and the Google pair are unchanged:
  still required when `VERCEL_ENV=production` (or `NODE_ENV=production` with no
  Vercel), still not on a preview.
  The dependency this creates is a project setting. Vercel provides
  `VERCEL_ENV` only while **Enable access to System Environment Variables** is
  ticked (Settings → Environment Variables; that is the label in Vercel's
  documentation, page dated 2026-07-15 — the dashboard itself was not opened
  for this). With the variable gone, every guard that keys off it is off at
  once, and it is the one failure here that fails OPEN: the three flags are
  accepted on a production-shaped environment, production stops migrating, and
  a server holding the Preview scope's variables is refused for lacking
  `AUTH_URL` and the Google pair (a started server answered 500 naming all
  three). `vercel-build.sh` used to BUILD in that state — with
  `NEXT_PUBLIC_TEST_HOOKS=1`, exit 0, measured in review. Step 1 now makes it a
  failed build instead:

  ```
  ✗ VERCEL_ENV is not set, and this is the Vercel build entry point.
    Every deployment guard keys off it: without it the test-flag refusal is off
    and a production deployment would not migrate.
  ```

  What Vercel really hands a build or a function with the box unticked was not
  observed; step 1 is what makes that not matter. The converse is by design:
  a production server that is NOT on Vercel accepts the three flags.

- **`NEXT_PUBLIC_TEST_HOOKS` is refused before the compile, and has to be.**
  The bundler inlines it, so once a build has run, `window.__va` is in the
  JavaScript the deployment serves — and a boot refusal does not take it back:
  a refused server still hands out the files under `/_next/static` (two
  bullets down). Step 2 exits 1 with a message that says what the flag does;
  `scripts/bundle-guard.ts` refuses the same pair once more after the compile,
  so the rule holds even if the entry point is bypassed.
- **Everything the contract requires must therefore be present, or the scope
  does not build**: both database URLs, `AUTH_SECRET` and
  `NEXT_PUBLIC_SITE_URL` in every scope; `AUTH_URL` and the Google pair in
  Production. That is the table below, and it is now load-bearing rather than
  advisory. The contract is stricter than "it works": Auth.js accepts any
  non-empty secret and the contract wants 32 characters; the database URLs
  must start with `postgres://` or `postgresql://`, with no leading
  whitespace. So **the first build of each scope under this guard is the first
  time that scope's VALUES are checked** — for Production, that is the first
  production build after this lands. A value the contract refuses fails that
  build (and, as far as Vercel's documentation goes, leaves the current
  deployment serving); fix it in the scope the message names and redeploy. Do
  not relax the contract to get a build through.
- **What a refusal at BOOT looks like.** Not a crash, and not an exit code:
  `NextNodeServer`'s constructor fires
  `this.prepare().catch(err => console.error("Failed to prepare server", err))`,
  so the error `register()` raises is logged and swallowed and
  `start-server.js`'s `process.exit(1)` is never reached. Next prints "Ready",
  the socket stays bound, and for as long as the process lives:

  | Asked for                                      | Answer  |
  | ---------------------------------------------- | ------- |
  | `/api/health`, `/fr`, `/fr/connexion`          | 500     |
  | `/robots.txt`, `/sitemap.xml`, `/favicon.ico`  | 500     |
  | `/tree-drawings.json` (a file under `public/`) | **200** |
  | a chunk under `/_next/static/`                 | **200** |

  Every page, route handler and metadata route is refused; **files are not**
  — which is why the hooks flag is stopped at the build and not here. The log
  carries `Failed to prepare server`, `EnvValidationError` and the variable's
  name.
  **A healthy server does not answer 500 while it boots**, so one 500 from
  `/api/health` is enough to conclude. A request that arrives while
  `register()` is still running is held, and answered once it settles; before
  the port is bound the connection is refused. (Not one 500 in the 2 700 to
  3 000 answers each of three healthy servers gave four clients polling from
  the moment of spawn, and none in review with `register()` held open for four
  seconds.) `/api/health` itself only ever answers 200 or 503.
  **On Vercel this is expected, NOT observed — and expect less than "the site
  is down".** Static assets and prerendered routes are normally served from
  the CDN without invoking a function at all, and 205 routes of this build are
  prerendered (`/fr`, `/en`, every guide). So a refused deployment may well go
  on answering 200 for a page, and "the home page loads" proves nothing either
  way. (202 of those 205 sit behind `proxy.ts`, which by Next's source awaits
  the same hook before it runs; whether that turns them into 500s on Vercel
  was not observed either.) **The safe diagnostic is `/api/health`**: a route
  handler, never cached, that answers 200 or 503 by itself — so a **500 there
  is not the route's own answer**. Read the runtime log: `EnvValidationError`
  there is the contract refusing the server, and the line under it names the
  variable. Any other error there is some other failure of the function: only
  one direction was measured — a refused `next start` answers 500 — not that
  every 500 is a refusal.

- **If a refusal is ever live on production: roll back first, fix second.**
  The preflight exists so that a wrong variable never gets this far; this is
  for whatever a build cannot see.
  1. **Instant Rollback.** Vercel → the project's overview → the Production
     Deployment tile → **Instant Rollback** (or Deployments → ⋮ → Instant
     Rollback) points the production domain back at the previous deployment
     without rebuilding. Per Vercel's documentation the rolled-back deployment
     keeps the configuration it was built with — "Vercel won't update
     environment variables if you change them in the project settings and will
     roll back to a previous build" — and on the Hobby plan only the
     immediately previous deployment is eligible.
  2. **Fix the variable** the log names, in the scope that deployment read
     (Settings → Environment Variables).
  3. **Redeploy, check, then promote.** A variable change reaches only the
     builds made after it (step 3.4). And after a rollback Vercel "turns off
     auto-assignment of production domains", so the fixed deployment builds
     but does not go live by itself: check `/api/health` on its generated URL,
     then **promote that deployment** — Deployments → ⋮ → **Promote to
     Production** on the fixed deployment's own row, so there is no doubt
     about which one goes live. **Undo Rollback** on the production tile is
     the alternative: check which deployment the dialog names before
     confirming. Which one it restores was not confirmed here, and if it is
     the deployment that was rolled back FROM, that is the refused one. Then
     check that auto-assignment of production domains is back on rather than
     assuming it (the documentation was read as saying both actions turn it
     back on; neither was exercised): while it is off, the next merge to
     `main` builds and stays unpublished.

  A rollback does not un-apply a migration: if the refused deployment's build
  migrated the database, the restored one runs against the newer schema.
  **None of this procedure has been exercised on this project** — it is
  Vercel's documentation (the Instant Rollback page dated 2026-07-07, the
  Environments page dated 2026-09-17), read on 2026-10-06.

- **How to know the runtime lock is really there.** A deployment that passed
  the contract and a deployment whose bundle never contained the hook both
  answer 200: Next treats a missing hook file as "no instrumentation" and logs
  nothing. Two checks, the first free on every pull request:
  - **The preview's `/api/health` does not answer 500** (200, or 503 if its
    database is unreachable). The Preview scope has no `AUTH_URL` and no
    Google pair, so a hook that ran there WITHOUT seeing `VERCEL_ENV` would
    have refused the server: a started server holding that scope's variables
    answered 500 without `VERCEL_ENV` and 200 with `VERCEL_ENV=preview`. A
    healthy preview therefore shows the variable reaches the RUNNING server,
    not only the build — provided the hook ran, which is the second check.
  - **The preview's runtime logs carry
    `[env] contract enforced (VERCEL_ENV=preview)`** (`…=production` on
    production). `instrumentation.ts` prints it once per process, after the
    contract passed, only when `VERCEL_ENV` is set, with the value the server
    saw: it proves the hook ran. One line per `next start` was measured; on
    Vercel that should mean one per function instance, which was not observed
    — look for at least one.

  The build log's `▶ environment contract (VERCEL_ENV=preview)` followed by
  `check-env: environment contract satisfied (VERCEL_ENV=preview, isProduction=false).`
  proves the BUILD saw the variable, and nothing about the running server.

`tests/boot/env-contract.test.ts` (the `boot` Vitest project, run by
`scripts/ci/build.sh` after the build) spawns the real thing, four times: a
deployment carrying a flag never answers `/api/health` and logs the reason;
that same refused server still serves a file from `public/` and a compiled
chunk from `/_next/static`; a local production
server with all three flags on boots and prints no `[env]` line; and a clean
deployment boots and logs the line. It tests the build on disk and needs a
reachable database ([`CLAUDE.md`](../CLAUDE.md), "Quality gates").

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

| Step | Where                                                | What                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| ---- | ---------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 2.1  | Add New → Project → import `lienardale/velo-atelier` | framework Next.js, root directory = the repository root; the build command comes from `vercel.json`. Add the Production variables below **before the first Deploy**: without them that build fails at the contract preflight (`scripts/check-env.ts`), before `prisma migrate deploy` is reached                                                                                                                                                                                          |
| 2.2  | Settings → Environment Variables                     | the table below, each variable in exactly the scopes listed                                                                                                                                                                                                                                                                                                                                                                                                                               |
| 2.3  | Settings → General / Functions                       | Node.js 24.x (from `engines.node`), function region `cdg1` (from `vercel.json`)                                                                                                                                                                                                                                                                                                                                                                                                           |
| 2.4  | Settings → Git                                       | production branch `main`; every other branch and PR gets a preview deployment                                                                                                                                                                                                                                                                                                                                                                                                             |
| 2.5  | Settings → Environment Variables                     | **Enable access to System Environment Variables** stays ticked (Vercel's documentation's name for the checkbox). Per Vercel's documentation it is what puts `VERCEL_ENV` in the build and in the running server, and every deployment guard keys off that variable; unticked — if the variable disappears as documented, which was not observed — `scripts/vercel-build.sh` fails every build at its first step rather than build unguarded ("three things the table cannot show", below) |

Environment variables (§4.6):

| Variable                                | Production              | Preview                 | Development             | Notes                                                                                                                                                                                                                                                            |
| --------------------------------------- | ----------------------- | ----------------------- | ----------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `POSTGRES_URL`                          | Neon `main`, pooled     | Neon `preview`, pooled  | see below               | **by this exact name**: `lib/env.ts` does not read Neon's `DATABASE_URL` fallback that `lib/db/env.ts` accepts, and since W5 it decides whether the scope builds and whether its server boots                                                                    |
| `POSTGRES_URL_NON_POOLING`              | Neon `main`, direct     | Neon `preview`, direct  | see below               | migrations use it; no fallback to the pooled URL, and — as above — no `DATABASE_URL_UNPOOLED` fallback in `lib/env.ts`                                                                                                                                           |
| `AUTH_SECRET`                           | its own value           | its own value           | its own value           | **distinct per scope**, at least 32 characters: `npx auth secret` or `openssl rand -base64 32`. The length is enforced since W5: a shorter secret, which Auth.js itself accepts, fails the scope's build                                                         |
| `AUTH_TRUST_HOST`                       | `true`                  | `true`                  | `true`                  |                                                                                                                                                                                                                                                                  |
| `NEXT_PUBLIC_SITE_URL`                  | `https://<prod-domain>` | `https://<prod-domain>` | `https://<prod-domain>` | **required in EVERY scope** — since W5 a scope without it fails its build at the contract preflight. Baked in at build time: canonical, `hreflang`, sitemap, `og:url`; nothing reads `VERCEL_URL`, so one value serves every preview (decided 2026-09-29, below) |
| `HUSKY`                                 | `0`                     | `0`                     | `0`                     | skips the hook installation on Vercel's checkout                                                                                                                                                                                                                 |
| `AUTH_URL`                              | `https://<prod-domain>` | —                       | —                       | Production only; previews rely on `AUTH_TRUST_HOST`                                                                                                                                                                                                              |
| `AUTH_GOOGLE_ID` / `AUTH_GOOGLE_SECRET` | from step 3             | —                       | —                       | Production only: a preview URL can never be a registered redirect URI                                                                                                                                                                                            |
| `ENABLE_TEST_PAGES`                     | **never**               | **never**               | **never**               | set in any scope → that scope's BUILD exits 1 at the contract preflight (`scripts/check-env.ts`), before it migrates anything; `instrumentation.ts` refuses it again at boot                                                                                     |
| `NEXT_PUBLIC_TEST_HOOKS`                | **never**               | **never**               | **never**               | set in any scope → the BUILD exits 1 (`scripts/vercel-build.sh`, its second step, ahead of the preflight), before it migrates anything                                                                                                                           |
| `NEXT_PUBLIC_DEMO_LOGIN`                | **never**               | **never**               | **never**               | set in any scope → that scope's BUILD exits 1 at the contract preflight, as for `ENABLE_TEST_PAGES`                                                                                                                                                              |
| `ALLOW_REMOTE_SEED`                     | **never**               | **never**               | **never**               | nothing on Vercel seeds                                                                                                                                                                                                                                          |

**Three things the table cannot show. The first two now stop a BUILD; the
third is unverified.** All three follow from W5 making `lib/env.ts` decide
whether a scope builds and whether its server boots. None is the state of this
project today. The first two are one dashboard change away; the third needs a
plan this project may not have.

- **The database URLs are required BY NAME.** `lib/env.ts` wants
  `POSTGRES_URL` and `POSTGRES_URL_NON_POOLING`. Neon's own integration also
  offers `DATABASE_URL` / `DATABASE_URL_UNPOOLED`, and `lib/db/env.ts` — which
  actually opens the connection — accepts those too. So a project configured
  with Neon's names only would connect perfectly and still be refused: by
  `check-env` at the build, and again at boot. Set the `POSTGRES_*` names.
- **"Enable access to System Environment Variables" must stay ticked** — step
  2.5 above. Per Vercel's documentation it is the only source of
  `VERCEL_ENV`, and every guard keys off that variable: the refusal of the
  three flags, the production requirements, the hooks refusal, `bundle-guard`,
  and the migration itself. Without it all
  of them were off at once, and this was the one configuration that failed
  OPEN rather than loudly: the flags accepted on a production-shaped
  environment, no migration, and a server holding the Preview scope's
  variables refused at boot for lacking `AUTH_URL` and the Google pair (each
  measured locally, with the variable simply absent — none on Vercel).
  `scripts/vercel-build.sh` now refuses to build at all without a known
  `VERCEL_ENV`, so the mistake stops every deploy at its first step instead of
  shipping one unguarded. Not observed: what Vercel hands a build or a
  function with the box unticked, and whether unticking it changes
  deployments that are already running.
- **A Vercel Custom Environment is unverified — not known to be broken, not
  known to work.** `VERCEL_ENV` is an enum here (`production`, `preview`,
  `development`) and it fails closed: any other value is refused at the build
  (step 1 of `vercel-build.sh`, then `check-env`) and at boot. Vercel's
  documentation gives `VERCEL_ENV` those same three values and puts a custom
  environment's NAME in a different variable, `VERCEL_TARGET_ENV`, which
  nothing in this repository reads. What `VERCEL_ENV` actually holds on a
  custom-environment deployment was not observed: the project has Production
  and Preview only, and Vercel lists Custom Environments as a Pro and
  Enterprise feature. If it holds one of the three, such a deployment is
  treated as that scope — `VERCEL_ENV=preview` beside
  `VERCEL_TARGET_ENV=staging` parses as a preview: flags refused, no
  `AUTH_URL` or Google requirement. If it holds anything else, the build stops
  with `✗ VERCEL_ENV=<value> is not production, preview or development.`
  before it migrates. Either way, read the first one's build log rather than
  assuming. **Do not widen the enum to make one build**: a value the contract
  cannot classify would then read as "not production" and silently drop the
  `AUTH_URL` and Google requirements.

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

- Every build log shows the contract preflight before it migrates or builds:
  `▶ environment contract (VERCEL_ENV=production)` then
  `check-env: environment contract satisfied (VERCEL_ENV=production, isProduction=true).`
  — on a preview, `(VERCEL_ENV=preview, isProduction=false)`. A build that
  stops with `✗ VERCEL_ENV is not set` instead most likely means step 2.5's
  checkbox is off (what a build is handed with it unticked was not observed);
  one that stops with `Invalid environment:` names the variable to fix in
  that scope.
- The production build log contains `▶ prisma migrate deploy (VERCEL_ENV=production)`
  and the migration output; a preview build log contains
  `▶ skipping prisma migrate deploy (VERCEL_ENV=preview)`.
- `curl -fsS https://<prod-domain>/api/health` prints `{"ok":true,"db":true}`, and
  so does the preview URL. If a preview answers `401`, Vercel's deployment
  protection is on for previews: check it from a browser signed in to Vercel or
  with a protection-bypass token — do not switch protection off to make the
  check pass. A `500` is not a database problem (that is `503`), and it is
  not the route's own answer either: read the runtime log —
  `EnvValidationError` there is the environment contract refusing the server.
- The runtime logs of the preview carry
  `[env] contract enforced (VERCEL_ENV=preview)`, and production's
  `[env] contract enforced (VERCEL_ENV=production)`: the boot hook shipped and
  ran. **This line and the two `check-env` lines above have never been seen on
  Vercel** — the first build and the first preview after W5's contract lands
  are where they are read for the first time; write the result here.
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
   `npm run lhci`; `npx playwright test --project=perf --project=perf-mobile`.
   `npm run lhci` is `bash scripts/ci/lighthouse.sh`, the script CI's
   `lighthouse` job runs — **not a bare `npx lhci autorun`**: lhci starts
   `npm run start` itself, and since W5 that server is refused by the
   environment contract unless its environment is complete (from the README's
   `.env.local` the Google pair is empty; Next still prints "Ready", which is
   lhci's cue, and then answers 500 for every page). The script completes the
   environment from `.env.test`, database included, so **the audited server
   runs on the `_test` database** unless the shell exports `POSTGRES_URL` and
   `POSTGRES_URL_NON_POOLING`. **Run it after the build, and read its last
   line**: with no `.next/` the script prints
   `:: WARNING SKIP — no .next/ — run scripts/ci/build.sh first` and exits 0,
   having audited nothing (observed 2026-10-06 on a copy of the script in a
   directory with no build, called directly and through an `npm run`). An
   exit code of 0 is therefore not proof of an audit; the closing
   `lighthouse assertions passed` line is. Arguments after `npm run lhci --`
   are not forwarded to lhci: the script passes none on. `build.sh` ends with
   the `boot` Vitest project,
   which needs that same database up. (`npm run lhci` was not run end to end
   for this change — its wiring is pinned by
   `tests/unit/deploy/env-contract-defaults.test.ts`; CI's `lighthouse` job is
   where the whole script runs.)
3. **Mobile** —
   `npx playwright test --project=mobile-chromium --project=mobile-landscape --project=mobile-narrow --project=no-webgl`,
   then a real phone for the `perf-verified` label
   ([`bike3d-perf.md`](./bike3d-perf.md)).
4. **CI on a PR** — the twenty required checks green; a deliberately failing
   unit test turns `coverage (80%)` red; a `tests/e2e/__screenshots__` change
   without the `visual-baseline` label fails `visual-baseline-guard`.
5. **Production** — the build log contains
   `check-env: environment contract satisfied (VERCEL_ENV=production, isProduction=true).`
   and `migrate deploy`; `/api/health` answers 200; the runtime logs carry
   `[env] contract enforced (VERCEL_ENV=production)`; Lighthouse mobile ≥ 0.85
   on `/fr`, `/en` and `/en/guides/check-brakes-disc`; sign up with a real
   e-mail and a strong password; Google sign-in completes; a preview deployment
   builds without migrating and signs in with a password.
   **The Lighthouse invocation against production is unverified — confirm it
   before trusting a number.** §9.5 gives
   `npx lhci autorun --collect.url=https://<prod-domain>/fr`. That calls lhci
   directly, so it bypasses `scripts/ci/lighthouse.sh` (`npm run lhci` forwards
   no arguments and cannot be used for this), and `lighthouserc.cjs` still has
   lhci start a local `npm run start` from the shell's environment — a server
   the contract now refuses from the README's `.env.local`, after printing the
   "Ready" lhci waits for. That should not matter if lhci really audits the
   remote URL, and that is the thing to confirm, in the reports it leaves under
   `.lighthouseci/`: the audited URL must be the production host, not
   `localhost`. Do not reach for `LHCI_BASE_URL=https://<prod-domain>` untried
   either: `lighthouserc.cjs` derives the local server's port from that same
   variable (`port || "80"`).

### 5.3 Then

- Open the first issues from [`backlog.md`](./backlog.md): one per entry marked
  _(W5-T2 opens an issue)_ — password reset by e-mail, nonce CSP, search,
  glossary, Neon preview branches, Upstash, affiliate programmes, the compose
  `seed` profile.
- Tag the release from `main`: `git tag -a v0.1.0 -m "vélo-atelier 0.1.0"` then
  `git push origin v0.1.0` (the maintainer).
- Write the production domain into the README (both languages) in place of
  "_(W5)_".
