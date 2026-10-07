# Backlog

Deliberately deferred work. Each entry says **what**, **why it was deferred**
and **what would have to be true** to pick it up. Nothing here blocks the MVP.

Two sections:

- **W5 — launch**: what the launch wave had to settle before `v0.1.0`
  ([`deploy.md`](./deploy.md) is its step-by-step). All six entries are
  settled in the repository — one, the `preview` migration, still waits for
  its first run on the provider; the section stays, one dated paragraph per
  entry, because `deploy.md` §5.1 points at it.
- **Post-MVP**: everything after launch. W5-T2 turned the eight entries that
  were marked _(W5-T2 opens an issue)_ into the first GitHub issues on
  2026-10-06 (§8.6): #18 to #25, label `post-mvp`, each linked from its entry.

W4 closed ten entries — the forgotten symptom and `doneReason`, `?item=`, the
brand tier, IPv6 buckets, the `/velo`/`/compte` namespaces, the nightly Perf
artifact, the WebKit verdict bar, the reduced-motion frame count, e2e-docker's
database and the missing local WebKit — and re-scoped the others it owned,
each with its reason below; `.debug/012` has the table.

W5 settled its own six, the last on 2026-10-06 — the environment contract, the
`renovate.json` validator, the `preview` migration, the limiter's P2025, the
build-list lifecycle and the twelve CodeQL alerts — and the paragraphs under
"W5 — launch" say what closed each. One is done in the repository and not yet
on the provider: the `preview` migration is a workflow whose first run still
waits for the maintainer. What that work found and did not fix is under
Post-MVP, in the entries whose reason reads "_Why deferred_ (W5)";
`.debug/017` has the measurements.

---

## W5 — launch

Six entries, the last of them settled on 2026-10-06 (times UTC); one, the
`preview` migration, still waits for its first run. Each paragraph says what
closed the entry and where to read about it. The entries' own text is in this file's
history (`git log -p -- docs/backlog.md`); the measurements are in
`.debug/017`.

- **Nothing enforces the production environment contract** — done 2026-10-06,
  PR #16 (`a754257`). The entry's "To pick up", as written: `instrumentation.ts`
  calls `getEnv()` at every server start, the three test flags are refused
  whenever `VERCEL_ENV` is set, `scripts/vercel-build.sh` refuses
  `NEXT_PUBLIC_TEST_HOOKS`, and the two comments are corrected. Beyond it:
  `scripts/check-env.ts`, a preflight that `scripts/vercel-build.sh` runs
  before `prisma migrate deploy` — Next does not run `register()` during a
  build, so without it a scope's values were first evaluated by the deployed
  server, after the production migration — and a build that refuses an absent
  or unknown `VERCEL_ENV`. Seen on Vercel the same day, on a preview and on
  production: `check-env: environment contract satisfied` in the build log,
  `[env] contract enforced (VERCEL_ENV=…)` in the runtime log, and a 200 from
  `/api/health`. Not seen anywhere: a refused build. Read `CLAUDE.md`
  ("`lib/env.ts` is the environment contract, and two things run it") and
  [`deploy.md`](./deploy.md) §2; what was written down rather than changed is
  "The environment contract's sharp edges" below.
- **Nothing in the repository reads `renovate.json`** — done 2026-10-06, PR #17
  (`863cd0c`). `.github/workflows/renovate-config.yml` runs
  `scripts/ci/renovate-config.sh` — the package's own
  `renovate-config-validator --no-global renovate.json`, pinned at renovate
  44.108.1 — on a pull request, and on a push to `main`, that touches
  `renovate.json`, the script or the workflow file. Path-filtered, so never a
  required context. Its first run, on PR #17 itself: pass, 41 s; its second,
  on that merge's push to `main`: pass, 44 s. Read [`deploy.md`](./deploy.md)
  §4.4.
- **A Neon branch that is not `production` is never migrated** — the workflow
  is done (2026-10-06, PR #17, `863cd0c`); **its first run is not.**
  `.github/workflows/migrate-preview.yml` runs `prisma migrate deploy` against
  `preview` (`scripts/ci/migrate-preview.sh`) on a push to `main` that touches
  `prisma/migrations/**`, and on `gh workflow run migrate-preview.yml --ref main`.
  It needs the maintainer's secret `NEON_PREVIEW_DIRECT_URL` and variables
  `NEON_PREVIEW_ENDPOINT` and `PREVIEW_MIGRATIONS_ENABLED`
  ([`deploy.md`](./deploy.md) §4.5's bootstrap). When this was written
  (2026-10-07 13:13Z) none of the three existed and the workflow had never
  run — `gh secret list`, `gh variable list` and
  `gh run list --workflow=migrate-preview.yml` each returned an empty list —
  so nothing migrates `preview` yet. The merge of #17 started no run, as
  designed: it changed nothing under `prisma/migrations/**`. The entry's other
  option, a deeper health probe, was not taken: `/api/health` is still a bare
  `SELECT 1` and cannot report a migrated schema, so the run's log and §4.5's
  query are the only evidence. What the workflow does not refuse is
  "`migrate-preview`'s remaining edges, and the Renovate validator's" below.
- **The rate limiter logs a P2025 on every normal first attempt** — done
  2026-10-06, PR #16 (`a754257`). Prisma's `error` log is an event now
  (`lib/db/prisma.ts`), and the listener (`lib/db/log.ts`) drops the limiter's
  expected miss and prints everything else; `lib/security/rate-limit.ts` is
  unchanged, and no read came back. Counted on PostgreSQL while fixing it: two
  P2025s per fresh key, one per expired window, up to six on a first sign-in —
  not one per first attempt, as this entry had it. Read `CLAUDE.md` ("Errors
  are EVENTS, not stdout"); what the listener still prints verbatim is "A
  Prisma validation error's log line carries the call's arguments" below.
- **An account's build list shows only its newest checkup's lines** — done
  2026-10-06, PR #13 (`4917696`), by ruling: one OPEN build list per bike, the
  guest's semantics. `finishCheckupAction` merges into the bike's newest OPEN
  list and creates one only when the bike has none (migration
  `20260930094543_one_open_build_list_per_bike`), so a line a later checkup
  closes is closed on the list on screen, earlier open lines stay, and a bike
  with an open list is never refused for `listsPerBike`
  (`tests/e2e/checkup-twelfth-run.spec.ts`). No data migration: a bike that
  held several OPEN lists keeps them and uses the newest, and whether any bike
  on production does had not been queried when this was written. What it left
  is "Nothing closes a build list" below. Read `CLAUDE.md` ("One OPEN build
  list per bike").
- **Twelve CodeQL alerts have been open on `main` since W2–W3** — done. PR #12
  (`13ba328`, 2026-10-04) fixed eight in code: the five in the two generator
  scripts and the three `js/superfluous-trailing-arguments`. The other four —
  alert 10 as a false positive; alerts 9, 12 and 3 as used in tests — were
  dismissed on 2026-10-06 (16:00:32Z–16:00:35Z), on the maintainer's
  instruction, each with the comment written in `audit-ci-allowlist.md`
  ("Alerts dismissed on GitHub, and why").
  `gh api "repos/lienardale/velo-atelier/code-scanning/alerts?state=open" --jq length`
  → `0`, that day and again on 2026-10-07.

---

## Post-MVP

### Authentication

#### Password reset by email

_Issue: [#18](https://github.com/lienardale/velo-atelier/issues/18)_

There is no mailer in the MVP, so the only password paths are
`changePasswordAction` (signed in, knows the current password) and
`setPasswordAction` (Google-only accounts adding a password). The sign-in page
deliberately shows no "forgot password" link.

_To pick up_: add [Resend](https://resend.com) (or any transactional provider),
bilingual email templates, a single-use token table with a short TTL, and rate
limiting on the request endpoint. Email verification for credential sign-ups
belongs in the same change.

#### Sign-up says whether an address is registered

The sign-up form answers "this address is already registered", which tells
anyone whether an address has an account. Accepted for the MVP and written down
in the header of `app/[locale]/(auth)/inscription/actions.ts` and in
`SECURITY.md`; the mitigation is the per-IP bucket (`signup:<ip>`,
`RATE_LIMITS.signupPerIp`: 5 attempts an hour, `lib/security/rate-limit.ts`).
The login form has no such leak.

_Why deferred_: the alternative — always answer success, and e-mail the owner
"you already have an account" — needs a mailer, and e-mail is out of MVP scope.

_To pick up_: in the same change as the password reset above, once there is a
mailer.

#### Passkeys / WebAuthn

Auth.js v5 supports a `Passkey` provider, but it needs the database adapter's
`Authenticator` model and a second device-management surface in `/compte`.

### Security

#### Account deletion confirmed by a word

`deleteAccountAction` accepts the account's password OR the word `SUPPRIMER` / `DELETE`
(§4 specifies both). A stolen session cookie can therefore delete an account that has a
password without knowing it. _To pick up_: require the password when the account has
one, and a fresh Google sign-in (`lib/auth/reauth.ts`) when it does not.

#### Sign-out racing a document load in another tab

Once a JWT session is at least a day old, a full page load in another tab can land
after a sign-out and write the still-valid token back (`proxy.ts` keeps the daily
refresh on document navigations). This is inherent to stateless JWT sessions.

_To pick up_: a server-side revocation marker — for example bump `sessionVersion` on
sign-out, which also signs out every other device — or database sessions.

#### Nonce-based Content-Security-Policy

_Issue: [#19](https://github.com/lienardale/velo-atelier/issues/19)_

`next.config.ts` ships a **static** CSP with `script-src 'self' 'unsafe-inline'`.
A nonce-based policy requires generating the nonce in `proxy.ts` and reading it
per request, which forces every route to be dynamic — that would cost the static
rendering of `/fr`, `/en` and every `/[locale]/guides/[slug]` page, which the
Lighthouse budgets depend on (`/velo/[id]`, `/velo/demo` included, is dynamic by
design already).

_To pick up_: revisit when Next ships a way to inject a per-request nonce into
otherwise-static routes, and measure the LCP cost before committing.

#### Upstash (or any shared store) for rate limiting

_Issue: [#20](https://github.com/lienardale/velo-atelier/issues/20)_

Rate limits live in Postgres: `lib/security/rate-limit.ts` keeps its counters in
the `AuthAttempt` table, one conditional statement per attempt.

_Why deferred_: a plan decision — "No Upstash in MVP". A Vercel function shares
no memory with the next invocation, so the counter has to live in a shared
store, and a row in the database the app already has works everywhere,
`docker compose up` included, with no second service to provision.

_To pick up_: a reason the table no longer fits — attempt volume that makes one
write per attempt a cost, or a limit needed on a path where a database round
trip is too slow. `RateLimiter` is already the interface: `lib/auth/authorize.ts`
takes one as a dependency (wired in `auth.ts`), and the sign-up, account and
import actions each build theirs with `createPrismaRateLimiter(prisma)` — so a
second implementation slots in behind it with one call site per file.

#### Client address behind non-Vercel proxies

`lib/security/ip.ts` reads `x-vercel-forwarded-for`, then `x-real-ip`, then the
first `x-forwarded-for` (§4.3). On Vercel the edge sets the first one, so a
client cannot choose its rate-limit bucket. Self-hosted behind nothing (or a
proxy that does not rewrite these headers), a client can send a fresh value per
request and get a fresh bucket. IPv4 addresses are bucketed as sent (no
leading-zero canonicalisation), which matters only in the same setting.

_Why deferred_ (W4 decision): trusting those headers only behind a configured
proxy changes §4.3's header chain, a final plan decision, and production runs on
Vercel. The e2e fixture's per-test `x-real-ip` also depends on today's chain.

_To pick up_: a deployment that is not Vercel. Honour `x-vercel-forwarded-for`
only when `VERCEL` is set and `x-real-ip` / `x-forwarded-for` only behind an
explicitly configured trusted proxy (an env flag the e2e web server also sets).

#### Quotas are counted, then written, with nothing held in between

Every quota is a `count()` followed by a `create()` in separate statements. That
covers:

- 20 bikes per account: `createBikeAction` and the guest import;
- 50 checkups and 10 lists per bike: `saveCheckupAction` and
  `finishCheckupAction`.

Requests sent in parallel all read the same count and all write, so a limit can
be overshot by as many requests as are in flight at once. Only the owner can do
this: every count and every write is owner-scoped, and anyone else gets a 404.
The overshoot lands in the owner's own account and never touches another user's
data. The W4 integration security review found it (`.debug/012`).

_Why deferred_: the quotas cap storage per account (§4.2 c); they are not an
access boundary. An owner overshooting by the number of requests they can keep
in flight does not defeat that cap before launch. The fix would touch every
quota-checked write path at the end of the hardening wave.

_To pick up_: serialise each count and its write behind a per-owner lock. Run
them in one interactive `$transaction` whose first statement is
`pg_advisory_xact_lock` on the bike id (on the user id for bikes). A second
request for the same bike then waits, and its count includes the first one's
row. Optionally add `@@unique([bikeId, startedAt])` on `Checkup` (today
`guestKey` is the only unique column besides the id): two requests carrying the
same run could then no longer create two rows (see "Two in-progress runs" under
Product surface).

#### The preview database secret is a repository secret

`NEON_PREVIEW_DIRECT_URL`, which one step of
`.github/workflows/migrate-preview.yml` reads, is the only `secrets.*`
reference in any workflow here, and [`deploy.md`](./deploy.md) §4.5 sets it up
as a repository secret. "`main` only" is therefore the script's rule, not
GitHub's: `scripts/ci/migrate-preview.sh` refuses any ref but
`refs/heads/main`, but a `workflow_dispatch` runs the workflow file and the
script of the ref it names, and GitHub hands a repository secret to that run
all the same. The guard stops an accidental `--ref`; it does not bind a branch
that edits the script.

_Why deferred_ (W5): by decision of the review of PR #17. It is not a
file-only change — the maintainer creates the Environment and its branch rule
first — and the secret did not exist yet when the workflow merged.

_To pick up_: with the bootstrap, or after it. A GitHub Environment restricted
to `main`, the secret stored there as an environment secret, `environment:` on
the job; the workflow, `tests/unit/ci/required-checks.test.ts` and `deploy.md`
§4.5 ("Who can read the secret") change with it. Per GitHub's documentation;
none of it was tried here.

#### Whether to rotate production's database password

A decision owed, not a task. Per Neon's documentation (read in review, not
checked against the live project) a child branch's roles have the parent's
passwords by default, and `preview` is a child of `production`: until
`preview` is rotated ([`deploy.md`](./deploy.md) §4.5, step 1) its connection
string carries production's password. `.debug/016` §3 records both endpoints
being queried by hand in the W5 session, so by §4.5's own rule — a string
handled outside the Neon console, GitHub's secret store and Vercel's variables
is spent — production's was handled by hand too; how it was given to the
client is not recorded. Rotating `preview` changes nothing on `production`.

_Why deferred_ (W5): it is the maintainer's decision, and it costs what the
preview rotation does not. The live deployment holds the old password, so the
site is expected to lose its database from the reset until a production
deployment has been rebuilt with the new strings (not exercised).

_To pick up_: decide, and write the answer in `deploy.md` §4.5 either way. If
yes: reset the role's password on the `production` branch, replace the two
strings in Vercel's Production scope and redeploy production — the
bootstrap's steps 1 and 5 on the other branch, not exercised — at a quiet
hour, and read `/api/health` once the new deployment is live.

#### `sslmode=require` in the Neon strings will change meaning

On each cold start production's runtime log carries a warning from `pg`: the
SSL modes `prefer`, `require` and `verify-ca` are treated as `verify-full`
today and will adopt libpq's weaker semantics in pg-connection-string v3 /
pg v9; it suggests writing `sslmode=verify-full` explicitly (seen 2026-10-06
19:29Z, region `cdg1`, unrelated to the change being deployed). So the Neon
strings in Vercel say `sslmode=require` — inferred from the warning: the
strings were not read.

_Why deferred_ (W5): by the warning's own account nothing is weaker today, and
the fix is an edit to connection strings in a dashboard, which no agent makes.

_To pick up_: before the `pg` major that changes it, write
`sslmode=verify-full` in the strings — Vercel's scopes and, once it exists,
the `NEON_PREVIEW_DIRECT_URL` secret. Check first, on a preview: that the
strings do say `require`; that `prisma migrate deploy` accepts `verify-full`
(it hands the direct string to Prisma's schema engine, not to `pg`, and
nothing here has tried that value there); and that
`scripts/ci/migrate-preview.sh` still accepts the string (every string it has
been run with says `sslmode=require`). Then read a cold start's log: the
warning should be gone.

#### A Prisma validation error's log line carries the call's arguments

`lib/db/log.ts` prints `event.message` verbatim, and for a
`PrismaClientValidationError` Prisma's message includes the call's arguments.
Measured in review on 2026-10-06 with canary values, in production's format: a
`user.create` with an unknown field logged the e-mail address and the password
hash. Not a regression — the same text went to stdout before W5 — but it now
passes one choke point, `reportPrismaError`.

_Why deferred_ (W5): unchanged behaviour, written down rather than changed
(`CLAUDE.md`, the header of `lib/db/log.ts`). The line goes to the server's
own log, and nothing in the repository forwards logs anywhere else.

_To pick up_: before any log drain or error tracker is added, decide whether
`reportPrismaError` redacts a validation error — the target and the engine's
last line only, for instance — and pin the choice in
`tests/unit/db/log.test.ts`.

### Content and search

#### Search index

_Issue: [#21](https://github.com/lienardale/velo-atelier/issues/21)_

`/guides` filters client-side by kind, system and the visitor's bike
(`lib/content/filter.ts`); there is no text search. A real index (build-time
JSON + a scoring function, or an external service) adds moving parts and timing
flakiness for no MVP requirement.

#### Glossary

_Issue: [#22](https://github.com/lienardale/velo-atelier/issues/22)_

Cross-linking jargon inside MDX needs a term registry and a hover card; the
guides currently define terms inline on first use.

### Product surface

#### Admin role and back-office

Content is edited by pull request. No admin role, no moderation UI.

#### Refinement drawings for the attributes no drawing covers yet

Since W4 the build list's "Comment mesurer" disclosures carry a drawing where an
existing one fits (axle, valve, speeds, wheel diameter, mounts, pedal type,
tubeless) — rendered on the server by `components/build-list/measure-drawings.tsx`
and passed down as props. Cassette range, largest cog, stem length and the other
attributes have no drawing, so their disclosure is text only.

_Why deferred_: new drawings are content work (the W2-T4 kind, `docs/illustrations.md`),
and W4 allowed none. _To pick up_: draw them, register them in
`lib/shop/measure-drawings.ts`.

#### The §4.4 actions no UI calls

§4.4's catalogue lists `setChosenProductAction`, `abandonCheckupAction`,
`createBuildListAction`, `addBuildListItemAction` and
`removeBuildListItemAction`; none exists. (`startCheckupAction` and
`saveCheckupItemAction` are folded into `saveCheckupAction`; the others ship
under W3 names: `finishCheckupAction`, `setBuildListItemRefinementAction`,
`setBuildListItemDoneAction`, `clearDoneBuildListItemsAction`.)

_Why deferred_ (W4): §6.5 has no UI that records a purchase, abandons a
checkup, creates a list or adds or removes a line by hand, and an exported
`"use server"` function nothing calls is attack surface without a user. The
`chosenProduct` link rule is enforced at every writer and reader that does
exist (`lib/shop/chosen-product.ts`); nothing writes `ABANDONED`, because the
wizard always resumes the run in progress.

_To pick up_: design the UI first ("j'ai acheté ça" on a done line, "abandon
this checkup"), then the action behind it, with its row in
`tests/security/csrf-and-actions.test.ts`.

#### A controlled input on a prerendered page drops text typed before hydration

react-dom 19.2.8 keeps text typed before hydration in the DOM but never passes
it to state: on `/acheter`'s free-text box the words stay visible and no vendor
link appears. A guest bike's `MeasurementForm` is worse — it re-seeds its draft
when `va:bike:local` resolves, in the render after hydration, wiping what was
typed (`.debug/015` §2, §9). The e2e specs wait until React owns the field.

_To pick up_: read the field's DOM value into state on mount; re-seed only the
fields the visitor has not touched.

#### The guides list is built twice, and a card clicked during the swap does nothing

`/guides` wraps `GuideFilters` — a client component that calls
`useSearchParams()` — in a `<Suspense>` whose fallback is the same grid of
cards. On a prerendered route the HTML holds the fallback and React builds the
boundary again on the client instead of hydrating it (`.debug/011`, the
decision tree's old problem). A click that lands while the first grid is being
replaced is lost: in the emulated Linux container
`tests/e2e/guides-filter.spec.ts` "a card opens its guide" failed 3 times in 12
on 2026-10-07, the URL still `/guides` ten seconds after the click
(`.debug/017` §5.7). The host and CI's native runners are too fast to show it.

_Why deferred_ (W5): found by the launch checklist. It costs a second tap on a
slow device and loses no data, and the fix is a change to a page.

_To pick up_: what `.debug/011` did for the tree — read the query through a
`useSyncExternalStore` with an empty server snapshot so the list is hydrated,
and keep only a `null`-rendering `useSearchParams` consumer inside the
boundary. The e2e test above, repeated in the container, is the proof.

#### The checkup's tool-list rows are centred with ragged offsets

`tap-target` sets `justify-content: center` on a full-width label, so the
checkbox rows start at different x. The committed `checkup-{fr,en}.png`
baselines record it as it is, so a fix regenerates those two through
`perf.yml` `update_snapshots=true`.

#### Two in-progress runs, and a quota refusal that says "not saved"

Since W4 each new checkup mints its own `startedAt`, so two tabs opened on
`/controle` after a finished checkup — or a `pagehide` flush landing after a
reload's server read — can create a second `IN_PROGRESS` row, which counts toward
the 50-checkup quota. And on a bike already at 50, a new run's first autosave is
refused `TOO_MANY` while the wizard shows only the generic "could not be saved"
chip, until "Créer ma liste" names the limit.

_To pick up_: on its own now — the list lifecycle it was waiting for is
settled (W5 above: one OPEN list per bike), and nothing writes `ABANDONED`
yet. Abandon the older `IN_PROGRESS` run on the first save of a new one
(§4.2 b), and surface `TOO_MANY` on the first refused save.

#### Nothing closes a build list

`BuildListStatus` has `OPEN`, `DONE` and `ARCHIVED`, and nothing under `app/`
or `lib/` writes the last two. Since W5 a bike has one OPEN list that every
checkup merges into, so the 10-lists quota is counted only on the path that
would create a list — reachable only by a bike whose lists something closed,
which today is nothing: `tests/security/quotas.test.ts` seeds `DONE` rows to
reach it.

_Why deferred_ (W5): the ruling was the guest's semantics, one list per bike.
Nothing in the UI closes or archives a list, and an action nothing calls is
attack surface without a user (the §4.4 entry above).

_To pick up_: a reason to start a fresh list. The UI first, then the action
behind it with its row in `tests/security/csrf-and-actions.test.ts` — and,
with it, what `listsPerBike` is for.

#### CSV export of a build list

Print and copy-as-text cover the "take it to the shop" use case. A CSV export
needs a column contract nobody has asked for yet.

#### Imperial units

Everything is metric. Tyre pressure is displayed in bar with a read-only psi
equivalent.

#### Guides that need a workshop

Hydraulic bleeding, wheel truing, bottom-bracket and headset bearing
replacement, and motor/battery service exist only as "see a shop" outcomes.
Writing them responsibly needs photography and a safety review.

### Shop and tracking

#### Affiliate programmes

_Issue: [#23](https://github.com/lienardale/velo-atelier/issues/23)_

Retailer links are plain outbound URLs with no affiliate id and no click
tracking (`lib/shop/outbound.ts`), and `/acheter` says so to the visitor
(`shop.outbound.disclosure`: "Plain links, no affiliation and no tracking: we
earn nothing on a purchase.").

_Why deferred_: a plan decision, with the retailer links: plain URLs a human has
verified, no scraping, no affiliate ids, no click tracking (§2.5); price
scraping, affiliate programmes and click analytics are explicitly out of MVP
scope.

_To pick up_: a decision to earn from purchases, then per retailer and locale a
programme and its link format; the disclosure rewritten in both locales; every
link re-verified by hand, since each changes; and the consent question below
answered if the programme tracks clicks.

#### Unverified retailers get no note on `/acheter`'s cards

The "lien non vérifié récemment" note is rendered only by `VendorButtons` (every
build-list line, and under `/acheter`'s part questions). `/acheter`'s category
cards and free-text search show none, although §5.5 says the shop page does.
Moot while every retailer carries a `verifiedAt` (2026-09-21), but it returns
the day one is cleared.

_To pick up_: render the same note from `SHOP_RETAILERS` next to the cards'
links.

#### Analytics

No third-party analytics, no click tracking on retailer links, and therefore no
cookie banner. Any change here reopens the consent question.

### 3D

#### First-class variants not yet modelled

Hub and coaster brakes, folding bikes, front-hub motors, 13-speed drivetrains
and tubular tyres. Decision-tree options exist only where the parts data can
back them.

#### Full-suspension kinematics

Rear suspension is visual only — no linkage simulation.

### Performance

#### Home first-load JS is ~61 KiB above its 130 KiB target

`/[locale]` ships 195 768 B gzip (191.2 KiB) against §7.3's 130 KiB target; the
ceiling is ratcheted, the target is not met. The first measured breakdown
(`scripts/perf/bundle-breakdown.ts`, W4): next + React 131.7 KiB — an empty
Next 16 + React 19 + next-intl route is 130.7 kB on its own (`.debug/001`), so
the target sits below the framework floor — then Radix 11.7, the ICU message
parser 9.6, tailwind-merge 8.3, next-intl + use-intl 4.6, the Turbopack runtime
4.2, next-auth 2.2, lucide 1.8 and ~16 KiB of app code.

_Why deferred_ (W4 decision 6): what is above the floor is plan decisions
(Radix §6.5, `SessionProvider` §4.3), the design system (tailwind-merge) or
framework configuration. The target stays; nothing was re-pinned upward.

_To pick up_, measured on the merged tree first: next-intl's
`experimental.messages.precompile` (the ICU parser, ~9.6 KiB on every route);
`tree-frame-attrs.ts` taking its aspect from the server (~2.1 KiB); then the
plan-level options (Radix, `SessionProvider`), which need a plan change.

#### Bike-page TBT is 713–971 ms on CI against a 600 ms target

The Lighthouse ceiling stays 1 100 ms. The W4 integration's five-run nightly
(35692898573) measured 856–954 ms (median 922), and `ceil50(922 × 1.15)` is
1 100, so the rule leaves no room; same-day runs differ 20–40 %. The same
nightly pinned performance at 0.69 and LCP at 3 000 ms (§7.3's target: LCP is
fixed, 4 520 → about 2 290 ms). Most of the TBT is the 3D mount: with WebGL
disabled, local TBT is 60–83 ms (`.debug/014` §3).

_To pick up_: `renderer.compileAsync` in `BikeScene` (three 0.185.1 polls
`KHR_parallel_shader_compile`), building the scene across frames, hydrating
`PartsPanel` lazily on mobile — then tighten the pin with the rule in
`lighthouse-report.ts`.

#### Lighthouse rasterises the page through SwiftShader

`--ignore-gpu-blocklist` (the CI GL flags) makes Chrome GPU-rasterise the page
through SwiftShader: a trace shows first paint waiting 1.75 s in
`RasterDecoderImpl::DoEndRasterCHROMIUM`. `--disable-gpu-rasterization` would
keep WebGL on SwiftShader and raster the page on the CPU (locally, cold FCP
4.4–9.7 s → 1.6–2.1 s) — but it changes what every Lighthouse number means.

Locally that software raster competes with everything else for the CPU, and
the bike pages sit at their LCP ceiling. `.debug/014` §4 measured 3 004–3 027 ms
at a load average of 4, before the ceiling was pinned to 3 000 ms from CI's
nightly (2 252–2 341 ms there). Three local runs of
`bash scripts/ci/lighthouse.sh` on the build of `2a311e5` (the tree merged as
`863cd0c`) then exited 1 on exactly those two assertions, with every other
assertion passing: run 1, 2026-10-06 20:11–20:21Z, load average 4.5 → 5.5 —
`/fr/velo/demo` median 3 101 ms, `/en/bike/demo` 3 073 ms; run 2, started
about 20:23Z that day and finished after the machine had slept, load average
2.3 → 2.1 — 3 062 ms and 3 003 ms; run 3, 2026-10-07 14:15–14:25Z as
`npm run lhci`, load average 5.3 → 3.5 — 3 048 ms and 3 045 ms. CI's
`lighthouse` context was green on every pull request of 2026-10-06. The
threshold was not changed, and the three runs are recorded as data for the
maintainer's ruling, not as a regression and not as noise (`.debug/017`
§5.2).

_To pick up_: the maintainer's ruling on the three local runs above and a
decision on the methodology, then re-pin every URL from new nightlies. Until
then a local run that fails on the two bike-page LCP assertions alone is read
against CI's `lighthouse` job before it is called a regression: the pins come
from a nightly's five-run medians, never a laptop's.

#### Soft-timing noise on the `perf` job

Tap latency crossed compare.ts's 300 % FAIL line on one sample in 70 in three
nightlies. W4 took the median of five taps and serialised the two perf projects
(`--workers=1`). The first comparison against real baselines then failed on
long frames alone (6 against a median of 1, code unchanged); by the W4 ruling
they only warn on a software renderer (`.debug/012` §12). If the required
`perf` job still fails on a duration alone, investigate the runner variance and
report it — the ladder does not move.

### Infrastructure and tooling

#### Neon preview branches per pull request

_Issue: [#24](https://github.com/lienardale/velo-atelier/issues/24)_

Preview deployments share a single `preview` Neon branch. Per-PR branches need a
create/destroy hook and a quota conversation.

#### A compose `seed` profile

_Issue: [#25](https://github.com/lienardale/velo-atelier/issues/25)_

Docker provides Postgres and nothing else: migrations and the seed run from the
host (`npm run db:setup` → `scripts/db/local.sh --seed`).

_Why deferred_: plan §10 question 8, default "no" — one code path to prepare a
database, the one a contributor debugs (the header of `docker-compose.yml`).

_To pick up_: a contributor with Docker but no host Node. §10 sketches a `seed`
service (`node:24-alpine`, `profiles: ["seed"]`, `depends_on` the healthy `db`),
but it cannot run `npm run db:setup` as sketched: `scripts/db/local.sh` calls
`docker compose` itself and hard-codes `localhost`. The service would run
`npx prisma migrate deploy && npx prisma db seed` against the host `db`, which
the seed guard already accepts (`lib/db/guard.ts`). Acceptance from §10:
`docker compose --profile seed up --exit-code-from seed` exits 0, then
`npx tsx scripts/db/count.ts` prints `users=2 bikes=4`. Like `db:up`, it would
run from the main checkout only (next entry).

#### `docker-compose.yml` pins `container_name`

`container_name: velo-atelier-postgres` means a worktree's compose project cannot
adopt the running container: `docker compose up --dry-run` from a worktree would
create a second one with the same name, or — with the project name forced —
recreate the shared one. Since W4 no worktree needs compose: `scripts/ci.sh`
(and the pre-push hook) skips `db:up` when the database answers and refuses it
from a worktree, and `scripts/ci/e2e-docker.sh` finds the container by name and
takes each worktree's own `*_test` database.

_To pick up_ (a cleanup now, not a hazard): drop `container_name` and address
the container through its compose service name, from the main checkout.

#### A killed Playwright run leaves its `next start` behind, at 100 % CPU

`playwright.config.ts` sets `reuseExistingServer: !CI`, so the web server is
started outside the test process and nothing reaps it when a run is killed or an
agent ends mid-run. Two of them — from the W3 sub-agents' worktrees, ports 3101
and 3103 — were found spinning at 97 % CPU each, up to three days old, holding
no port and producing no output (`.debug/010 §9`). The only symptom is that
_other_ tests get slower, which reads as flakiness in whatever is under test.

_To pick up_: have `scripts/ci/e2e*.sh` refuse to start when a `next start` on
the target port is already running and older than the current build, or drop
`reuseExistingServer` locally and pay the start-up cost. Until then:
`pgrep -fl "npm run start -p 31"` before trusting any local timing.

#### WebKit sign-ups hang in the emulated container, and twice on CI

The local WebKit is the CI container (`npm run e2e:docker -- --project=mobile-webkit`),
but on this Mac's emulated amd64 container every WebKit sign-up hangs after the
click — a control test too, while mobile-chromium passes. On CI,
`account.spec.ts`'s `register()` hung twice in W4 (runs 35632747193 and
35639300551, FR), passing on retry. The leg is non-blocking; the hang is
undiagnosed (`.debug/015` §9).

_To pick up_: reproduce on a native amd64 host, then decide whether it is the
test (a navigation raced, like the two W4 fixed) or WebKit.

#### `/liste` depends on Turbopack tracing `content/`

`/velo/[id]/liste` reads `content/brands.yaml` per request through
`lib/shop/retailers.ts`. That works because Next 16.3.4's Turbopack traces
`content/` into the route's `page.js.nft.json`; no gate re-checks it, and e2e
runs from the checkout, so it cannot see a missing trace. After a Next upgrade
that drops it, `/liste` would fail at module load in production with every gate
green.

_To pick up_: assert the trace in `scripts/bundle-guard.ts`, or generate the
brand tiers into a module at build time.

#### `mobile-sheet`'s canvas tap skips at 320 px when the caliper is not hittable

The test skips at run time when the front caliper is not hittable from any
pose. It happened in both locales on the macOS host and in EN on CI, so §6.8
AC5's tap is not reliably verified on `mobile-narrow`.

_To pick up_: pick a pose the solver guarantees is hittable at 320 px, and make
the skip a failure.

#### `migrate-preview`'s remaining edges, and the Renovate validator's

What the review of PR #17 listed and left, by decision. The workflow had not
run once when this was written (W5 above).

- The bootstrap SKIP — no secret, no switch — is a green run with no
  `::warning::` annotation and no job-summary line.
- The database NAME in the secret is not asserted in advance. A name that does
  not exist is caught after the fact (Prisma creates the database, and the
  script fails the run on that line); one that does exist on the preview
  endpoint is migrated, green.
- `hostaddr` and `port` query parameters are not refused (`host` is; Prisma
  7.10.0 ignored `hostaddr` when it was tried, `port` was not tried).
- The log cuts the host at its first 14 characters, not on `ep-<word>-<word>`:
  it shows the endpoint's two words only because both endpoints here are
  `ep-` + 5 + 5 letters.
- `tests/unit/ci/required-checks.test.ts`'s "pins Node through .nvmrc
  everywhere" reads `ci.yml` only. The two new workflows do use
  `node-version-file: .nvmrc`, and nothing asserts it.
- A `paths:` filter looks at the first 300 changed files of a push (GitHub's
  documentation, not observed): a migration past them starts no run at all.
- No `packageRules` entry sets a cadence for Renovate's own bump of
  `RENOVATE_VERSION` in `scripts/ci/renovate-config.sh`: expected about weekly
  and not automerged — inferred from the config, not observed.
- `renovate.json` still spells `customManagers[].fileMatch`, which Renovate
  has renamed `managerFilePatterns`. The validator warns
  `Config migration necessary` and exits 0; `--strict` would exit 1 on that
  warning, so it stays off until the rename lands (the header of
  `scripts/ci/renovate-config.sh`).

_Why deferred_ (W5): each is narrower than the three blockers that review did
fix (the secret at job level, nothing telling production's string from
preview's, guard tests that could not fail), and the workflow had not run
once when they were listed.

_To pick up_: after the first real runs. An annotation and a summary line on
the SKIP; the database name asserted the way the endpoint is; `hostaddr` and
`port` refused by the URL probe; for the 300 files, the maintainer's rule in
[`deploy.md`](./deploy.md) §4.5 ("Afterwards") until a merge that large
carries a migration; a `packageRules` entry for `renovate` if the bump proves
to be noise; the `managerFilePatterns` rename, then `--strict`. Per-PR Neon
branches (above) remove the shared branch and most of this list with it — and
the one thing no workflow can fix on a shared branch: a pull request that adds
a migration previews against the old schema until it merges.

#### Renovate reads an `overrides` entry as a dependency

Renovate's Dependency Dashboard (issue #11) proposes updates for entries of
`package.json`'s `overrides`. Read on 2026-10-06: `toml` to ^5.0.0, `uuid` to
^14.0.0 and `mysql2` to 3.24.4. Read on 2026-10-07: those three under
"Awaiting Schedule" (`mysql2` now 3.24.5), and two more under "Pending Status
Checks" — `@modelcontextprotocol/sdk` to 1.32.1, the release #15's exact pin
at 1.31.0 was written to hold back, and a lockfile update of `basic-ftp` to
6.2.2. An override here is a security pin whose version was checked against
its parent, call site by call site (`audit-ci-allowlist.md`); a bump is an
untested version for that parent. Only `argparse` is capped (`renovate.json`:
`matchDepTypes: ["overrides"]`, below 3).

_Why deferred_ (W5): found while clearing the advisories of 2026-10-05 and
2026-10-06 and not fixed there — the rule to write covers every override at
once, and is not part of an advisory response.

_To pick up_: before any of them becomes a pull request — expected at a
scheduled run (`renovate.json`: Mondays before 5am, Europe/Paris), not
observed. One `packageRules` entry on `matchDepTypes: ["overrides"]`, the
shape the `argparse` cap already has, that either disables updates for
overrides or holds each below the major its compatibility note covers. The
`renovate-config-validator` job checks the file; the dashboard shows whether
the proposals went away. An override then moves by hand, with its note, when
its advisory or its parent does.

#### The `audit` gate goes red on `main` after a green pull request

`audit` fetches advisories live, by design. It went red on `main` three times
between 2026-10-04 and 2026-10-06: on `braces` (run 37219094191), on four ids
at once (run 37443674634, with `trivy` red on one of them), and on `sharp`
(run 37491401212). That last advisory was published at 13:43:57Z on
2026-10-06, six seconds after PR #14's last `audit` job had started (it passed
at 13:44:42Z) — so a pull request can be green on every required context and
still turn `main` red at its merge. The gate also flaps while an advisory
arrives: on one unchanged tree `npx audit-ci --config audit-ci.json` failed 2
runs of 6 within ten minutes (17:00Z–17:10Z that day, 85 to 95 minutes after
GHSA-6qxp-vccf-f47h was published at 15:35:44Z) — the registry does not serve
a new id to every request at once.

_Why deferred_ (W5): the gate is doing what it is for, and nothing here
loosens it. What it costs is a red `main` that no pull request caused, and a
job whose verdict can depend on the minute it ran.

_To pick up_: two options, neither decided — a scheduled `audit` run that
opens an issue, so that a new advisory is met by a cron before it is met by
the next merge; and re-running the `audit` job once before reading it on a
day advisories are landing. Neither changes the rule: fix first, allow-list
last (`audit-ci-allowlist.md`).

#### The environment contract's sharp edges

Four things PR #16 wrote down rather than changed:

- `lib/env.ts` requires `POSTGRES_URL` and `POSTGRES_URL_NON_POOLING` by those
  names; `lib/db/env.ts`, which resolves the connections, also accepts Neon's
  `DATABASE_URL` and `DATABASE_URL_UNPOOLED`. A deployment configured with
  Neon's names only would connect and still be refused.
- The contract anchors `^postgres(ql)?://` on the raw value; `lib/db/env.ts`
  trims first. A URL with a leading space is refused by one and would connect
  through the other.
- A MISSING variable stops zod before the cross-field rules, so one refused
  build may not be the last: `check-env` says "the next build may name more".
- Nothing has shown a refused build on Vercel — nor what a refused deployment
  serves there, `VERCEL_ENV` with the system-variables setting off, a Custom
  Environment, or Instant Rollback. Only the passing path was seen, on
  2026-10-06, on a preview and on production.

_Why deferred_ (W5): `parseEnv` was left as it was, by ruling. The Vercel
project sets the `POSTGRES_*` names, so nothing is broken today, and
reconciling the two modules is a decision, not a tidy-up (the comment on
`POSTGRES_URL` in `lib/env.ts`). The Vercel half needs a deployment broken on
purpose.

_To pick up_: decide which module is right about names and trimming, and
change both in one commit, with `tests/unit/db/env.test.ts`. And the first
time a build is refused on Vercel, write into [`deploy.md`](./deploy.md) what
happened to the previous production deployment: that it keeps serving is
Vercel's documentation, not an observation.

#### A local production server needs the Google pair, and `npm run lhci` forwards no arguments

Since PR #16 `npm run start` from the README's `.env.local` — Google pair
empty — is refused: Next prints "Ready", then every page answers 500, with
`AUTH_GOOGLE_ID is required in production` in the log (measured 2026-10-06).
`npm run dev` is unaffected. `npm run lhci` is `bash scripts/ci/lighthouse.sh`
for that reason, and arguments after `npm run lhci --` are no longer
forwarded. Auditing production therefore took a scratch config on 2026-10-06:
a `lighthouserc.cjs` that `require`s the repository's and drops
`startServerCommand`, run with `npx lhci collect --config=<that file>`.
`LHCI_BASE_URL=https://…` would have started a local server as well: the
config derives that server's port from the same variable ("80" for an https
URL with no port).

_Why deferred_ (W5): the first is the contract as written — a `next start`
with no `VERCEL_ENV` is a production server — and the README and
`CONTRIBUTING.md` say so. Forwarding the arguments was the one item of the
review's second pass that was not applied.

_To pick up_: forward `"$@"` to `lhci autorun` in `scripts/ci/lighthouse.sh`,
and give `lighthouserc.cjs` a way to audit a remote origin without starting a
server, so that [`deploy.md`](./deploy.md) §5.2's production audit is one
command. For `npm run start`: only once somebody needs a local production
server without Google credentials — then the question is whether the pair is
required of a deployment (`VERCEL_ENV`) or of every production server.

#### `tests/unit/content/check.test.ts` is load-sensitive

The file calls `makeRoot` — a fresh recursive copy of `messages/`,
`components/illustrations/` and, in all but three calls, `content/` — from 26
places, one of them inside the loop over the eight known-bad fixtures, under
the unit project's default 5 s timeout. It timed out once in a pre-push run on
2026-10-06, at a machine load of 17, and passed 33/33 alone in 8 s. The same
file against the same 5 s is in `.debug/009` and `.debug/010`, and the same
shape on other files in `.debug/014` §7.

_Why deferred_ (W5): this time it failed only under load, on one machine, and
passed alone. The timeout was left where it is.

_To pick up_: a shared fixture root — copy the corpus once per file, as
`cleanRoot` already does for the fixture tests' control, and have each test
write only what it mutates — rather than a longer timeout.
