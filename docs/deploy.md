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

| What                                         | Result                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| -------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Production host                              | `https://velo-atelier.vercel.app` — the Vercel-assigned domain; no custom domain yet                                                                                                                                                                                                                                                                                                                                                                                             |
| Neon project                                 | `velo-atelier` (`aged-bird-87792451`), AWS `eu-central-1` (Frankfurt), Postgres **16**, Free plan, 6 h history retention — created 2026-09-23                                                                                                                                                                                                                                                                                                                                    |
| Neon branches                                | `production` (default) and its child `preview` — see §1.2: the default branch is **not** called `main`                                                                                                                                                                                                                                                                                                                                                                           |
| Vercel project                               | `lienardales-projects/velo-atelier`, region `cdg1`, production branch `main` — created 2026-09-29                                                                                                                                                                                                                                                                                                                                                                                |
| First production deploy                      | 2026-09-29, after one failure (`.vercelignore`, see §2). Migrations `20260911071112_init` and `20260921090547_checkup_symptoms_done_reason` applied at 08:11:43Z                                                                                                                                                                                                                                                                                                                 |
| Google OAuth client                          | `velo-atelier production` (Web application), created 2026-09-29 — §3                                                                                                                                                                                                                                                                                                                                                                                                             |
| Branch protection                            | applied 2026-09-29: 20 contexts, `enforce_admins`, linear history, 0 reviews — §4.1                                                                                                                                                                                                                                                                                                                                                                                              |
| Renovate                                     | app installed 2026-09-29; its first run rejected `renovate.json` — §4.4                                                                                                                                                                                                                                                                                                                                                                                                          |
| Environment contract, first preview build    | 2026-10-06, `dpl_4MS8nEKgrqYoUoVVrkoWeD5wh17f` (#16, commit `d57a8dc`): build log `check-env: environment contract satisfied (VERCEL_ENV=preview, isProduction=false).`, then `▶ skipping prisma migrate deploy (VERCEL_ENV=preview)`; runtime log `[env] contract enforced (VERCEL_ENV=preview)` on the first request (17:56Z); `/api/health` 200 — §2, "Read on Vercel"                                                                                                        |
| Environment contract, first production build | 2026-10-06, `dpl_8fUtvWonaB42YUxGCwha8aBsmn8F` (`main` @ `a754257`, #16 merged 19:27:49Z): build log 19:28:08Z `check-env: environment contract satisfied (VERCEL_ENV=production, isProduction=true).`, 19:28:13Z `No pending migrations to apply.` under `3 migrations found`, 19:28:53Z `✓ no test hooks — 0 hit(s)`; runtime log (`cdg1`, 19:29Z) `[env] contract enforced (VERCEL_ENV=production)`; `/api/health` 200. No dashboard change was needed — §2, "Read on Vercel" |
| The two workflows                            | #17 merged 2026-10-06 20:21:34Z (`863cd0c`). `main`'s CI for that commit: all green. `renovate-config-validator`: first run on that pull request — pass, 41 s; second run on the push to `main` (run 37525838928) — pass, 44 s — §4.4. `migrate-preview`: the merge started no run, as designed, and the workflow had still not run on 2026-10-07 (13:10Z) — §4.5                                                                                                                |
| Advisory fixes                               | 2026-10-06, after `audit` had turned `main` red: #14 (`e985af1`, merged 15:54:16Z) — `compression` 1.8.2, `proxy-addr` 2.0.8, `source-map-js` 1.2.2, `sprintf-js` removed by a scoped override; #15 (`d0acb87`, merged 17:39:28Z) — `sharp` 0.35.5, `@modelcontextprotocol/sdk` pinned to 1.31.0. `main`'s CI for `d0acb87`: all green; `npm audit` on that tree: 19 vulnerable packages, six ids, all allow-listed ([`audit-ci-allowlist.md`](../audit-ci-allowlist.md))        |
| CodeQL                                       | **0 open alerts**, 2026-10-06: `gh api "repos/lienardale/velo-atelier/code-scanning/alerts?state=open" --jq length` → `0`. The four alerts that stayed open after pull request #12 — alerts 10, 9, 12 and 3 — were dismissed that day (16:00:32Z–16:00:35Z) on the maintainer's instruction, with the comments written in [`audit-ci-allowlist.md`](../audit-ci-allowlist.md)                                                                                                    |

**Still open when W5's documents were closed.** The record they were closed
from covers 2026-10-06 and 2026-10-07, and **none of the following had
happened when it ended**:

- **§4.5's bootstrap and the first `migrate-preview` run** — rotate the
  `preview` branch's password, one secret, two variables, the first dispatch.
  Until the maintainer has done it, `migrate-preview` skips green and nothing
  migrates `preview`; no Actions secret, no Actions variable and no run of
  that workflow existed on 2026-10-07 (read at 13:10Z).
- **One query in the Neon console, on `production`**: bikes holding more than
  one `OPEN` build list.
- **The manual production checks** of §5.2, item 5: a real sign-up with a
  strong password; Google sign-in ([`qa/google-oauth.md`](./qa/google-oauth.md),
  all seven sections); a preview URL signing in with e-mail + password.
- **A ruling on the guest import, which drops the guest's checkup** — §5.2,
  item 1, finding 2. Found on 2026-10-07 by the walk from a clean clone,
  **not fixed, and live on production**: the guest's bike and its to-fix list
  are imported into the account, the checkup is not. Awaiting the maintainer's
  ruling: fix before the tag, or tag first and open an issue.
- **A ruling on the local Lighthouse CI result** — §5.2, item 2. Two local
  runs, both exit 1 on the same two bike-page LCP assertions, while CI's
  `lighthouse` context was green on every pull request of 2026-10-06. Recorded
  as data, awaiting the maintainer's ruling; the threshold was not changed.
- **The `v0.1.0` tag and its release** — §5.3.

All six wait for the maintainer. They are not all that §5 still holds: three
things were not run in the closing session and have **no result on record** —
the real phone and the `perf-verified` label (§5.2, item 3), the two
deliberate failures (item 4), and `npm run lhci` end to end, through npm,
after the `_lib.sh` fix (item 2). What W5-T1 left open and is closed since:
the twelve CodeQL alerts (the row above) and the README's "_(W5)_" live-site
line (it carries the address now). The §5 items that were run have their
results beside them.

---

## What the repository already does

Read this before clicking anything: these are the behaviours the dashboards must
not contradict.

| Piece                                   | What it does                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| --------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `vercel.json`                           | `framework: nextjs`, `buildCommand: npm run vercel-build` (overrides the dashboard's Build Command), `regions: ["cdg1"]`, three security headers                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| `scripts/vercel-build.sh`               | refuses three things, in this order and **before the database is touched**: a `VERCEL_ENV` that is not `production`, `preview` or `development` (unset included); `NEXT_PUBLIC_TEST_HOOKS`; the whole environment contract (`scripts/check-env.ts`). Then `prisma migrate deploy` **only** when `VERCEL_ENV=production`, then `npm run build`, then `scripts/bundle-guard.ts`; `tests/unit/deploy/{migrate-on-deploy,vercel-build-guard}.test.ts` pin that wiring and execute the script                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| `scripts/check-env.ts`                  | the build-time preflight: `lib/env.ts`'s `parseEnv`, unweakened, on the variables of the scope being built. A violation exits 1 naming the variable (never its value), so the **build** fails and nothing is migrated. `vercel-build.sh` is its one caller — `npm run build` and CI never run it, and still need no secret                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| `instrumentation.ts`                    | the runtime lock: `register()` runs `getEnv()` once per server start, and requests that arrive meanwhile are held until it has settled. On a wrong environment, under `next start`, every page, route handler and metadata route answers 500 and the log names the variable — instead of an `undefined` deep inside Auth.js — while files under `/_next/static` and `public/` are still served (on Vercel: expected, not observed — see below). Next does not run it during a build. It does not exit either: see below. On a deployment a passing check logs `[env] contract enforced (VERCEL_ENV=…)`                                                                                                                                                                                                                                                                                                                                                  |
| `.github/workflows/migrate-preview.yml` | the one thing that migrates the Neon **`preview`** branch (`scripts/vercel-build.sh` migrates production only): `prisma migrate deploy` on a push to `main` that touches `prisma/migrations/**` — as long as the migration is among the first 300 changed files of that push (GitHub's documentation, not observed: §4.5, "Afterwards") — and on `gh workflow run migrate-preview.yml --ref main`, also the bootstrap. One step reads the secret `NEON_PREVIEW_DIRECT_URL` and the variables `PREVIEW_MIGRATIONS_ENABLED` and `NEON_PREVIEW_ENDPOINT` (§4.5). Green and skipping only before the bootstrap; red on a half-set pair, a host that is not the named endpoint, a pooled host, any ref but `main`, or — after the fact — a run in which Prisma CREATED the database it was pointed at. Never triggered by a pull request and never a required context; a dispatch aimed at a PR's branch leaves a red, non-required check on its head commit |
| `.github/workflows/renovate-config.yml` | a pinned `renovate-config-validator --no-global renovate.json` (`--no-global` = the REPOSITORY schema, the one the service applies) on a pull request, and on a push to `main`, that touches `renovate.json`, `scripts/ci/renovate-config.sh` or this workflow file — so Renovate's own bump of the pinned validator runs it too. Path-filtered, therefore never a required context (§4.1, §4.4)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| `package.json`                          | `engines.node: "24.x"`; `prepare` is `husky \|\| true`, so an install without `.git` never fails; `postinstall` runs `prisma generate`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| `next.config.ts`                        | security headers and a static Content-Security-Policy on every route                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| `GET /api/health`                       | a real `SELECT 1`: `200 {"ok":true,"db":true}`, or `503 {"ok":false,"db":false}`; never cached                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| `prisma/seed.ts`                        | refuses `VERCEL_ENV=production` outright, and any non-local host unless `ALLOW_REMOTE_SEED=1` (`lib/db/guard.ts`), which is never set against Neon: **Neon is never seeded**                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| `.vercelignore`                         | keeps `.debug/`, `.claude/`, `docs/`, the screenshot baselines and the perf baselines out of the upload. **`tests/` itself stays**: `next build` type-checks the `*.test.ts(x)` files beside the code, which import `@/tests/_helpers` and `@/tests/_fakes` (see the first-build failure in §2)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |

**The environment contract is evaluated twice: when Vercel builds a scope, and
again every time a server starts** (W5). `lib/env.ts` used to be a rule nothing
read. Now `scripts/check-env.ts` runs it during the build and
`instrumentation.ts` runs it at boot, so a missing variable, a malformed one, or
any of the three test flags — `ENABLE_TEST_PAGES`, `NEXT_PUBLIC_TEST_HOOKS`,
`NEXT_PUBLIC_DEMO_LOGIN` — stops a deployment instead of shipping. Seven things
to know about the shape of that guard. Everything said to be measured was
measured locally, on the installed Next 16.3.6 with `next start`, on
2026-10-06. **On Vercel, only the PASSING path has been observed** — the same
day, on the preview `dpl_4MS8nEKgrqYoUoVVrkoWeD5wh17f` and on production's
`dpl_8fUtvWonaB42YUxGCwha8aBsmn8F` (§2, "Read on Vercel"). **Nothing else
has been**: not a refused build, not what a refused deployment serves, not
`VERCEL_ENV` with the system-variables setting off, not a Custom Environment,
not Instant Rollback — and each place where that matters says so.

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
  deployment serving. **That half is documented, not observed**: the script
  has run on Vercel since this was written (2026-10-06, a preview build and a
  production build, both satisfied — §2, "Read on Vercel"), and no build has
  been refused there.
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
  whitespace. So **the first build of each scope under this guard is the
  first time that scope's VALUES are checked**. For Preview and for
  Production that build happened on 2026-10-06, and both were satisfied with
  no dashboard change needed: Preview's on
  `dpl_4MS8nEKgrqYoUoVVrkoWeD5wh17f`, Production's on
  `dpl_8fUtvWonaB42YUxGCwha8aBsmn8F` (§2, "Read on Vercel"). A value the
  contract refuses fails its build (and, as far as Vercel's documentation
  goes, leaves the current deployment serving); fix it in the scope the
  message names and redeploy. Do not relax the contract to get a build
  through.
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
  was not observed either. One thing was seen since, on the PASSING path
  only: on production, 2026-10-06, the first request to `/fr` logged the
  `[env]` line, as the first requests to `/api/health` and `/fr/connexion`
  did — so that request for a prerendered page did invoke a function that ran
  the hook (which function logged it was not recorded). What such a request is
  answered when the hook refuses is the part still not observed.) **The safe
  diagnostic is `/api/health`**: a route handler, never cached, that answers
  200 or 503 by itself — so a **500 there is not the route's own answer**.
  Read the runtime log: `EnvValidationError`
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
    saw: it proves the hook ran. One line per `next start` was measured
    locally. On Vercel it was one per function cold start (2026-10-06):
    production logged it on the first request to each of `/api/health`, `/fr`
    and `/fr/connexion`, the preview on its first request — so look for at
    least one, not for exactly one.

  The build log's `▶ environment contract (VERCEL_ENV=preview)` followed by
  `check-env: environment contract satisfied (VERCEL_ENV=preview, isProduction=false).`
  proves the BUILD saw the variable, and nothing about the running server.

  **Both checks were made for the first time on 2026-10-06**, on the preview
  of the pull request that carried the contract (#16,
  `dpl_4MS8nEKgrqYoUoVVrkoWeD5wh17f`): `/api/health` answered 200
  `{"ok":true,"db":true}`, `/fr/connexion` answered 200, and the runtime log
  carried `[env] contract enforced (VERCEL_ENV=preview)` on the first request
  (a cold start, `GET /api/health`, 17:56Z). That preview holds no Google
  pair, so its booting is the first check passing on a real deployment:
  `VERCEL_ENV` reaches the running server. The build log carried the two
  lines above as well.

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
- **And then the same for `preview` — by workflow, the first time included.**
  `scripts/vercel-build.sh` runs `prisma migrate deploy` only when
  `VERCEL_ENV=production`, so no preview deployment ever migrates its own
  branch. A `preview` branched from `production` _before_ the first production
  deploy therefore holds no schema at all, and nothing reports it:
  `/api/health` is a bare `SELECT 1`, which an empty database answers happily,
  and `/velo/demo` is code-backed. W5 branched in that order and found
  `preview` with no `_prisma_migrations` table (`.debug/016` §3).

  `.github/workflows/migrate-preview.yml` is the one thing that migrates it:
  on a push to `main` that touches `prisma/migrations/**` (with one silent
  limit on very large pushes: §4.5, "Afterwards"), and on demand —

  ```bash
  gh workflow run migrate-preview.yml --ref main
  ```

  **That dispatch is the bootstrap too: there is no by-hand migration to do
  first.** `prisma migrate deploy` creates `_prisma_migrations` on a database
  that has none and applies everything — `scripts/ci/migrate-preview.sh` was
  run in review against an empty throwaway local database (2026-10-06): every
  migration applied, exit 0, and a second run printed
  `No pending migrations to apply.` This section used to open with a
  `migrate deploy` typed by hand, the preview branch's connection string
  inline as `POSTGRES_URL_NON_POOLING='…'`. **Do not do that.** A command
  line is written whole to the shell's history file, the assignment in front
  of the command included, and a connection string in a file is no longer a
  secret. Whether W5's own by-hand migration was typed that way is not on
  record. What is: the string was handled outside the stores, in a terminal
  session — `.debug/016` §3 has `prisma migrate deploy` run against the
  preview branch's direct URL and the string held in a file beside
  production's. By §4.5's rule that spends it, which is why §4.5 starts with
  a rotation. The one by-hand form left is §4.5's fallback: marked as such,
  with the string read from a prompt, and a rotation to pay afterwards.

  The procedure — rotate, one secret, two variables, dispatch, read the run —
  is **§4.5**, and so is everything the run can say. In short: the job is
  green and **skips with a message** only while neither the secret nor the
  switch has ever been set, so nothing about `main` changes until the
  maintainer starts the bootstrap. From then on every half-finished state is
  a red run. GitHub hands a step the empty string for a secret that does not
  exist, so a job that skipped on "no secret" alone would go back to
  green-and-silent the day the secret was deleted or renamed — the failure
  this workflow exists to remove, one level up.

  **`--ref main`, and what that rule is worth.** The script refuses any other
  ref: a dispatch on a feature branch would apply **that branch's unmerged**
  `prisma/migrations/**` to the one database every open PR's preview reads.
  But a dispatch runs the workflow file and the script _of the ref it names_,
  so the rule is enforced by that ref's own copy of the script. It stops an
  accidental `--ref`; it does not bind a branch that edited the script, and
  GitHub hands that run the repository secret all the same (§4.5, "Who can
  read the secret").

  **Resetting `preview` from its parent is not a migration.** This section
  used to call it the one-click equivalent of one. It is a copy: per Neon's
  documentation (read in review, 2026-10-06) a reset replaces the child
  branch's schema AND data with its parent's — and the parent is
  `production`, a live site. A reset therefore puts production's rows,
  accounts and password hashes included, in the one database every pull
  request's preview deployment reads. That is a decision to take on purpose,
  never a way to catch up a schema: the dispatch above does that, and copies
  nothing.

  A reset is also expected to undo the rotation. Per the same documentation a
  child branch's roles carry the parent's passwords by default, and a child's
  own passwords survive a reset only when the parent is a _protected_ branch —
  a paid-plan feature, on a project that is on the Free plan. So after a
  reset the `preview` role's password should be production's again: the
  rotated string in the GitHub secret and in Vercel's Preview and Development
  scopes stops authenticating, and `preview` shares production's password
  once more. **Expected per Neon's documentation, not observed**: no reset of
  this branch is on record, and Neon's own page on resets says only that the
  branch's connection details do not change. The tell would be a dispatched
  run that goes red on `P1000: Authentication failed`; whoever resets first
  should write here what happened. After a reset, in this order (§4.5's step
  numbers): re-rotate the `preview` role's password (1), update the GitHub
  secret (3) and both Vercel scopes (5), redeploy the open previews (5), then
  dispatch (6). `NEON_PREVIEW_ENDPOINT` stays as it is if the endpoint keeps
  its name, which is what "connection details do not change" should mean; if
  the branch is ever deleted and created again, the variable must follow the
  new endpoint or the run is red.

  **What it is not**: a deploy hook, nor a database per pull request. The
  trigger is the push to `main`, not a successful production deployment, so
  `preview` can take a migration slightly before production does — and a
  destructive one reaches every open PR's preview within minutes of landing.
  In the other direction, a pull request that ADDS a migration gets a preview
  deployment whose code is ahead of the shared schema until it merges:
  nothing migrates `preview` for it, and dispatching the workflow on its
  branch is exactly what the script refuses. Strictly better than a branch
  with no schema at all, but the real answer is one Neon branch per pull
  request ([`backlog.md`](./backlog.md)). If the trigger is ever to follow
  the production deployment instead, the event to use is `deployment_status`:
  Vercel's Git integration is not a workflow, so `workflow_run` has nothing
  to follow (GitHub's documentation, read in review). Per that documentation
  the event's `GITHUB_REF` can be empty, which the script's ref guard refuses
  as it stands. Not tried.

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

**Do not pull the Development scope.** `vercel env pull` writes a scope's
variables to a file, and that scope holds the `preview` branch's two
connection strings — the freshly rotated ones, once §4.5's step 5 is done. A
connection string in a file is spent by §4.5's rule: if the scope is ever
pulled, delete the file, then rotate the `preview` password again (§4.5,
step 1), replace the GitHub secret (step 3) and replace both strings in the
Preview and Development scopes (step 5). Local development needs nothing from
Vercel: it runs against the Docker database in `.env.local`. This paragraph
used to give `vercel env pull .env.vercel` as the way to download the scope;
`.env.vercel` stays in `.gitignore` so that a file pulled by mistake cannot
also be committed.

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
  ran. This line and the two `check-env` lines above were read on Vercel for
  the first time on 2026-10-06 — the result is below.
- The production build log's bundle-guard step prints `✓ no test hooks`: the
  bundle has no `window.__va`.

**Read on Vercel, 2026-10-06** — the first preview and the first production
build under W5's contract, each item of the list above. Times are UTC.

- **Preview** `dpl_4MS8nEKgrqYoUoVVrkoWeD5wh17f` (#16, commit `d57a8dc`).
  Build log, in this order: `▶ environment contract (VERCEL_ENV=preview)`,
  `check-env: environment contract satisfied (VERCEL_ENV=preview, isProduction=false).`,
  `▶ skipping prisma migrate deploy (VERCEL_ENV=preview)`. Runtime log, on
  the first request (a cold start, `GET /api/health`, 17:56Z):
  `[env] contract enforced (VERCEL_ENV=preview)`. `/api/health` answered 200
  `{"ok":true,"db":true}` and `/fr/connexion` 200.
- **Production** `dpl_8fUtvWonaB42YUxGCwha8aBsmn8F` (`main` @ `a754257`).
  Build log:

  ```
  19:28:08Z  ▶ environment contract (VERCEL_ENV=production)
  19:28:08Z  check-env: environment contract satisfied (VERCEL_ENV=production, isProduction=true).
  19:28:08Z  ▶ prisma migrate deploy (VERCEL_ENV=production)
  19:28:11Z  3 migrations found in prisma/migrations
  19:28:13Z  No pending migrations to apply.
  19:28:53Z  ✓ no test hooks — 0 hit(s)
  19:28:54Z  Build Completed in /vercel/output [54s]
  ```

  Runtime log, region `cdg1`, 19:29Z:
  `[env] contract enforced (VERCEL_ENV=production)` on the first request to
  each of `/api/health`, `/fr` and `/fr/connexion` — one line per function
  cold start. `/api/health` answered 200 `{"ok":true,"db":true}`; `/fr`,
  `/en`, `/fr/connexion`, `/en/guides/check-brakes-disc`, `/fr/velo/demo` and
  `/robots.txt` answered 200. No dashboard change was needed.

**Still not observed on Vercel, anywhere**: a refused build (a contract
violation); what a refused deployment serves; `VERCEL_ENV` with the
system-variables setting off; a Custom Environment; Instant Rollback.

**Also in that production runtime log, and nothing to do with the contract**:
on each cold start `pg` warns that the SSL modes `prefer`, `require` and
`verify-ca` are treated as `verify-full` today and will take libpq's weaker
semantics in pg-connection-string v3 / pg v9, and suggests an explicit
`sslmode=verify-full`. So the Neon strings in Vercel carry `sslmode=require`
— inferred from the warning; the strings were not read.

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

Both were written in W1 and never executed: `renovate.json` was read by
Renovate and by nothing else, so no local gate, no CI job and no JSON-schema
check had ever looked at it. Renovate's own schema settles both:

- `minimumReleaseAge` is `{"type": ["string", "null"], "default": null}`, so the
  way to exempt security updates from the 7-day hold is `null`, not `false`.
- `description` is a real Renovate option at every config level (string or array
  of strings). It is where a rationale belongs; an invented `_comment_*` key is
  rejected like any other unknown option.

**How to detect a regression**: `renovate-config-validator` reads
`renovate.json` and exits non-zero on exactly these errors. It is no longer a
thing to remember —
[`.github/workflows/renovate-config.yml`](../.github/workflows/renovate-config.yml)
runs it on every pull request, and every push to `main`, that touches one of
**three** paths: `renovate.json`, `scripts/ci/renovate-config.sh`, or that
workflow file itself. `bash scripts/ci/renovate-config.sh` is the same command
locally (it takes a path, so a copy can be checked too). The install pulls the
whole `renovate` package — ~350 MB, on a cache that is cold on every runner —
which is why the job is path-filtered and why, being path-filtered, it is
**not** one of the twenty required contexts: a required check that does not
report on most PRs blocks them for ever (§4.1). It is listed in
`NON_BLOCKING_CONTEXTS` next to `visual-baseline-guard`, and
`tests/unit/ci/required-checks.test.ts` now holds the rule itself rather than
the one name: no workflow whose pull-request trigger carries `paths` or
`paths-ignore` may produce a required context.

**Not required means GitHub will merge past it.** With one maintainer and zero
required reviews (§4.1), a pull request can be merged while this check is red,
or while it is still installing. Open it and read it. Its first run on GitHub
was on the pull request that introduced the job (#17, which changes
`renovate.json`), on 2026-10-06: **pass, in 41 s**. It ran again on that
merge's push to `main` (run 37525838928): pass, the job from 20:21:41Z to
20:22:25Z, 44 s. Before that the validator had only ever run on a laptop.

**And green means less than "the service will accept it".** The validator
checks options and their types against the repository schema. It does not
resolve the presets named in a top-level `extends`: a misspelt preset there —
`config:recomended`, one `m` short — is the same class of failure as the one
above, the service stops, and it should pass here. That is read from the
pinned version's source in review (44.108.1 resolves presets for
`packageRules` entries only), not from a run.

**`--no-global`, or the check is weaker than the service.** Handed a
_filename_, `renovate-config-validator` validates it as a self-hosted
**global** config — it says so — and the global schema is **wider** than the
repository schema Renovate applies to `renovate.json`. Measured on 44.108.1,
one file both ways: a copy carrying `baseDir` and `redisUrl` passes as a
global config (exit 0) and fails as a repo config (exit 1) with

```
The "baseDir" option is a global option reserved only for Renovate's global
configuration and cannot be configured within a repository's config file.
```

`scripts/ci/renovate-config.sh` therefore passes `--no-global`, and its log
reads `Validating renovate.json as repo config`. The flag costs nothing and
keeps the path argument, so an ad-hoc copy is checked the same way.
`tests/unit/ci/renovate-config.test.ts` fails if it is ever dropped — nothing
else would notice, because a weakened validator and a working one print the
same green tick. The same file holds the validator's **verdict**, which is the
third way to lose the gate without losing a flag: it runs the script against a
stand-in `npx` that exits 1 and expects the script to exit 1 with it. Until
the review of 2026-10-06, `|| true` after the validator line, an `if !` around
it, or `continue-on-error` on the job each left every test green.

**The validator is pinned, not `@latest`.** `scripts/ci/renovate-config.sh`
holds `RENOVATE_VERSION` and passes `renovate@<that>` to `npx`. An unpinned
`npx --yes` downloads whatever the registry served that minute, from outside
`package-lock.json` and so invisible to `audit-ci` — for a repository that
holds every real dependency for seven days (`minimumReleaseAge`) that is the
wrong default, and it contradicts the rule `scripts/ci/lint.sh`'s header
states. It is downloaded rather than installed only because the package is
~350 MB, for one path-filtered job: in `devDependencies` it would tax every
`npm ci` in every job. The pin is also **at least seven days old**, like every
other dependency here: Renovate publishes several times a day
(**twenty-four** `44.1xx` releases across 2026-09-29 and 2026-09-30 — 13 then
11, counted from the registry's own `time` map), so "the newest one that
works" is an unheld package by another name.

**Renovate bumps the pin, and this job validates the bump.** `renovate.json`'s
second `customManagers` entry matches the `RENOVATE_VERSION` line, so a new
version arrives as an ordinary Renovate PR, held the same seven days. That PR
edits `scripts/ci/renovate-config.sh` and nothing else — which is why the
script is one of the workflow's three paths. Filtered on `renovate.json`
alone, as the job first was, it would not have started on its own bump, and a
new validator would first have met the committed config on somebody's later,
unrelated edit of `renovate.json`, where a failure reads as that change's
fault. (This paragraph said "validated by this very job" while that was false;
found in review, 2026-10-06. That the job does start on a bump PR is GitHub's
`paths` rule — a workflow runs when at least one changed path matches — and no
such PR exists yet, so it is not observed.)

That bump is a recurring cost nobody has seen yet. With several releases a
day, every Monday run finds a version that has just cleared the seven-day
hold: **expect a pin-bump pull request about once a week**, and with it this
job's full cold install (41 s and 44 s for the whole check on the two runner
runs there are: below). It is not automerged — the patch-automerge rule
matches on `matchDepTypes`, and a dependency found by a regex manager carries
none — so it waits for a human, runs the twenty required contexts, and takes
one of the five `prConcurrentLimit` slots while it is open. All of this is
inferred in review from Renovate's source and the registry's release dates,
not observed: the app has not opened one. If the cadence turns out to be
noise, a `packageRules` entry for `renovate` (a monthly schedule, say) is the
knob; none is set.

**Its green run is not silent** (renovate 44.108.1, the pinned version, run
2026-09-30). The committed file validates — `INFO: Config validated
successfully against 1 file(s)`, exit 0 — but the validator also prints
`WARN: Config migration necessary` and a diff: `customManagers[].fileMatch`
has been renamed `managerFilePatterns`, whose patterns carry regex delimiters
(`"/^package\\.json$/"`). A warning is not an error and Renovate still honours
`fileMatch`, so nothing is broken; but renaming it is a change to
`renovate.json` and belongs in its own pull request — which this job will then
validate. The warning is also most of the log: a green run printed 560 lines
on 2026-10-06, the migrated config and its diff, between
`INFO: Validating renovate.json as repo config` and the verdict on the
next-to-last line. Two `customManagers` entries carry `fileMatch` now, and
`tests/unit/ci/renovate-config.test.ts` finds the second one by that key, so
the rename has to move the test with it.

Which is why the script passes `--no-global` and **not** `--strict`. Measured on
the same pinned version and the same committed file: `--no-global` exits 0,
`--no-global --strict` exits **1**, on that very `Config migration necessary`
warning. `--strict` would therefore redden the job over a rename the service
still accepts, rather than over a defect — so it stays off until the rename
lands, and `scripts/ci/renovate-config.sh`'s header says so where somebody
reaching for the flag will read it.

**The install is slow only when it is cold — and cold, on a runner, was not
minutes either.** An earlier version of this section said it "takes several
minutes even warm"; it does not. With the npx cache already holding the
pinned version, the whole script ran in 3 s, 5.4 s and 4 s on three occasions
(2026-10-06, on a laptop: in review, after the review's fixes, and for this
paragraph). Cold, it downloads and unpacks the ~350 MB (348M measured in the
npx cache), and a runner is always cold: the job's first run on a GitHub
runner (#17, 2026-10-06) reported **pass in 41 s**, and its second, on the
push to `main` the same day (run 37525838928), passed with its job running
from 20:21:41Z to 20:22:25Z: 44 s. Each is the check as GitHub timed it, the
install included; the install on its own was not timed. Two timed runs, so
two figures and not a range.

### 4.5 Actions secrets and variables

One secret and two variables, all three for one workflow
(`.github/workflows/migrate-preview.yml`) and all three read by one step of
it. None of them existed on 2026-10-06 (read in review), nor on 2026-10-07
(read again at 13:10Z, with no run of the workflow either). They live under
Settings → Secrets and variables → Actions; the `gh` commands below write the
same store.

| Name                         | Kind     | Value                                                                                                                                                                                                                                     |
| ---------------------------- | -------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `NEON_PREVIEW_DIRECT_URL`    | secret   | the **direct** (unpooled) connection string of the Neon **`preview`** branch, copied after the rotation below                                                                                                                             |
| `PREVIEW_MIGRATIONS_ENABLED` | variable | `1`                                                                                                                                                                                                                                       |
| `NEON_PREVIEW_ENDPOINT`      | variable | `ep-plain-block` — the first label of the preview branch's host, minus its trailing `-<id>`. Not a secret: `.debug/016` §3 already publishes it. Read it from here or from there, never from the panel the string is copied from (step 2) |

**The rule everything below serves.** The connection string lives in the Neon
console, in GitHub's secret store and — for the deployments that use it — in
Vercel's environment variables. It is never an argument to a command, never
in a file, never in a log and never in a message. A command line is written
whole to the shell's history file, and a string that has been in a shell's
history is not a secret any more. What is on record for this branch's string
is less specific than that, and enough: in W5 it was handled outside those
stores, in a terminal session. `.debug/016` §3 records both endpoints queried
directly, `prisma migrate deploy` run against the preview branch's direct
URL, and the string held in a file beside production's; it names no command
line and no history file. By this rule the string is spent, and that is why
the procedure starts with a rotation.

**Until that rotation, the preview string carries production's password.**
Per Neon's documentation a child branch's roles have the parent's passwords by
default, and `preview` is a child of `production` (read in review; not checked
against the live project). Two things follow. Rotating `preview` matters more
than "a preview database" suggests — and it changes nothing on `production`.
`.debug/016` §3 records both endpoints being queried directly in that session,
so by this section's own standard production's string was handled by hand
too; how it was given to the client is not recorded. Whether to rotate
production's password is the maintainer's decision and is no part of this
procedure. It has a cost this one does not: the live deployment holds the old
password, so the site is expected to lose its database from the reset until a
production deployment has been rebuilt with the new string (step 3.4) — not
exercised.

**The bootstrap — who: the maintainer, in one sitting, in this order.** No
step puts the connection string on a command line or in a file. Between
steps 3 and 4 the repository is half set, and a half-set repository is a red
run if a migration lands on `main` just then (the table further down) — so do
not stop between them.

0. **Merge first** — the pull request that carries the workflow. Per GitHub's
   documentation a `workflow_dispatch` only works once the workflow file is on
   the default branch. **This step is done**: #17 merged on 2026-10-06 at
   20:21:34Z (`863cd0c`). That merge started no migrate run of its own, as
   designed and as observed: it changed nothing under `prisma/migrations/**`.
   Steps 1 to 7 had not been started when the record ended.
1. **Rotate.** Neon console → project `velo-atelier` → branch **`preview`** →
   Roles → reset the password of the role the app connects as. From this
   moment every preview deployment already built has lost its database — it
   holds the old password — until step 5.
2. **Name the endpoint.** A public value, so a command line is where it
   belongs:

   ```bash
   gh variable set NEON_PREVIEW_ENDPOINT --body ep-plain-block
   ```

   The value is the first label of the preview branch's host minus its
   trailing `-<id>`: of `ep-plain-block-<id>.<region>.aws.neon.tech`,
   `ep-plain-block`. **Take it from this document or from `.debug/016` §3**
   (the console's branch list should show it too; no console was opened for
   this change) — **never from the Connection details panel the string is
   copied from in step 3.** The script's endpoint assertion is worth exactly
   the independence of its two sides: read off that one panel with the
   branch selector left on `production`, the secret and the variable agree
   with each other, and production's endpoint passes.

3. **Store the string.** In the Neon console, with the branch selector on
   **`preview`**: Connection details → connection pooling **off** → copy the
   bare `postgresql://…` URL, not the `psql '…'` snippet. Its host starts
   `ep-plain-block-` and holds no `-pooler`. Then:

   ```bash
   gh secret set NEON_PREVIEW_DIRECT_URL
   ```

   Nothing after the name. With no `--body`, `gh` asks for the value in an
   interactive prompt (its manual, version 2.89.0): paste, Enter. The value is
   not an argument, so it is not in the shell's history. **Never**
   `--body '<the string>'`, never `< a-file`, never `-f .env`: each of those
   is the string on a command line or in a file. The browser form (Secrets tab
   → New repository secret) does the same without a terminal. `gh secret set`
   was not run for this change — no agent handles this value — so whether the
   prompt hides what is pasted was not checked.

4. **Arm the switch**, then read both variables back:

   ```bash
   gh variable set PREVIEW_MIGRATIONS_ENABLED --body 1
   gh variable list
   ```

5. **Vercel.** Project → Settings → Environment Variables, **Preview** and
   **Development** scopes: replace `POSTGRES_URL` (the pooled string) and
   `POSTGRES_URL_NON_POOLING` (the direct one) with the rotated-password
   strings, pasted from the Neon console into the dashboard (§2's table).
   Then redeploy the preview of every open pull request: Vercel resolves
   environment variables when a deployment is created, so deployments already
   built keep the old password.
6. **Dispatch.**

   ```bash
   gh workflow run migrate-preview.yml --ref main
   ```

7. **Read the run** — next. It is the only evidence there is.

No console was opened for this change, and the console paths above are not
all of one age. Step 5's Vercel path (Settings → Environment Variables) and
step 3's "Connection details" are the ones this document has given since W5.
Step 1's Roles → reset-the-password path and step 3's connection-pooling
toggle were written for this change and have never been checked against the
Neon console. Whoever does the bootstrap first: correct them here if the
console says otherwise, as §1 asks of whoever first resets the branch.

**Read the run.** `gh run list` shows a status, not a log — and, straight
after a dispatch, possibly not this run yet: wait a few seconds before
listing, or use the URL `gh workflow run` prints (its help text, as the
review read it on 2.89.0: "The created workflow run URL will be returned if
available"; not observed, since nothing was dispatched for this change).

```bash
gh run list --workflow=migrate-preview.yml -L 1   # the newest run: its id and its status
gh run watch <run-id>                             # follow it until it completes
gh run view <run-id> --log                        # the log itself
```

A green first dispatch is expected to print these lines, in this order, with
others between them:

```
:: prisma migrate deploy → ep-plain-block…/neondb
Datasource "db": PostgreSQL database "neondb", schema "public" at "ep-plain-block…"
3 migrations found in prisma/migrations
Applying migration `20260930094543_one_open_build_list_per_bike`
All migrations have been successfully applied.
:: prisma migrate deploy exited 0 on ep-plain-block…/neondb
```

- **`N migrations found in prisma/migrations` is the LOCAL file count** — the
  migration directories in the commit the run checked out. It says nothing
  about the database. The pair to read is that line **plus** Prisma's verdict
  under it: `All migrations have been successfully applied.`, after one
  `Applying migration` line per migration it applied, or
  `No pending migrations to apply.` Either verdict under `N migrations found`
  says the database now holds all N.
- **On the first dispatch one migration is expected to be applied**,
  `20260930094543_one_open_build_list_per_bike`: `preview` held two when it
  was last read (`.debug/016` §3, 2026-09-29) and the tree holds three.
  `No pending migrations to apply.` on that first run would mean the database
  already had it, which nothing on record explains — find out why before
  going on.
- **`ep-plain-block…` is the first 14 characters of the host**, never the
  rest of it and never the credentials. That is the endpoint's two words only
  because both of this project's endpoints are `ep-` + 5 + 5 letters
  (`ep-plain-block`, `ep-quiet-river`); an endpoint named otherwise is cut
  inside a word or a few characters into its id (measured in review:
  `ep-shy-sun-a1b…`), and a host of 14 characters or fewer is printed whole.
  What follows the slash is the database name the string ends in — `neondb`
  in every fixture here; the live one was not read. **Read it**: the name is
  the one part of the destination that nothing asserts ("The database NAME is
  not asserted", below).
- **The same Prisma lines are on the run's page**, as a job summary, under
  one sentence: `` `prisma migrate deploy` exited 0 on `ep-plain-block…/neondb`, the endpoint `NEON_PREVIEW_ENDPOINT` names. ``
  Only a green run writes one; a red run and the skip write none, and the
  script itself never says "applied" — Prisma does, or does not.

That block is assembled from runs that were made, not copied from one: the
script with the real Prisma 7.10.0 against a local database (every line but
the two about applying, with that database's own host), and the review's run
on an empty local database for the wording of those two. This workflow has
not run on GitHub or against Neon: #17's merge started no run (2026-10-06),
and its first one is the dispatch above.

**Then compare the two branches — in the Neon console, never in a terminal.**
SQL Editor, branch selector on `preview`, then on `production`:

```sql
select migration_name, finished_at, rolled_back_at
from "_prisma_migrations" order by started_at;
```

The same names on both branches, each with a `finished_at` and no
`rolled_back_at` — three of them after the first dispatch, **if production's
deployment of #13 migrated** (#13 is the pull request that carried the third
migration). Nobody has read production's `_prisma_migrations` since
2026-09-29, when it held two (`.debug/016` §3). A build log has spoken since:
production's build of 2026-10-06 (`dpl_8fUtvWonaB42YUxGCwha8aBsmn8F`, §2,
"Read on Vercel") printed `3 migrations found in prisma/migrations` and
`No pending migrations to apply.`, which by the reading rule above says
production held all three by then. The table itself is still unread, and
when #13's migration was applied is not on record. If production shows two, that
is §1's push-before-deploy case — `preview` takes a migration on the push to
`main`, production when its deployment builds — and the thing to read next is
production's last build log, not this workflow.
`select count(*) from "_prisma_migrations"` is the short form `.debug/016` §3
used; a count can agree where the names would not. From a terminal this would
need a connection string for each branch, production's included, on a command
line: the one thing this section exists to prevent. **The console path is not
verified here**: the query was run against a local database holding the same
three migrations, and nobody opened the Neon console for this change.

**`/api/health` cannot report a migrated schema.** It runs a bare `SELECT 1`
and answers 200 on a database with no tables at all — W5's empty `preview`
answered `{"ok":true,"db":true}` (`.debug/016` §3). A healthy preview
deployment says its database is reachable and nothing about its schema. The
run's log and the query above are the evidence; there is no other.

**The secret and the switch: four combinations, one of them green without
migrating.**

| `NEON_PREVIEW_DIRECT_URL` | `PREVIEW_MIGRATIONS_ENABLED` | The run                                                                                                                                                        |
| ------------------------- | ---------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| absent                    | unset                        | **green** — `WARNING SKIP — NEON_PREVIEW_DIRECT_URL is not set`, followed by the bootstrap. The one run that is green without migrating, and only until step 3 |
| absent                    | `1`                          | **red** — `PREVIEW_MIGRATIONS_ENABLED is 1 but NEON_PREVIEW_DIRECT_URL is empty`: the secret was deleted, renamed or scoped away from the repository           |
| present                   | unset                        | **red** — `NEON_PREVIEW_DIRECT_URL is set but PREVIEW_MIGRATIONS_ENABLED is not 1`: the bootstrap's grace period was never ended                               |
| present                   | `1`                          | goes on to the endpoint assertion below and runs `migrate deploy` — green when Prisma exits 0 on a database that already existed (the next two sections)       |

Any other value of the switch — `true`, `yes`, `on`, `0` — is red **whatever
the secret**: `PREVIEW_MIGRATIONS_ENABLED is set to 'true'; the only value that arms it is 1.`
The value is echoed like that only when it is a short word — letters and
digits, eight at most. Anything else is reported by its length
(`is set to a value of <N> characters, not shown here`): the log is public, a
variable is a field somebody pastes into, and with the connection string
pasted there the refusal used to print it whole (measured in review).
The switch exists because GitHub hands a step the empty string for a secret
that does not exist, so the script cannot tell "not set up yet" from "deleted,
renamed or scoped away": it has to skip on the first and must not on the
second. It used to be read only when the secret was empty, which made the
sentence this replaces — a typo "fails the job on the spot" — false in the
one sitting where it mattered: with the secret present, `true`, `0` and an
unset variable all went on to migrate, green, and said nothing (measured in
review, 2026-10-06). It is read on every run now, and a secret without it is
a red run, so the pair cannot be left half set. Never clear it unless
`preview` is deliberately no longer migrated.

**Which database: the endpoint is asserted, not assumed.** Production lives in
the same Neon project, one branch selector away in the console, and its
connection string has exactly this one's shape. So before anything is
contacted the script compares the secret's host with `NEON_PREVIEW_ENDPOINT`,
both in lower case. The host must BE the variable, or continue it with `.`,
or — only when the variable is shaped `ep-<word>-<word>` — continue it with
`-`. So `ep-plain-block`, `ep-plain-block-<id>` and the whole host all match,
while `ep` and `ep-plain` match nothing: a prefix both endpoints share cannot
pass. A mismatch is a red run that prints the first 14 characters of each
side and nothing else of either:

```
:: NEON_PREVIEW_DIRECT_URL is not the preview endpoint — `preview` was NOT migrated.
:: Nothing was contacted.
::   the secret's host starts:  ep-quiet-river…
::   NEON_PREVIEW_ENDPOINT says:  ep-plain-block
```

Both sides are cut to the same 14 characters, so they can come out identical
— the variable holding the whole direct host and the secret the pooled
string, or an id that has changed since the variable was set. The message
then adds that the difference is past the 14th character: the endpoint's id,
or a `-pooler` only one of them carries. Either way it ends by saying what
the variable is and where to read it (step 2), which is not the panel the
string came from.

It fails closed. With the secret present and the variable empty the run is
red as well — `NEON_PREVIEW_ENDPOINT is empty — refusing to migrate a database nothing has identified.` —
because an unset variable is exactly what a misspelt variable NAME looks like
from inside the script. The first version compared the host with nothing:
handed a production-shaped host it went straight on to `migrate deploy` and
finished green under a summary that said `preview` (measured in review on a
`.invalid` host with a stand-in `npx`; no database was involved).

**The database NAME is not asserted — one wrong name is caught afterwards,
another is not caught at all.** The host is compared with something; the path
after it is only held to a shape. And Prisma does not need that database to
exist: `migrate deploy` creates one that is missing, then migrates it.
Measured on the pinned 7.10.0 against the local test server (2026-10-06), the
script as it then was and the secret's path changed to a name that did not
exist — these lines, in this order, with others between them:

```
:: prisma migrate deploy → localhost/velo_atelier_w5stray41_test
Datasource "db": PostgreSQL database "velo_atelier_w5stray41_test", schema "public" at "localhost:5432"
PostgreSQL database velo_atelier_w5stray41_test created at localhost:5432
3 migrations found in prisma/migrations
Applying migration `20260911071112_init`
Applying migration `20260921090547_checkup_symptoms_done_reason`
Applying migration `20260930094543_one_open_build_list_per_bike`
All migrations have been successfully applied.
:: prisma migrate deploy exited 0 on localhost/velo_atelier_w5stray41_test
```

Exit 0 and a green summary — with the database the previews read untouched,
which is the green-and-unmigrated shape this workflow exists to remove, one
typo in a secret away. (On Neon it takes a role with CREATEDB; the review
read Neon's documentation as giving that to roles created in the console. Not
observed.) The script cannot refuse this beforehand without a fourth input
naming the database, so it refuses **afterwards**, on Prisma's own line:
`preview` never has a database to create, so
`PostgreSQL database <name> created` in a run's output is a failed run —

```
:: Prisma CREATED the database '<name>' — the database the previews read was NOT migrated.
```

— red, with no job summary. What to do then, in this order: correct the
database name at the end of the secret (step 3 again; the string itself has
not left the stores, so no rotation), drop the stray database in the Neon
console — it holds the schema Prisma has just applied and nobody's data; the
console path was not looked up for this change — and dispatch again.

**What is not caught**: a path naming _another_ database that already exists
on that endpoint. Prisma creates nothing, migrates it, and the run is green.
The run's first line, `prisma migrate deploy → ep-plain-block…/<name>`, and
the same name in the summary are the only tell: read the name on the first
dispatch and after every change to the secret. A fourth input — a variable
holding the name, compared before anything is contacted — is what would
close it; none was added.

**What the value must be.** Each of these is a red run that contacts nothing:

- **The direct string, not the pooled one** — the one whose host carries
  `-pooler`. DDL and Prisma's advisory migration lock do not survive a
  transaction pooler:
  `NEON_PREVIEW_DIRECT_URL is a POOLED Neon endpoint (ep-plain-block…/neondb) — migrations need the DIRECT one.`
  The script hands the string to Prisma as `POSTGRES_URL_NON_POOLING`, the
  one variable `prisma.config.ts` reads for a migration
  (`readDatabaseUrls().direct`); there is deliberately no fallback to the
  pooled URL.
- **A bare, well-formed connection URL**: exactly one `@`, a username, a host,
  and a path that is a database name — a name's shape, that is: which name
  is checked by nothing before the run (above). Not the `psql '…'` snippet. A
  password holding `@`, `/`, `?` or `#` must be percent-encoded: unencoded, such a
  character can move where the URL parser puts the host, and the first
  version of the script then logged the rest of the password (measured in
  review). The strings the Neon console issues are expected to pass — its
  generated passwords were alphanumeric in every example the review found —
  and a password set by hand may not. The password itself is never decoded
  or inspected.
- **No `host` query parameter.** Prisma 7.10.0 dials a `?host=` INSTEAD of the
  URL's host (measured: the datasource line named one host and the `P1001`
  another), which would let the endpoint assertion check one name while the
  migration went to another.

The last two print one line, and nothing from the value:
`NEON_PREVIEW_DIRECT_URL is not a connection URL with a host`.

Two failures are Prisma's own and come after the script's checks. `P1000`
(authentication failed) means the password in the secret is not the role's:
redo steps 1 and 3, and read §1 if `preview` was reset from its parent.
`P1001` (the server was not reached) on an endpoint that exists may be a
compute that was asleep: per Neon's Prisma guide, as read in review, an idle
compute can take longer to wake than Prisma waits. Re-run once before looking
further. Neither was observed against Neon.

**Who can read the secret.** It is on the `env:` of the ONE step that runs
`scripts/ci/migrate-preview.sh`, not on the job. The checkout, `setup-node`
and `npm ci` — which runs the install scripts of ten dependencies and this
project's own `postinstall` — never have it, and the checkout does not leave
its token behind either (`persist-credentials: false`);
`tests/unit/ci/required-checks.test.ts` holds all of that, a `uses:` step
handed the secret through `with:` included. This is a **narrowing, not an
isolation**: that step still runs `prisma`, `dotenv` (`prisma.config.ts`
imports it) and `lib/db/env.ts` with the string in their environment, and
everything those load.

And **"`main` only" is the script's guard against an accidental `--ref`, not
GitHub's rule.** A dispatch runs the workflow file and the script of the ref
it names, so the guard is whatever that ref's copy says it is: it does not
bind a branch that edited the script or the workflow, and GitHub hands a
repository secret to that run all the same. Outside Actions the guard says
nothing at all. (A dispatch aimed at a pull request's branch that still has
the guard is refused, and leaves a red `migrate-preview` check on that head
commit — not required, so it blocks nothing.) The upgrade is a **GitHub
Environment restricted to the `main` branch**, with the secret stored as an
ENVIRONMENT secret and `environment:` on the job: GitHub then withholds the
secret from every other ref, whatever that ref's workflow says. It is not set
up, and it is not a file-only change — the maintainer creates the Environment
and its branch rule first, the secret moves there
(`gh secret set NEON_PREVIEW_DIRECT_URL --env <name>`, prompting as above),
and the workflow, its test and this section change with it. Per GitHub's
documentation; none of it was tried here.

**Concurrency: never cancelled, never two at once — and only one waiting.**
`cancel-in-progress: false` on the fixed group `migrate-preview` guarantees
two things: a run in progress is never cancelled by a newer one, and two runs
never migrate the one database at the same time. It does not guarantee that
every queued run happens. Per GitHub's documentation a concurrency group
holds one run in progress and ONE pending, and a newly queued run takes the
pending one's place — the replaced run is cancelled, not failed. Between
pushes to `main` that costs nothing: the survivor checks out the newer commit
and `migrate deploy` applies everything not yet applied. The corner where it
does cost: the group carries no ref, so a mistaken `--ref <branch>` dispatch
can take a pending `main` run's place and then be refused by the script; that
migration waits for the next push, or for a dispatch on `main`. Read from the
documentation, not observed here.

The job is also the only one in the repository with a `timeout-minutes` (10),
because it is the only one whose queue is a database's migrations. Other
workflows queue their `main` runs too (`ci.yml`, `codeql.yml` and
`renovate-config.yml` all keep `cancel-in-progress` off on `main`), and a run
that hangs there delays a CI result; one that hangs here, on a connection or
on a DDL statement, would block the preview schema for GitHub's six-hour
default. It does not bound Prisma's wait for its advisory migration lock —
the pinned engine has a timeout message of its own for that; its length was
not checked. The cap has a cost that was not reproduced: the same engine
carries "migrate found failed migrations in the target database, new
migrations will not be applied", so a run killed part-way through a migration
may leave every later one refused until `prisma migrate resolve`. That is a
by-hand command and deserves the fallback's care — the string read from a
prompt, a rotation afterwards — or a reset of the branch, with what §1 says
one costs.

**What the log publishes, and why Prisma's output is filtered.** An Actions
log on a public repository is public, `$GITHUB_STEP_SUMMARY` included, and
the rest of the host would only help a stranger address the database. But
Prisma is the one that has to be held to that, not just the script: left
alone it announces its own datasource on the line after the script's —
`Datasource "db": PostgreSQL database "neondb", schema "public" at "<host>"`,
the whole endpoint — and names the host again in a `P1001`. So
`scripts/ci/migrate-preview.sh` pipes `migrate deploy`'s output (both
streams) through `sed`: the full host, and — when it is longer than 14
characters — the host's first label on its own, each replaced by the 14
characters the script's own line shows. `tee` then keeps that
already-redacted text for the job summary, so the summary is byte for byte
what the log shows. Text a server sends is otherwise passed through as it is;
whether Neon's proxy ever names an endpoint some other way was not observed.
The password was never printed on any path the review could reach (`P1000`,
`P1001`, `P1013`, a server-sent `FATAL`, a value that does not parse). The
ROLE name can be: `P1000` repeats it from the server's message.

Two consequences worth knowing before you edit that script:

- The redaction is a **pipe**, so `set -euo pipefail` (in `scripts/ci/_lib.sh`)
  is what still fails the job when the migration fails. Remove `pipefail` and
  a `P1001` exits **0**: a green job that migrated nothing, which is the exact
  shape §1 added this workflow to remove.
- **The tests execute the script; they do not read it.**
  `tests/unit/deploy/migrate-on-deploy.test.ts` runs every refusal above, the
  success path and the job summary against a stand-in `npx` that answers 0 —
  so a guard that only warns ends in a green "migration" and fails its test —
  and runs the real `prisma migrate deploy` once, against an unresolvable
  `.invalid` host, because only Prisma's own output can show that the
  redaction still matches it. `tests/integration/migrate-preview.test.ts`
  runs the unmodified script with the real Prisma against the integration
  tier's `_test` database and expects `No pending migrations to apply.` —
  and once more into a scratch `_test` database that does not exist, where
  the real Prisma must print its `created` line and the script must fail on
  it (the case drops that database again). That second case is what holds
  Prisma's WORDING: the unit tier's stand-in would go on printing the old
  line through an upgrade that changed it. The first version's tests stopped
  at a refusal or at a `P1001`: nothing had ever executed a green run.

**The by-hand fallback — only if Actions cannot run, and it costs a
rotation.** The dispatch is the way. If GitHub Actions is unavailable and
`preview` must be migrated now, this is the one by-hand form: it runs the
same script — endpoint assertion, pooled check and redaction included — and
reads the string from a prompt, so it is never on a command line and never in
the history file. Run it from a clean, up-to-date checkout of `main`, after
`npm ci`: outside Actions the script's ref guard says nothing, it applies
whatever `prisma/migrations/**` the working tree holds, and its
`npx --no-install prisma` has nothing to run without `node_modules`.

The first line prints nothing and waits: paste the direct string, then
Enter.

```bash
read -rs NEON_PREVIEW_DIRECT_URL
export NEON_PREVIEW_DIRECT_URL
PREVIEW_MIGRATIONS_ENABLED=1 NEON_PREVIEW_ENDPOINT=ep-plain-block bash scripts/ci/migrate-preview.sh
unset NEON_PREVIEW_DIRECT_URL
```

There is no comment inside that block, on purpose. A stock interactive zsh
does not treat `#` as one (`interactivecomments` is off by default): measured
with `zsh -f -i` (5.9), a comment trailing the `read` line printed
`zsh: not an identifier: #` straight after the paste, and a comment on a line
of its own printed `zsh: command not found: #`. The value was still read in
both, and never reached a command line — but an error on the line where a
secret has just been pasted is not something to leave for a first-timer.

Then **rotate again** — steps 1, 3 and 5. The string has left the stores it
belongs in and sat in a shell's environment, inherited by every process that
shell started afterwards; by this section's rule it is spent. (The four lines
were run in zsh 5.9 and bash 3.2 against a local database, the string fed on
standard input; `read -s` at a real terminal was not exercised.) The command
this replaces — `migrate deploy` with the string typed inline — is the one
form that must not come back.

**Afterwards.** A push to `main` that touches `prisma/migrations/**` migrates
`preview` by itself — **with one limit, and it is a silent one.** Per GitHub's
documentation, not observed here, a `paths:` filter is evaluated on the first
300 changed files of a push: when the migration is not among them the
workflow does not run. Not a red run and not a green one: no run, nothing in
the list — the quiet failure this workflow was added to remove. The filter
stays (without it every push to `main` would hand the connection string to a
run with nothing to migrate), so the rule is the maintainer's:

> After a merge of more than about 300 files that carries a migration, check
> `gh run list --workflow=migrate-preview.yml`, and dispatch
> (`gh workflow run migrate-preview.yml --ref main`) if no run started.

It has not happened yet, and it is not far off: the largest merge on `main`
changed 343 files and carried no migration (W1, `1ce0cd5`); the three that
did carry one changed 123, 180 and 22 (`git diff --name-only`, 2026-10-06).

Neither `migrate-preview` nor `renovate-config-validator` may ever be added
to branch protection (§4.1). After a reset of `preview` from its parent: §1,
"Resetting `preview` from its parent is not a migration".

---

## 5. Launch checklist (W5-T2) — who: the maintainer, with an agent for the local gates

Results are written beside the item they answer, each with its date; times
are UTC. **Pending** marks what was still to do when the record ended
(2026-10-07) and says what it needs: nothing marked pending has happened.
**No result on record** means exactly that: what this section was filled
from holds neither a result for the item nor a decision to skip it.
**Awaiting a ruling** marks a result that IS on record and that the
maintainer has not ruled on: it is neither accepted nor fixed.

### 5.1 Before tagging

| Gate                                             | Command or place                                                                                                | Expected                                                                                                                            | Result                                                                                                                                                                                               |
| ------------------------------------------------ | --------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| No decision-tree drawing left a placeholder      | `npx vitest run tests/unit/domain/schema.test.ts`                                                               | green                                                                                                                               | 2026-10-06 20:02Z, on #17's branch head (`2a311e5`), whose tree is the one merged as `863cd0c` at 20:21:34Z: **49 passed** (run as `npx vitest run --project unit tests/unit/domain/schema.test.ts`) |
| Every ★ guide is `status: full`                  | `npx vitest run --project integration tests/integration/content/coverage.test.ts` (Docker up, `_test` database) | green (`FULL_SLUGS`, `tests/fixtures/content-manifest.ts`)                                                                          | 2026-10-06: **61 passed** (Docker up, `_test` database)                                                                                                                                              |
| A `verifiedAt` for every retailer (both locales) | `lib/domain/data/retailers.ts`, checklist in [`retailers.md`](./retailers.md)                                   | all three `2026-09-21` (the verification log in `retailers.md`); re-run the checklist before launch if `retailers.ts` changed since | 2026-10-06: `retailers.ts` has no commit since 2026-09-21 (`6a9b563`) and its three `verifiedAt` read `2026-09-21` — nothing to re-run                                                               |
| The W5 items of the backlog                      | [`backlog.md`](./backlog.md), "W5 — launch"                                                                     | each one done, or re-scoped with a written reason                                                                                   | curated in the change that closed W5's documents — read the section for what became of each entry                                                                                                    |

### 5.2 The §9 verification

1. **Local, from a clean clone** — the README's quick start, then §9.1's walk:
   log in with `DEMO_USER`, open the gravel bike, click the chain in 3D and in the
   list, run a partial checkup on the rear caliper and the chain, mark the chain
   KO, finish, open the list, refine the chain, follow the Alltricks link (a new
   tab), enter an inseam on `/velo/<id>/reglages`; then the same as a guest, from
   `/` with "Je ne sais pas" everywhere, through sign-up and `/import`.
   Since the change that closed W5's documents, the quick start's
   `npm run dev` also generates the content tree (`lib/content/generated/`)
   before it starts the server — finding 1 below is why.

   **Result, 2026-10-07** — walked in a browser, by an agent the closing
   session delegated to, from `git clone --depth 1` of `main` @ `863cd0c` in
   a scratch directory. Two findings: one fixed, one **open**.
   - **The quick start.** `npm ci`: exit 0, 52 s, 1697 packages;
     `cp .env.example .env.local`. **One deliberate deviation**:
     `npm run db:setup` was not run, because it runs `docker compose up` and
     the project's Postgres container was already running, and shared.
     Instead a dedicated database, `velo_atelier_walk`, was created on that
     server and only the database name was changed in `.env.local`; then
     `npx prisma migrate deploy` (3 migrations applied:
     `20260911071112_init`, `20260921090547_checkup_symptoms_done_reason`,
     `20260930094543_one_open_build_list_per_bike`) and `npm run db:seed`
     (`✓ seed complete — users=2 bikes=4 checkups=1 lists=1`). `npm run dev`
     started clean (`✓ Ready in 425ms`, `GET /fr 200`). `npm run db:setup`
     itself is therefore not covered by this result.
   - **Finding 1 — fixed in the change that closed W5's documents: the quick
     start left the checkup route broken.** `npm run dev` was
     `npm run drawings && next dev`, and nothing in the quick start generated
     the gitignored `lib/content/generated/`. The first checkup page
     (`/fr/velo/<id>/controle?parts=chain%2Cbrake-caliper-rear`) answered 500
     — `Module not found: Can't resolve '@/lib/content/generated/reason-keys'`
     — and after that one request the dev server answered 500 on every route
     probed, until `npm run content:generate` was run in the clone; it
     recovered without a restart. Production builds are unaffected:
     `npm run build` generates the tree. **`npm run dev` now generates it
     too** — `npm run drawings && npm run content:generate && next dev`, about
     1.2 s more — and `tests/unit/deploy/dev-script.test.ts` holds it.
   - **Finding 2 — OPEN: not fixed, awaiting the maintainer's ruling** (fix
     before the tag, or tag first and open an issue). **The guest import
     drops the guest's checkup, and this is live on production.** What is
     imported: the bike (listed in "Mes vélos") and its to-fix list, with the
     same 3 lines. What is not: the checkup. After the walk's import the
     database held no `Checkup` row for the imported bike, its
     `BuildList.checkupId` was NULL, its 3 list lines had no `checkupItemId`,
     and all 36 of its `BikePartState` rows were `UNKNOWN`. Read in the
     source: `lib/guest/schema.ts` requires `steps` in the stored checkup,
     and the wizard stores one without (`toStored`, `lib/checkup/storage.ts`),
     so the state does not parse and is skipped. The tests are green because
     their fixtures hand-write a checkup with `steps` (`.debug/017` §5.6).
   - **Journey A** (signed in as `DEMO_USER`) — all seven steps passed: the
     demo sign-in; three bikes in "Mes vélos" and the gravel bike's viewer;
     the chain selected by a real click on the 3D canvas and from the parts
     list; a partial checkup on the chain and the rear caliper (4 steps, the
     chain KO, recap "3 ok · 1 à reprendre · 0 passées"); the list with the
     chain line, and a refinement that survives a reload; the Alltricks link
     (`target="_blank"`, `rel="noopener noreferrer nofollow"` — read off its
     attributes, not clicked); an inseam of 82 cm on `/reglages` giving
     "72,4 cm", which survives a reload. The checkup and everything after it
     passed only once `content:generate` had been run (finding 1).
   - **Journey B** (guest) — the decision tree with "Je ne sais pas" at each
     of 12 questions, to `/fr/velo/local`: passed. A partial checkup with two
     KO, to a guest list of 3 lines: passed. Sign-up with a throwaway
     `…@example.com` account: passed. `/fr/import`: the bike passed, the list
     passed, **the checkup failed** (finding 2). **Not verified**: the 3D
     view of the imported bike — the browser pane stopped compositing
     mid-walk, an environment problem and not the application's.
   - Console and server errors: all from finding 1's episode (83 "Module not
     found", 19 responses 500); none after `content:generate`; every server
     action returned 200.
   - Six more observations from the walk — seen first-hand, not checked
     against the plan — are recorded in `.debug/017` §5.6 for the
     maintainer's ruling.

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
   which needs that same database up.

   **Results, 2026-10-06** (and, where it says so, 2026-10-07).
   - **`bash scripts/ci.sh`** — 12/12 in 149 s (3487 tests) on #16's branch,
     whose tree is `main` @ `a754257`; 12/12 in 151 s (3545 tests) on #17's,
     whose tree is `main` @ `863cd0c`. The `boot` tier: 4/4, on #16's.
   - **e2e**, against a build made with the e2e flags, on #16's branch:
     `desktop-chromium` 431 passed / 65 skipped (4.0 min); the mobile projects
     are under item 3. #17, merged after it, changed no application file —
     workflows, `scripts/ci/`, tests, `renovate.json` and documents
     (`git diff --stat a754257 863cd0c`). Those runs were on the HOST (macOS);
     the Linux matrix itself ran in CI on each of the day's pull requests
     (item 4).
   - **`npm run e2e:docker` — one test awaits a ruling.** 2026-10-07,
     13:13Z–13:58Z, the amd64 CI image emulated on Apple Silicon,
     `--project=desktop-chromium --project=mobile-chromium` (the two that hold
     visual baselines), on the build of `2a311e5`: **924 passed, 3 failed,
     1 flaky, 64 skipped** in 44.8 min. All 20 `@snapshot` comparisons passed.
     The three failures and the flaky one are a single test in both languages
     and both projects, `tests/e2e/guides-filter.spec.ts` "a card opens its
     guide": after the click, `toHaveURL` timed out with the URL still
     `/fr/guides`. Run again on its own with `--repeat-each=3 --retries=0`:
     **9 passed (about 3 s each), 3 failed** out of 12. The same test passed on
     the host that day and in CI's native Linux matrix on all five pull
     requests. It is not treated as noise: `.debug/017` §5.7 has the cause read
     in the source — the guides list is rendered twice, and a click that lands
     during the swap is lost — and `docs/backlog.md` has the entry.
   - **Lighthouse CI — awaiting a ruling.** As
     `bash scripts/ci/lighthouse.sh` (8 URLs × 3 runs, the CI GL flags), run
     twice on the build of `2a311e5` (the tree merged as `863cd0c`), on the
     maintainer's Mac: **exit 1 both times**, on the same two assertions —
     the bike pages' LCP against the 3000 ms ceiling. Every other assertion
     passed in both runs.

     | Run | When (UTC)                                                                            | Load average, start → end | `/fr/velo/demo` LCP median | `/en/bike/demo` LCP median | Ceiling | Exit |
     | --- | ------------------------------------------------------------------------------------- | ------------------------- | -------------------------- | -------------------------- | ------- | ---- |
     | 1   | 2026-10-06 20:11–20:21                                                                | 4.5 → 5.5                 | 3101 ms (3.4 % over)       | 3073 ms (2.4 % over)       | 3000 ms | 1    |
     | 2   | started 2026-10-06 about 20:23; finished after the machine slept; reported 2026-10-07 | 2.3 → 2.1                 | 3062 ms (2.1 % over)       | 3003 ms (0.1 % over)       | 3000 ms | 1    |

     Run 2 spanned a machine sleep, so its wall-clock time means nothing; its
     medians are what the script printed. The medians of both runs:

     | URL                            | Run 1: performance | Run 1: LCP (ms) | Run 2: performance | Run 2: LCP (ms) |
     | ------------------------------ | ------------------ | --------------- | ------------------ | --------------- |
     | `/fr`                          | 0.96               | 2272            | 0.96               | 2261            |
     | `/en`                          | 0.96               | 2253            | 0.96               | 2216            |
     | `/fr/velo/demo`                | 0.86               | **3101**        | 0.86               | **3062**        |
     | `/en/bike/demo`                | 0.86               | **3073**        | 0.87               | **3003**        |
     | `/fr/guides/check-brakes-disc` | 0.97               | 2118            | 0.97               | 2095            |
     | `/en/guides/check-brakes-disc` | 0.96               | 2217            | 0.97               | 2119            |
     | `/fr/connexion`                | 0.97               | 2158            | 0.97               | 2043            |
     | `/fr/acheter`                  | 0.95               | 2352            | 0.96               | 2209            |

     TBT medians on the two bike pages: 152 and 143 ms in run 1, 141 and
     137 ms in run 2; the other URLs' TBT is not recorded. **The threshold was
     not changed**, and CI's `lighthouse` context — the gate — was green on
     every pull request of 2026-10-06. [`CLAUDE.md`](../CLAUDE.md) takes a
     local lhci number from an idle machine only ("Local lhci only on an idle
     machine"); the two load averages are in the table. This is recorded as
     data for the maintainer's ruling — not as a regression, and not as
     noise.

   - **`npm run lhci` and `npm run ci:local` exited 127**
     (`npx: command not found`) on the machine these were run on, while the
     same scripts called with `bash` ran — which is how CI and the git hooks
     call them. Under `npm run`, npm exports `npm_config_prefix`;
     `scripts/ci/_lib.sh` sourced `~/.nvm/nvm.sh` whenever that file existed;
     nvm printed
     `nvm is not compatible with the "npm_config_prefix" environment variable`
     and took node off `PATH` (that machine's nvm directory is a symlink to
     another volume). `ci:local` was affected before that day; `lhci` became
     affected when #16 routed it through the script. Fixed in the change
     that closed W5's documents: `_lib.sh` no longer sources nvm when a Node
     of the right major is already on `PATH` — as it is under an `npm run`
     started on Node 24; under another major it still sources nvm, and the
     old failure is unchanged there (`.debug/017` §5.1;
     `tests/unit/deploy/lib-nvm.test.ts`). **Re-run after the fix**, on the
     machine that showed it: `STEPS="nvmrc" npm run ci:local` →
     `✓ PASS nvmrc` / `:: ci:local passed`, where the same command had died
     with `npx: command not found`. Then the whole of it, 2026-10-07, on the
     tree of that change: `npm run ci:local` → **12/12 PASS in 190 s**
     (3552 tests; the `boot` tier 4/4), through npm from first step to last.
     `npm run lhci` end to end, through npm, after that fix: **no result on
     record**.
   - **perf** — `npx playwright test --project=perf --project=perf-mobile --workers=1`:
     12 passed (2.9 min), 20:10Z, on `2a311e5`.
   - One flake, for the record: `tests/unit/content/check.test.ts` timed out
     once in a pre-push run at machine load 17, while another build was
     running, and passed 33/33 alone in 8 s — the load-sensitive 5 s timeout
     #10 and #12 already describe.

3. **Mobile** —
   `npx playwright test --project=mobile-chromium --project=mobile-landscape --project=mobile-narrow --project=no-webgl`,
   then a real phone for the `perf-verified` label
   ([`bike3d-perf.md`](./bike3d-perf.md)).

   **Results, 2026-10-06** (the build of item 2, #16's branch):
   `mobile-chromium` + `no-webgl` 874 passed / 59 skipped (6.5 min);
   `mobile-landscape` + `mobile-narrow` 548 passed / 24 skipped (7.6 min).
   The real phone and the `perf-verified` label: **no result on record**.

4. **CI on a PR** — the twenty required checks green; a deliberately failing
   unit test turns `coverage (80%)` red; a `tests/e2e/__screenshots__` change
   without the `visual-baseline` label fails `visual-baseline-guard`.

   **Results, 2026-10-06**: each of the five pull requests merged that day
   (#13 to #17) landed with the twenty required contexts green. The two
   deliberate failures — a red `coverage (80%)`, an unlabelled baseline
   change: **no result on record**.

5. **Production** — the build log contains
   `check-env: environment contract satisfied (VERCEL_ENV=production, isProduction=true).`
   and `migrate deploy`; `/api/health` answers 200; the runtime logs carry
   `[env] contract enforced (VERCEL_ENV=production)`; Lighthouse mobile ≥ 0.85
   on `/fr`, `/en` and `/en/guides/check-brakes-disc`; sign up with a real
   e-mail and a strong password; Google sign-in completes; a preview deployment
   builds without migrating and signs in with a password.

   **Results, 2026-10-06** — production `dpl_8fUtvWonaB42YUxGCwha8aBsmn8F`
   (`main` @ `a754257`); the log lines themselves are in §2, "Read on Vercel".

   | Check                                                  | Result                                                                                                                                                                                                           |
   | ------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
   | The build log's `check-env` line, and `migrate deploy` | read: `check-env: environment contract satisfied (VERCEL_ENV=production, isProduction=true).` and `▶ prisma migrate deploy (VERCEL_ENV=production)` at 19:28:08Z, `No pending migrations to apply.` at 19:28:13Z |
   | `/api/health` answers 200                              | 200, `{"ok":true,"db":true}`                                                                                                                                                                                     |
   | The runtime logs carry the `[env]` line                | read, region `cdg1`, 19:29Z                                                                                                                                                                                      |
   | Lighthouse mobile ≥ 0.85 on the three URLs             | **0.93, 0.93 and 0.96** — medians of three runs, 20:06Z; the table is below                                                                                                                                      |
   | Sign up with a real e-mail and a strong password       | **Pending — the maintainer.** Needs a person, on production, with a real address                                                                                                                                 |
   | Google sign-in completes                               | **Pending — the maintainer.** [`qa/google-oauth.md`](./qa/google-oauth.md), all seven sections, on production                                                                                                    |
   | A preview deployment builds without migrating…         | read on the preview `dpl_4MS8nEKgrqYoUoVVrkoWeD5wh17f` (#16): `▶ skipping prisma migrate deploy (VERCEL_ENV=preview)`                                                                                            |
   | …and signs in with a password                          | **Pending — the maintainer.** E-mail + password on a preview URL                                                                                                                                                 |

   **Production Lighthouse, 2026-10-06 20:06Z** — Lighthouse 12.6.1,
   Chrome 154, mobile form factor, three runs per URL:

   | URL                            | performance (3 runs) | median | LCP ms (3 runs)    | TBT ms (3 runs) | CLS | accessibility / best-practices / SEO |
   | ------------------------------ | -------------------- | ------ | ------------------ | --------------- | --- | ------------------------------------ |
   | `/fr`                          | 0.90 / 0.93 / 0.93   | 0.93   | 2855 / 2604 / 2610 | 33 / 30 / 29    | 0   | 1.00 / 1.00 / 1.00                   |
   | `/en`                          | 0.93 / 0.93 / 0.93   | 0.93   | 2646 / 2590 / 2572 | 29 / 29 / 28    | 0   | 1.00 / 1.00 / 1.00                   |
   | `/en/guides/check-brakes-disc` | 0.96 / 0.96 / 0.96   | 0.96   | 2321 / 2273 / 2286 | 30 / 29 / 26    | 0   | 1.00 / 1.00 / 1.00                   |

   All three are at or above 0.85, which is what §9.5 asks. `lhci collect`
   asserts nothing, so one comparison is made here by hand rather than left
   out: `lighthouserc.cjs` holds content pages to an LCP of 2500 ms — in CI,
   against a server on the runner itself, with no network in between — and
   against that number the `/fr` and `/en` medians here (2610 and 2590 ms)
   are over and the guide's (2286 ms) is under. That ceiling is not this
   item's criterion, and no threshold was touched.

   **How it was run.** With the repository's own collect settings — applied
   throttling included — and **no local server**: a scratch
   `lighthouserc.cjs`, not committed, that `require`s the repository's and
   drops `ci.collect.startServerCommand`, handed to lhci as

   ```bash
   npx lhci collect --config=<that file>
   ```

   No `next` process existed during the run and lhci's log had no "server"
   line; both were checked. How the three production URLs were given to it —
   in that file or on the command line — is not recorded.

   **Do not use `lhci autorun` for this** — not
   `npx lhci autorun --collect.url=https://<prod-domain>/fr`, the form this
   section used to quote from §9.5, and not the same with
   `LHCI_BASE_URL=https://<prod-domain>` in front. That one WOULD start a
   local server: `lighthouserc.cjs` derives `PORT` from the variable — `"80"`
   for an https URL with no port — and its `startServerCommand` is
   `npm run start -- -p ${PORT}`, so lhci would run `npm run start -- -p 80`
   on the machine before it audited anything. With the variable unset the
   same file gives `-p 3100`: the command is in the configuration either way,
   which is why the scratch file drops it. (Read from the configuration:
   neither form was run.) `npm run lhci` cannot be used for this either: it
   forwards no arguments.

### 5.3 Then

- Open the first issues from [`backlog.md`](./backlog.md): one per entry marked
  _(W5-T2 opens an issue)_ — password reset by e-mail, nonce CSP, search,
  glossary, Neon preview branches, Upstash, affiliate programmes, the compose
  `seed` profile.

  **Done, 2026-10-06**: eight issues, each titled with its entry's heading,
  its body the entry's text verbatim, labelled `post-mvp` (a label created
  for them); in `backlog.md` each entry now carries its issue's link where
  the mark was —
  [#18](https://github.com/lienardale/velo-atelier/issues/18) Password reset
  by email,
  [#19](https://github.com/lienardale/velo-atelier/issues/19) Nonce-based
  Content-Security-Policy,
  [#20](https://github.com/lienardale/velo-atelier/issues/20) Upstash (or any
  shared store) for rate limiting,
  [#21](https://github.com/lienardale/velo-atelier/issues/21) Search index,
  [#22](https://github.com/lienardale/velo-atelier/issues/22) Glossary,
  [#23](https://github.com/lienardale/velo-atelier/issues/23) Affiliate
  programmes,
  [#24](https://github.com/lienardale/velo-atelier/issues/24) Neon preview
  branches per pull request,
  [#25](https://github.com/lienardale/velo-atelier/issues/25) A compose `seed`
  profile.

- Tag the release from `main`: `git tag -a v0.1.0 -m "vélo-atelier 0.1.0"` then
  `git push origin v0.1.0` (the maintainer).

  **Pending — the maintainer.** Neither the tag nor the release existed when
  the record ended (2026-10-07). The ruling on §5.2 item 1's finding 2 — fix
  before the tag, or tag first and open an issue — is to be made before it.

- Write the production domain into the README (both languages) in place of
  "_(W5)_".

  **Done** in the change that closed W5's documents: both lines carry
  `https://velo-atelier.vercel.app`.
