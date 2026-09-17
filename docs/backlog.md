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

### Analytics

No third-party analytics, no click tracking on retailer links, and therefore no
cookie banner. Any change here reopens the consent question.
