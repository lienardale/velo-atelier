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

#### `updateBikeFitAction` and `updateBikeAction` read a bike and write it back with nothing held in between

`updateBikePartAction` did too, until 2026-10-09: two calls for one bike that
overlap each read the row and each wrote its own edit over the other's, both
answering ok. They do overlap — Next's client sends an action dispatched
during a navigation at once, whatever is pending, and two tabs need no
navigation (`.debug/017` §5.8, "Review of the fix"). That action now takes the
bike row's lock before it reads. Two others have the old shape (read, not
measured): `updateBikeFitAction` merges a patch into the `fit` it read, so of
two measurements saved together one can be lost; `updateBikeAction` re-derives
`parts` from the row it read, so a part edit committed between its read and
its write is written over.

_Why deferred_: found while repairing the part form's fix, the day before the
tag, and neither was measured. `MeasurementForm` has no write on removal, but
that is not what it takes: two selects changed and then a route change lost
an edit in one run of four before the part form had one.

_To pick up_: the same shape as `updateBikePartAction` — one interactive
`$transaction` whose first statement is an owner-scoped `UPDATE` of the bike
row, every query through `tx` — and, as there, a test on PostgreSQL that sends
several calls together (`tests/integration/bikes.test.ts`).

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

#### A number field left holding text the browser cannot read clears its attribute

In the part edit form (`components/bike/PartEditForm.tsx`), a number field
holding `4e` or a lone minus — or, in macOS Chromium, `45.` on the way to
45.5, which CI's Linux Chromium reads as 45 — reports an EMPTY value to the
page, with `validity.badInput` as the only sign that anything is
in it. LEAVING such a field sends that empty value as a clear: the stored
value is deleted, the write answers ok, the field still shows the characters
and its status reads "Enregistré" (measured on 2026-10-09 in Chromium 153, a
guest bike, mouse and touch; `.debug/017` §5.8). `main` does the same.

_Why deferred_ (the review of the part-form fix, 2026-10-09): the fix made a
field REMOVED with such text send nothing and say so — that exit was new, and
deleted a value that used to survive. The blur is older than the fix and was
left as found: changing what leaving a field does is a decision about the
form, not a repair of the change under review. **Awaiting the maintainer's
ruling.**

_To pick up_: if ruled "never a clear", make the blur do what the removal
does — nothing sent — and show `bike.errors.invalid-value` under the field
(it is still there to show it under). The field already records `badInput`
on every keystroke; `tests/e2e/part-panel.spec.ts` has the helper that types
the real thing, and jsdom needs the state given to the node
(`typeUnreadableInto`).

#### Two writes of one field of a saved bike can be in transit together, and the last to ARRIVE wins

While the page stays put Next's client sends one server action at a time
(read, in its documentation and its source), so two writes of one field land
in the order they were typed. After a navigation it sends the next one at
once. The part form's write on removal is dispatched on a route change; if
the visitor comes straight back and edits the same field while that write is
still on its way, the second write leaves too (measured on 2026-10-10,
Chromium 153, `desktop-chromium` and `mobile-chromium`: two POSTs in transit
together, 16 runs of 16).
`updateBikePartAction` applies them in the order they reach the bike row's
lock. Delivered in the order sent, the bike ends at the last value typed.
Delivered the other way round — produced by holding the requests in
Playwright; no network was seen to do it — the bike ended at the FIRST value
typed, and the page ended saying so: the field and the read-only line showed
it, under a status still reading "Enregistré" from the other write, with no
notice (8 runs of 8; `.debug/017` §5.8, "Second review").

_Why deferred_ (the second review of the part-form fix, 2026-10-10): the
finding under repair was that the second write was not SENT; it is now.
Ordering the two is a change to how the form writes, with a price, and not a
repair of that. **Awaiting the maintainer's ruling.**

_To pick up_: if ruled "one write of a field at a time", keep a later write
of the same bike, part and key back until the earlier one has answered or
failed — the form already keeps them on record under that key
(`lib/bike/own-writes.ts`). The price to weigh: a field then waits
for as long as an earlier write of it hangs, which today only happens while
the page stays put (Next's own queue). The write on removal must stay
synchronous when nothing is in flight: a guest bike is in storage before the
teardown returns, and a test holds it. The alternative is on the server — a
sequence number per field, the older write refused — and needs the action's
`.strict()` input to grow.

#### The part form saves nothing when the page is unloaded with the caret in a field

A value typed and not left is committed when its field is removed — another
part, another tab, the panel rebuilt, a route change inside the app. A reload,
a closed tab or another document unmounts nothing, and the text is lost
(measured on 2026-10-09: a guest bike held 42 where 45 was typed, a saved one
45 where 46 was; `.debug/017` §5.8). It was as lost before the form had that
rule.

_Why deferred_: a `pagehide` flush would save a guest bike (its write is
synchronous) and not reliably a saved one (a request the browser is free to
drop as the page goes), and could report neither — a difference between the
two bikes this form is built not to have.

_To pick up_: decide whether a guest-only save is wanted; for a saved bike,
`fetch(…, { keepalive: true })` to a route handler rather than a server
action, and a way to say on the next visit that the last edit did not land.

#### A guest bike replaced from another page: what still follows the slot, and not the bike

`va:bike:local` is a slot. The guest bike in it is replaced by a NEW one — a
new id — by the demo's "Modifier ce vélo" and by the tree's "Générer mon
vélo", and another page of the same browser can still be showing the first.
Until 2026-10-12 the guest repo wrote whichever bike it found there: 45 typed
for bike A's front tyre and not left was written to bike B's when the
`storage` event took A's form off the screen, with nothing said (measured in
jsdom through the real `BikeWorkspace`, and in Chromium 153 with two pages of
one context driven at once, the new bike stored each of the two ways;
`.debug/017` §5.8, "Fourth review"). That is fixed: a guest repo is built for
ONE bike (`localBikeRepo(bikeId)`, `lib/bike/repo.ts`), a write made for a
bike that is no longer the one in the slot is refused and writes nothing —
the part form's and the fit form's alike — and the part form says which part
and which field was not saved. The text itself is lost, as it was before the
form committed on removal: the bike it was typed for is no longer in storage.

What that repair did NOT touch, because none of it goes through the repo:

- **The guest import clears the slot by its key, not by the bike it sent.**
  `/import` collects the guest bike, waits for the server, and then removes
  `va:bike:local` (`settleGuestImport` → `clearGuestKeys`,
  `lib/guest/schema.ts`). A NEW guest bike stored by another page while that
  request is in flight is removed with it, and was never sent (measured on
  2026-10-12 in jsdom, by a probe outside the repository: the real
  `GuestImport`, its action a stand-in that stores a new bike before it
  answers — afterwards the slot is empty; not looked for in a browser). The
  window is one server round trip of a page that imports by itself on
  arrival.
- **The fit page keeps the first bike's cards.** They are drawn by the server
  from `?spec=`, which names no bike. Once the page has been told of the new
  bike, each form's inputs are re-seeded from it and a save is the new
  bike's (`components/bike/MeasurementForm.test.tsx` pins both halves, in
  jsdom); the cards around them are still the ones the first bike's spec
  asked for (read in `app/[locale]/velo/[id]/reglages/page.tsx`). Measured
  since, on 2026-10-12, by the verifier of the fourth repair, with probes
  outside the repository and on the repaired tree — so a card drawn for
  bike A saves into bike B, with "Enregistré" and nothing else said:
  - in jsdom, the form alone: the sag card of a full-suspension e-MTB on
    screen, a rigid gravel bike stored by another page and the `storage`
    event dispatched, 25 typed in that card and saved — the card was still
    there, the status read "Enregistré", and the NEW bike's `fit` held
    `{ "sagPercent": 25 }`: a bike with no suspension, whose own fit page
    draws no sag card to show it. The same probe over the form and the repo
    of `258de61` printed the same line: the repair did not change this.
  - in Chromium, on the site built with the test hooks, `desktop-chromium`
    and `mobile-chromium` (one run each): the fit page opened for bike A by
    its `?spec=`, another page of the same context taking the demo's copy —
    the inseam field emptied, and 80 saved there answered "Enregistré" with
    the new bike's `fit` at `{ "inseamCm": 80, "saddleHeightMm": 706 }`.
  - the other half of the rule held in the same probes (jsdom): what was
    typed for A BEFORE the page was told is dropped by the re-seed, with
    nothing said, and never written to B; a save pressed before the page is
    told is refused, "Introuvable.".

  Nothing in those steps needs a field to keep the focus — the save is a
  button pressed after the page was told — so, unlike the part form's case,
  one person with two tabs gets there (reasoned from the probes' steps: they
  drove two pages of one context, not a person's tab switch).

- **The guest checkup and build list are keyed by the slot too**
  (`va:checkup:local`, `va:buildlist:local`), and neither control that stores
  a new guest bike touches them (read in `components/decision-tree/Summary.tsx`
  and `forkDemoToLocal`). What the new bike's pages then show of them was
  not looked at.

Not measured anywhere: WebKit and Firefox. And a person's tab switch is not
the case that was fixed: it takes the focus out of the field, which commits
the text to the bike that is still there (measured by the fourth review's
verifier in the full Chromium build, on the unfixed tree; not run again).

_Why deferred_ (the fourth review of the part-form fix, 2026-10-12): the
finding was a write through the guest repo, and the repo is bound. The three
above are other writers and other keys of the same slot — the import's
contract, a page's design, the checkup's storage — and each is a change to
something that review did not look at. **Awaiting the maintainer's ruling.**

_To pick up_: for the import, clear `va:bike:local` only while
`peekLocalBikeId()` (`lib/bike/local-bike.ts`) still answers the `localId`
that was collected, and tell the visitor a bike is still in this browser;
`tests/ui/guest-import.test.tsx` has the harness, with an action that can
store a bike before it answers. For the fit page, decide whether it should
notice — the stored bike's `encodeSpec(answers)` against the URL's `?spec=`
is the comparison at hand. For the checkup and the list, first look at what
a replaced bike's pages show.

#### A yes/no question of the build list is a free-text box

The list's "Préciser la pièce" form (`components/build-list/RefinementForm.tsx`)
draws a `<select>` for an attribute with a closed set of values and a text or
number input for everything else — the yes/no attributes included. There are
SIX of them, on nine parts (measured on 2026-10-13 by a probe outside the
repository: `shopQuestionsFor` over every part of the catalogue, for each of
the seven presets, keeping the questions with no options that are not
numbers): "Chaîne pour VAE" (`e-rated`, the chain), "Embrayage" (`clutch`,
the rear derailleur), "Levier intégré" (`integrated`, the two brake levers),
"Blocage" (`lockout`, the fork and the rear shock), "Serrage rapide"
(`quick-release`, the seat clamp) and "Compatible tubeless"
(`tubeless-ready`, the two wheels). The same probe found the two genuine text
attributes, `pad-model` and `hanger-model`, and no other. `/acheter` asks the
same attributes with a two-choice `<select>`
(`components/shop/PartQuestions.tsx`: read), and the part panel shows Oui/Non
(`.debug/017` §5.6, O5). What is typed in the box is kept on the line as
typed, and only the two strings `true` and `false` are read back as an answer
(`coerceAttributeValue`, `lib/shop/questions.ts`: read, not measured): "oui"
changes nothing in the search.

_Why deferred_ (ruled with the fix of `.debug/017` §5.9, 2026-10-13): that fix
was about what one over-long answer cost — the whole list — and gave these
boxes the same 64-character stop as the genuine text fields. Which control a
yes/no question gets is a change to the form, not a repair of that.

_To pick up_: draw them as `/acheter` does — the choice list `PartQuestions`
builds for `kind === "boolean"` — storing `true` / `false`; decide what
becomes of a line that already holds "oui" (today it is shown back in the
box; in a `<select>` it would match no option). One test names such boxes
among the text fields and changes with it: `BuildList.long-answer.test.tsx`,
for two of the six — the chain's `e-rated` and the rear derailleur's `clutch`
(its first case). `RefinementForm.test.tsx` names none of them (an earlier
version of this entry said it did).

#### An answer the list page drops is dropped without a word

Since 2026-10-13 a stored refinement is read entry by entry
(`lib/shop/refinement.ts`): an answer longer than 64 characters is not shown,
not sent by the guest import, and not written back by the next edit or the
next checkup. That is what un-hid the lists a pasted product title had
hidden on production (`.debug/017` §5.9). The visitor who pasted it finds
the field empty, and nothing says an answer was there: not on the list page,
not on `/import`. The answer was shown nowhere before either — the whole
list was gone.

_Why deferred_ (2026-10-13): the ruling was a filter, on read and at the
import, and a limit on the inputs. A notice is a new sentence in two
languages and a decision about where it lives; the inputs can no longer
produce such an answer, so it would only ever speak to browsers affected
before the fix.

_To pick up_: if wanted, have `parseBuildList` say that it dropped something
(it returns the lines only) and show one line under the card; decide first
whether it should outlive the next edit, which removes the bytes it is about.

#### An edit on a guest's list forgets which checkup wrote it

The wizard writes `va:buildlist:<ref>` with the id of the checkup that wrote
it (`writeGuestBuildList`, `lib/checkup/storage.ts`); the list page writes it
back as `{ version, items, updatedAt }`, without that id (`writeBuildList`,
`components/build-list/BuildList.tsx` — measured in jsdom on 2026-10-13: the
stored value's keys after one edit; `.debug/017` §5.9). The merge reads a
missing id as "a LATER checkup's list" (read in `storage.ts` and
`components/checkup/Wizard.tsx`), so after any tick or answer on the list a
re-run of the SAME checkup keeps the lines it would otherwise prune — the
line whose verdict the visitor has just withdrawn stays. Not measured end to
end. An account's list is not concerned: `BuildList.checkupId` is a column
the list's actions do not touch.

_Why deferred_ (2026-10-13): seen while fixing something else, in a write the
fix did not change.

_To pick up_: have the page's writer carry the envelope's `checkupId` through
(one reader, `readGuestBuildList`, already parses it), and a case in
`lib/checkup/build-list.test.ts` or the wizard's tests for a re-run after an
edit. The two envelopes are one shape written by two functions: that is the
thing to remove.

#### A stored list line can still sink a guest's import, by a field only the checkup writes

The guest import's collector holds two fields of a stored line to the
contract, since 2026-10-13: its `refinement`, entry by entry
(`collectRefinement`, `lib/guest/schema.ts`), and its `chosenProduct`
(`collectChosenProduct` — added in the review of the first, where a stored
product that was not five strings was measured to send the bike with NO list
and then clear the list's key, and one whose link breaks §4.4 to be refused
whole). The REST of the line — `partId`, `action`, `reasonKey`, `guideSlug`,
`done`, `sortOrder` — it forwards as stored, and its guard on the stored list
still types them.

Measured on 2026-10-13, after that repair, by a probe outside the repository
(jsdom: the wizard's three lines, ONE field of the rear pads' line broken by
the list page's own write; then the page's parser, the collector, the
contract, and `settleGuestImport` on a successful answer):

| The rear pads' line holds…                                                      | the list page shows  | the payload carries | the contract |
| ------------------------------------------------------------------------------- | -------------------- | ------------------- | ------------ |
| `sortOrder: -1`, or `10001`                                                     | 3 lines              | 3 lines             | REFUSES it   |
| `reasonKey: "Pad Worn"`                                                         | 3 lines              | 3 lines             | REFUSES it   |
| `guideSlug: "Not A Slug"`                                                       | 3 lines              | 3 lines             | REFUSES it   |
| `partId: "Brake Pads"`                                                          | 2 lines              | 3 lines             | REFUSES it   |
| a `reasonKey` of 81 characters                                                  | nothing: empty state | 3 lines             | REFUSES it   |
| `done: null` or `"yes"`, `guideSlug: null`, `sortOrder: null`, `action: "burn"` | nothing: empty state | no list at all      | accepts      |
| `doneReason: "because"`                                                         | nothing: empty state | 3 lines (no reason) | accepts      |
| `partId: "sprocket"` (no such part)                                             | 2 lines              | 3 lines             | accepts      |

A refused payload is the refinement's old failure again: `VALIDATION`, every
key kept, the same bytes on retry — a guest bike that cannot be imported. In
the "no list at all" row the bike is imported without its list and the list's
key is among those the browser then forgets; the page was showing nothing of
that list either, so no line a screen showed is lost there. In the first four
rows the visitor is looking at lines the import cannot carry; in the fifth the
page shows nothing and the bike cannot be imported all the same.

_Why deferred_ (2026-10-13): none of those fields is written by a control of
the site, or given its form by a visitor: they are the checkup's own output,
plus the tick's boolean. What holds that the application never writes one the
contract refuses is a test, since the same review: the FULL plan of each of
the seven presets, every question answered "ça ne marche pas", stored by the
wizard's own writers, collected, and accepted whole by the contract
(`lib/guest/schema.test.ts`, "every line the wizard can derive is a line the
contract takes" — 43 to 48 lines a preset, against the contract's 50). These
need DevTools, or a later release that changes a writer without the contract.
An earlier version of this entry cited `BuildList.long-answer.test.tsx` for
that: it holds the same derivations against the list PAGE's parser, and says
nothing of the import.

_To pick up_: project each stored line through the contract's own item schema
and drop what fails — the line, not the payload — the way a checkup the
contract would refuse is reported `unreadable` instead of sinking the bike;
say so to the visitor; and decide whether the list's key may then be cleared.
That last decision is why this is not done: a line dropped by the collector
and a key then cleared is a line gone, where today it is a bike that waits.

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

_To pick up_: two options were written here. **The first is done,
2026-10-19**: `.github/workflows/advisories.yml` runs `audit` and `trivy` on
`main` every day and opens one issue on the first red run, commenting on it on
every later one and never closing it — the maintainer's ruling after
`.debug/017` §2.7, where `main` was red by its own rule for 41 hours with
nothing on GitHub showing it. Merged on 2026-10-23 (#31); its first run, a
dispatch that day, was green and wrote no issue. It does not stop
the red `main` this entry is about — an advisory still lands between two runs,
and still after a green pull request — it bounds how long nobody knows. The
second is still open: re-running the `audit` job once before reading it on a
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
