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

_To pick up_: a `reasonKeys String[]` (or a small `Json`) column on
`CheckupItem`, written by `saveCheckupAction` and read by `loadStoredCheckup`.
It is one migration and about ten lines; it was left out of W3-T1 because
`prisma/schema.prisma` is shared with three parallel branches (§8.0).

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
