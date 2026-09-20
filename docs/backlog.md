# Backlog

Deliberately deferred work. Each entry says **what**, **why it was deferred**
and **what would have to be true** to pick it up. Nothing here blocks the MVP.

## Authentication

### Password reset by email

There is no mailer in the MVP, so the only password paths are
`changePasswordAction` (signed in, knows the current password) and
`setPasswordAction` (Google-only accounts adding a password). The sign-in page
deliberately shows no "forgot password" link.

_To pick up_: add [Resend](https://resend.com) (or any transactional provider),
bilingual email templates, a single-use token table with a short TTL, and rate
limiting on the request endpoint. Email verification for credential sign-ups
belongs in the same change.

### Passkeys / WebAuthn

Auth.js v5 supports a `Passkey` provider, but it needs the database adapter's
`Authenticator` model and a second device-management surface in `/compte`.

## Security

### Client address behind non-Vercel proxies

`lib/security/ip.ts` reads `x-vercel-forwarded-for`, then `x-real-ip`, then the first
`x-forwarded-for`. On Vercel the edge sets the first one, so a client cannot choose
its rate-limit bucket. Self-hosted behind nothing (or a proxy that does not rewrite
these headers), a client can send a fresh value per request and get a fresh bucket.

_To pick up_ (W4-T1): honour `x-vercel-forwarded-for` only when `VERCEL` is set, and
`x-real-ip` / `x-forwarded-for` only behind an explicitly configured trusted proxy
(an env flag the e2e web server also sets, since the fixture uses `x-real-ip`).

### Rate-limit buckets for IPv6

Per-IP buckets key on the full address. An attacker with an IPv6 /64 — routine for a
single host — rotates addresses and gets a fresh bucket each time; only the soft
per-e-mail bucket still applies. _To pick up_ (W4-T1): key IPv6 buckets on the /64.

### Account deletion confirmed by a word

`deleteAccountAction` accepts the account's password OR the word `SUPPRIMER` / `DELETE`
(§4 specifies both). A stolen session cookie can therefore delete an account that has a
password without knowing it. _To pick up_: require the password when the account has
one, and a fresh Google sign-in (`lib/auth/reauth.ts`) when it does not.

### Sign-out racing a document load in another tab

Once a JWT session is at least a day old, a full page load in another tab can land
after a sign-out and write the still-valid token back (`proxy.ts` keeps the daily
refresh on document navigations). This is inherent to stateless JWT sessions.

_To pick up_: a server-side revocation marker — for example bump `sessionVersion` on
sign-out, which also signs out every other device — or database sessions.

### Nonce-based Content-Security-Policy

`next.config.ts` ships a **static** CSP with `script-src 'self' 'unsafe-inline'`.
A nonce-based policy requires generating the nonce in `proxy.ts` and reading it
per request, which forces every route to be dynamic — that would cost the static
rendering of `/`, `/guides/[slug]` and `/velo/demo`, which the Lighthouse
budgets depend on.

_To pick up_: revisit when Next ships a way to inject a per-request nonce into
otherwise-static routes, and measure the LCP cost before committing.

## Content and search

### Search index

`/guides` filters client-side over titles and `partIds`. A real index (build-time
JSON + a scoring function, or an external service) adds moving parts and timing
flakiness for no MVP requirement.

### Glossary

Cross-linking jargon inside MDX needs a term registry and a hover card; the
guides currently define terms inline on first use.

## Product surface

### Admin role and back-office

Content is edited by pull request. No admin role, no moderation UI.

### `setChosenProductAction` is specified but not built

§4.4 lists it beside the build-list actions and `BuildListItem.chosenProduct`
exists in the schema (the seed writes one), but nothing in §6.5's build list
asks the visitor to record what they bought — the card offers vendor links, a
refinement form and a done checkbox. W3-T2 built what §6.5 describes. Today the
only writer of `chosenProduct` is the guest importer, which is why the retailer
host allow-list (§4.4) lives in `lib/guest/schema.ts`.

_To pick up_: decide the UI first ("j'ai acheté ça" on a done item?), then the
action, reusing `isRetailerUrl` from `lib/domain/data/retailers.ts` so the two
entry points enforce the same rule.

### The brand tier never renders on the build list

`components/build-list/RefinementForm.tsx` calls `shopQuestionsFor(build,
partId, locale)` without `tierLabels`, and that argument is the only thing that
appends the entry/mid/high question — so §6.5's "brand tier" control exists on
`/acheter` and nowhere else. The obstacle is real: `content/brands.yaml` is read
with `readFileSync` at module scope, and `/velo/[id]/liste` is a dynamic route
whose form is a client component (a guest's list is in `localStorage`).

_To pick up_: hand the tiers to the form as props from the server page, the way
`/acheter` already does.

### `?item=` is written and never read

`BuildItemCard` links to `/acheter` with `{part, bike, item}`, but
`components/shop/PartQuestions.tsx` reads only `part` and `bike`, so §5.5's
"pre-fills from the build-list item" is half-done: the visitor lands on the
right part with an empty form. The fix needs a build-list reader `/acheter` can
import without pulling in `components/build-list/BuildList.tsx`.

### The refinement disclosure has no illustration

§6.5 asks for "Comment mesurer" disclosures **with** an illustration;
`RefinementForm` ships the help text alone. A `"use client"` module may not
import `components/illustrations/index.ts` — all ~70 drawings would land in the
route's first-load JS — and the form is necessarily client-side. It needs an RSC
path like `components/mdx/Illustration.tsx`, handed down as a prop.

### CSV export of a build list

Print and copy-as-text cover the "take it to the shop" use case. A CSV export
needs a column contract nobody has asked for yet.

### Imperial units

Everything is metric. Tyre pressure is displayed in bar with a read-only psi
equivalent.

### A saved bike's in-progress checkup forgets which symptom was ticked

`CheckupItem` records the verdict, the note and the part, but there is no column
for the `reasonKey` the visitor chose on a KO — it materialises as
`BuildListItem.reasonKey` when the checkup is FINISHED. So a signed-in visitor
who answers "ça ne marche pas → garniture trop fine" and then reloads
mid-checkup gets the KO back but not the symptom, and a KO with no symptom falls
back to every consequence of the step (§5.4) — too much on the list rather than
the wrong thing. A guest's checkup keeps the whole state in `va:checkup:<ref>`
and is unaffected, and so is any checkup finished in one sitting, because the
browser sends its symptoms with `finishCheckupAction`.

A second column belongs in the same migration. `finishCheckupAction` closes an
open build-list line that a later checkup answered OK (§5.4, §6.7), but
`BuildListItem` has no `doneReason`, so an account cannot say whether a line was
ticked by the visitor or closed by the bike — the distinction a guest keeps in
`va:buildlist:<ref>`, and the one `markRechecked` exists to record.

_To pick up_: `reasonKeys String[]` (or a small `Json`) on `CheckupItem`, written
by `saveCheckupAction` and read by `loadStoredCheckup`, plus `doneReason
String?` on `BuildListItem` set by `closeRecheckedItems`. One migration, about
twenty lines. Both were left out of W3 because `prisma/schema.prisma` is shared
with three parallel branches (§8.0) and the wave froze it.

### Guides that need a workshop

Hydraulic bleeding, wheel truing, bottom-bracket and headset bearing
replacement, and motor/battery service exist only as "see a shop" outcomes.
Writing them responsibly needs photography and a safety review.

## 3D

### First-class variants not yet modelled

Hub and coaster brakes, folding bikes, front-hub motors, 13-speed drivetrains
and tubular tyres. Decision-tree options exist only where the parts data can
back them.

### Full-suspension kinematics

Rear suspension is visual only — no linkage simulation.

## Infrastructure

### Neon preview branches per pull request

Preview deployments share a single `preview` Neon branch. Per-PR branches need a
create/destroy hook and a quota conversation.

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

### Home's extra long task: the tree's client render after the Suspense fallback

`/[locale]` measures ~320 ms TBT on CI against a 300 ms gate. It is NOT payload:
controls showed trimming message flight moved 14 ms of 760, and removing all 54
drawings a further 2 ms, while the guide page has a near-identical document and
433 ms of react-dom against home's 796 ms (`.debug/008`). Under throttling home
has two long tasks where the guide has one, and a control that renders the page
without `DecisionTreeFrame` drops to the guide's level: the extra task is the
decision tree rendering on the client after React discards the `<Suspense>`
fallback it prerendered.

_To pick up_ (W4-T2): let the tree read the query in an effect so it is
server-rendered and hydrated once. It sits on `.debug/007`'s LCP fix, on
`DecisionTreeSkeleton.test.tsx` and on the repo-wide `useSearchParams`-in-Suspense
rule, so it needs its own e2e pass and a `.debug/007` amendment.

### `/velo` and `/compte` still ship all 13 message namespaces

`lib/i18n/client-namespaces.ts` narrows what reaches the client per route, but
those two still declare the whole catalogue: `PartInfo`, `PartEditForm`,
`MeasureCard` and `MeasurementForm` translate `parts.*` keys carried by the part
definitions, and `form-parts.tsx` resolves a message key a server action
returned. Pinning those the way `useDecisionText()` pins the tree's keys is the
largest remaining payload win — `/velo/demo`'s document is 43.8 kB and it owns
the worst TBT on the site (910 ms on CI).

W3 widened the blast radius rather than the problem: `/velo/[id]/controle` and
`/velo/[id]/liste` inherit the `velo/[id]` layout's declaration, and `/import`
inherits `(protected)`'s, so five more routes now ship the whole catalogue —
the checkup wizard reads `checkup`, `tools` and `guides`, and `/import` reads
`account` and `errors`. Only `/acheter` declares its own (`["shop"]`), because
its part and retailer names are resolved server-side through
`lib/domain/i18n.ts` with an explicit locale.

### `scripts/ci/e2e-docker.sh` has no way to choose its database

The script takes the Postgres CONTAINER through `E2E_DOCKER_PG_CONTAINER`, but
the database NAME comes from `.env.test` (`velo_atelier_test`) with no override.
During a parallel wave that is the one database shared with local dev and with
every other worktree, and the script migrates, truncates and seeds it — so the
three W3 agents whose specs perform no touch gesture (the `.debug/005` hazard
the script exists for) correctly declined to run it, and it was left to the
single-tenant integration run.

_To pick up_: honour `POSTGRES_URL` from the environment the way the vitest
tiers do, so a worktree can point it at its own `*_test` database.

### `reduced-motion.spec.ts` infers "the camera animated" from a frame count

`tests/e2e/bike3d/reduced-motion.spec.ts` focuses a part twice — once under
`prefers-reduced-motion: reduce`, once without — and asserts the second renders
at least five more frames in the same 1.2 s window. The inference only holds
while the render loop is fast enough for the difference to show. With two cores
lost to runaway processes (`.debug/010 §9`) both halves collapsed to **3
frames** and the comparison said nothing, deterministically, in a way that read
as a code regression for an hour. It passes on an idle machine and has passed on
CI at every wave — but the test still cannot distinguish "the camera did not
animate" from "this machine could not draw".

_To pick up_ (W4-T2, which owns the perf tier): assert the thing itself rather
than a proxy — sample `window.__va.bike` camera state across the 1.2 s window
and require it to be monotonic under motion and to arrive in the first frame
under reduced motion. Frame counts stay useful as a soft annotation.

### Every nightly `Perf` run had failed since the workflow was written

`.github/workflows/perf.yml` uploaded its `.next` artifact without
`include-hidden-files: true`. `.next` is a dotfile, so upload-artifact v4 skipped
it, **warned, and left the step green**; `perf (nightly)` and
`lighthouse (nightly)` then failed one stage later with "Artifact not found for
name: next-build". Fixed at the W3 integration by copying the two options the
identical step in `ci.yml` has always carried — the second,
`if-no-files-found: error`, is what makes the empty upload fail where it
happens.

Nothing was measured by that workflow in the meantime, so **W4-T2 inherits no
nightly perf history**: the first green run is the first data point.

### A killed Playwright run leaves its `next start` behind, at 100 % CPU

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

### mobile-webkit cannot run on this Mac

`browserType.launch` fails with `Executable doesn't exist at
~/Library/Caches/ms-playwright/webkit-2359/pw_run.sh`. The project is
non-blocking in CI, so nothing is red — but there is no local signal either.
`npx playwright install webkit` fixes it for whoever wants one.

### `docker-compose.yml` pins `container_name`, so `db:up` cannot run from a worktree

`container_name: velo-atelier-postgres` means a worktree's compose project cannot
adopt the already-running container — `docker compose up --dry-run` says it would
**recreate** it, taking the database out from under every other session. Parallel
agents therefore have to reuse the main checkout's container by hand.
_To pick up_: drop `container_name` and address the container through its compose
service name, or scope it per project (`scripts/ci/e2e-docker.sh` already takes
the name through `E2E_DOCKER_PG_CONTAINER`).

### Home first-load JS is 56 KiB above its target

`/[locale]` measures 186.3 KiB gzip against a 130 kB target (§7.3) — the
interactive decision tree, the local-bike codec and the `DECISION_TREE` data the
client needs to navigate. The ceiling is ratcheted, not met; **W4-T2 owns
closing the gap**, and `perf.budgets.json` carries the pin history.

### Analytics

No third-party analytics, no click tracking on retailer links, and therefore no
cookie banner. Any change here reopens the consent question.
