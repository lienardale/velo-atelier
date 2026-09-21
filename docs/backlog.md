# Backlog

Deliberately deferred work. Each entry says **what**, **why it was deferred**
and **what would have to be true** to pick it up. Nothing here blocks the MVP.

Two sections:

- **W5 — launch**: what the launch wave has to settle before `v0.1.0`
  ([`deploy.md`](./deploy.md) is its step-by-step).
- **Post-MVP**: everything after launch. W5-T2 turns the entries marked
  _(W5-T2 opens an issue)_ into the first GitHub issues (§8.6).

W4 closed ten entries — the forgotten symptom and `doneReason`, `?item=`, the
brand tier, IPv6 buckets, the `/velo`/`/compte` namespaces, the nightly Perf
artifact, the WebKit verdict bar, the reduced-motion frame count, e2e-docker's
database and the missing local WebKit — and re-scoped the others it owned,
each with its reason below; `.debug/012` has the table.

---

## W5 — launch

### Nothing enforces the production environment contract

`lib/env.ts` states the production rules — `AUTH_URL` and the Google pair
required; `ENABLE_TEST_PAGES`, `NEXT_PUBLIC_TEST_HOOKS` and
`NEXT_PUBLIC_DEMO_LOGIN` refused — and `tests/unit/db/env.test.ts` proves
`parseEnv` applies them. But nothing outside that test calls `getEnv()`, so no
server ever evaluates them. Two comments say otherwise:
`components/auth/SignInForm.tsx` ("`lib/env.ts` fails the boot if it is") and
`app/[locale]/(auth)/connexion/page.tsx` ("`lib/env.ts` refuses to boot a
production server that has it"). `scripts/bundle-guard.ts`, which
`scripts/vercel-build.sh` runs, does not close the gap either: it asserts that
`window.__va` is present exactly when `NEXT_PUBLIC_TEST_HOOKS=1`, so a
production build made with the flag on passes it.

_Why W5_: found while writing `docs/deploy.md` (W4-T4); it was never a
deliberate deferral. Until it is fixed, `deploy.md` step 2 — the three flags in
no Vercel scope — is the only guard.

_To pick up_: validate once when the server starts — Next 16's
`instrumentation.ts` `register()` runs once before a server takes requests
(`node_modules/next/dist/docs/01-app/03-api-reference/03-file-conventions/instrumentation.md`).
Not as the rule stands, though: `computeIsProduction()` treats any
`NODE_ENV=production` server without `VERCEL_ENV` as production, and the `next`
CLI defaults `NODE_ENV` to `production` for every command but `dev` — so that is
every `next start`, including the CI boot check in `scripts/ci/build.sh`
(`ENABLE_TEST_PAGES=1`) and the Playwright web server (`ENABLE_TEST_PAGES=1`,
`NEXT_PUBLIC_DEMO_LOGIN=1`). Scope the refused flags to `VERCEL_ENV`, have
`scripts/vercel-build.sh` refuse `NEXT_PUBLIC_TEST_HOOKS=1` when `VERCEL_ENV` is
set, then correct the two comments.

### The rate limiter logs a P2025 on every normal first attempt

`lib/security/rate-limit.ts` decides on the row returned by each request's own
conditional `UPDATE … WHERE` (that atomicity is the point — see `.debug/003`), and
swallows the P2025 when no row matched. But `lib/db/prisma.ts` sets
`log: ["error"]`, so the Prisma client logs it _before_ our code handles it: CI's
e2e output is full of "An operation failed because it depends on one or more
records that were required but not found." on a completely normal path. Harmless,
but it makes a real error indistinguishable from an expected one in production
logs. Fix by moving to `{ emit: "event", level: "error" }` and dropping P2025
from the known conditional-update call sites — not by reintroducing a read.

_Why W5_: production logs are read for the first time at launch (§9.5). Fix it
before, or expect this line on every first attempt of a rate-limit window.

### An account's build list shows only its newest checkup's lines

Every finished checkup creates its own `BuildList`, `/liste` shows the bike's
newest OPEN list, and nothing ever writes `BuildList` `DONE` or `ARCHIVED`.
Three consequences for an account, all live since W4 made each checkup a run of
its own (`.debug/013`):

- a line a LATER checkup closed (`doneReason: 'recheck-ok'`, written on the
  OLDER list) is never on screen, so "Marqué fait par un contrôle" is never
  shown to an account in the natural flow;
- the open lines of an older list drop out of view as soon as a newer checkup
  finishes — after an all-OK recheck the list page is empty;
- the quotas are enforced literally (W4 ruling: 10 lists/bike), so a bike that
  has finished 10 checkups can finish no other one (`TOO_MANY`).

A guest keeps one list per bike (`va:buildlist:<ref>`) and has none of this.

_Why W5_: a product decision, not a bug fix — and one a regular user reaches
after ten checkups. The W4 ruling took §4.2 (c) literally on purpose.

_To pick up_: choose the lifecycle, then implement it once on the server:
one list per bike like the guest (carry open lines forward), or archive the
previous list when a newer one is created and cap non-archived lists, or show
the newest non-empty list. Each changes what `tests/e2e/checkup-quota.spec.ts`
asserts.

---

## Post-MVP

### Authentication

#### Password reset by email

_(W5-T2 opens an issue)_

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

_(W5-T2 opens an issue)_

`next.config.ts` ships a **static** CSP with `script-src 'self' 'unsafe-inline'`.
A nonce-based policy requires generating the nonce in `proxy.ts` and reading it
per request, which forces every route to be dynamic — that would cost the static
rendering of `/fr`, `/en` and every `/[locale]/guides/[slug]` page, which the
Lighthouse budgets depend on (`/velo/[id]`, `/velo/demo` included, is dynamic by
design already).

_To pick up_: revisit when Next ships a way to inject a per-request nonce into
otherwise-static routes, and measure the LCP cost before committing.

#### Upstash (or any shared store) for rate limiting

_(W5-T2 opens an issue)_

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

### Content and search

#### Search index

_(W5-T2 opens an issue)_

`/guides` filters client-side by kind, system and the visitor's bike
(`lib/content/filter.ts`); there is no text search. A real index (build-time
JSON + a scoring function, or an external service) adds moving parts and timing
flakiness for no MVP requirement.

#### Glossary

_(W5-T2 opens an issue)_

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

_To pick up_: with the list lifecycle (W5 above) — abandon the older
`IN_PROGRESS` run on the first save of a new one (§4.2 b), and surface
`TOO_MANY` on the first refused save.

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

_(W5-T2 opens an issue)_

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

The Lighthouse ceiling stays 1 100 ms (derived from the worst of three
nightlies; same-day runs differ 20–40 %). Most of it is the 3D mount: with
WebGL disabled, local TBT is 60–83 ms (`.debug/014` §3). LCP is fixed (4 520 →
2 179 ms on `/en/bike/demo`).

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

_To pick up_: a maintainer decision on the methodology, then re-pin every URL
from new nightlies.

#### Soft-timing noise on the `perf` job

Tap latency crossed compare.ts's 300 % FAIL line on one sample in 70 in three
nightlies. W4 took the median of five taps and serialised the two perf projects
(`--workers=1`). If the required `perf` job still fails on a timing alone,
investigate the runner variance and report it — the ladder does not move.

### Infrastructure and tooling

#### Neon preview branches per pull request

_(W5-T2 opens an issue)_

Preview deployments share a single `preview` Neon branch. Per-PR branches need a
create/destroy hook and a quota conversation.

#### A compose `seed` profile

_(W5-T2 opens an issue)_

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
