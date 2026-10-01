# Audit allowlist

Every advisory id in the `allowlist` array of [`audit-ci.json`](./audit-ci.json) is
justified below. **Re-evaluate quarterly, or whenever the upstream fix lands.**

Rule of thumb used here: an advisory is allow-listed only when the vulnerable
package is (a) a transitive dependency of a _developer_ tool, (b) never bundled
into the deployed application, and (c) only ever fed inputs that we control
(our own repository files, our own Lighthouse runs). Anything reachable from a
request handler is fixed, never allow-listed.

**An allow-list entry is the last resort, not the first move.** A transitive
dependency whose patched version is compatible with what its parent declares is
pinned in the `overrides` block of `package.json` and its id is _removed_ from
the array above, so a regression fails the `audit` job instead of passing it
silently.

Baseline re-recorded on 2026-10-01 with Node 24.16.0 / npm 11.13.0, on a tree
holding Next 16.3.6 and the five overrides below (see “That rule was tested on
this branch”). On it `npm audit` finds **11** advisories — 0 critical, 9 high,
2 moderate — and every id it names is one of the five in the array. Two more
were live earlier the same day and are now fixed rather than tolerated; see
“Advisories that arrived while the branch was open” below.

## Pinned through `overrides` instead of allow-listed

These five are **fixed**, not tolerated. Each parent's declared range excludes
the patched version, so npm needs the override to reach it; each was proved by
a green `bash scripts/ci.sh` and a green `npm run build` on the resolved tree.

| Override            | Resolves to | Replaces       | Fixes                                    | Reached through                                                            |
| ------------------- | ----------- | -------------- | ---------------------------------------- | -------------------------------------------------------------------------- |
| `toml: ^4.2.0`      | 4.3.0       | 3.0.0          | GHSA-82x6-q7mm-w9cf, GHSA-v5mp-jgw5-2x6j | `@content-collections/mdx > mdx-bundler > remark-mdx-frontmatter > toml`   |
| `uuid: ^11.1.1`     | 11.1.1      | 9.0.1 / 8.3.2  | GHSA-w5hq-g745-h8pq                      | `@content-collections/mdx > mdx-bundler`, `@lhci/cli`                      |
| `tmp: ^0.2.7`       | 0.2.7       | 0.1.0 / 0.0.33 | GHSA-ph9p-34f9-6g65, GHSA-52f5-9888-hmc6 | `@lhci/cli`, `@lhci/cli > inquirer > external-editor`                      |
| `mysql2: 3.23.1`    | 3.23.1      | 3.15.3         | GHSA-3f6p-5ww8-9rcr, GHSA-rgwj-5xj2-c3m3 | `prisma > mysql2` (optional MySQL driver; this project is PostgreSQL only) |
| `basic-ftp: ^6.2.1` | 6.2.1       | 5.3.1          | GHSA-c475-qrg2-pj4r                      | `@lhci/cli > proxy-agent > pac-proxy-agent > get-uri > basic-ftp`          |

Compatibility notes, because an override is a version its parent never tested:

- `toml@4` is the one that touches the build. `remark-mdx-frontmatter@4.0.0`
  does `import { parse as parseToml } from 'toml'`, and 4.x still exports a
  named `parse` readable from ESM and from `require` (it drops `stringify`,
  which nothing in this tree calls). `npm run build` and
  `npm run content:check -- --strict` compile the whole `content/` corpus
  through that chain.
- `uuid@11` keeps `v4` on both the CJS and the ESM entry point; `mdx-bundler`
  uses `require("uuid").v4()` for its temporary entry file and `@lhci/cli` for
  its run ids.
- `tmp@0.2.x` keeps `fileSync`/`dirSync`. The floor is **0.2.7**, not 0.2.6:
  0.2.6 sanitises `prefix`/`postfix`, and GHSA-7c78-jf6q-g5cm is the
  type-confusion bypass of that very sanitiser, patched in 0.2.7. A range whose
  floor is still vulnerable to an advisory this table claims it fixes is a
  wrong document of record, even when the lock resolves above it. The three call sites in this
  tree are `@lhci/cli/src/open/open.js:47` (`tmp.fileSync({postfix: '.html'})`)
  and `external-editor/main/index.js:131` (`tmp.tmpNameSync(...)`), both still
  on 0.2.7's surface; `@lhci/cli/src/collect/node-runner.js:65` is the
  `uuid.v4()` above.
- `mysql2` is never loaded — the override only stops the advisory tracking a
  version we do not run. It is pinned **exactly** at the lowest release that
  clears both ids: GHSA-3f6p-5ww8-9rcr is patched in 3.22.0 and
  GHSA-rgwj-5xj2-c3m3 in 3.23.1, so 3.23.1 is the floor, and it is 74 days old,
  which is the rule below rather than an exception to it. A `^3.22.0` range
  floated to 3.24.5, published eighteen hours earlier — the newest release, not
  the lowest, with its own tree reshaping to review: `sqlstring` out for a
  first-time transitive `sql-escaper`, `denque`, `seq-queue` and `os-tmpdir`
  gone. It is still the largest jump here (3.15.3 → 3.23.1), and
  `sql-escaper@1.5.2` arrives with it: `mysqljs/sql-escaper`, same maintainer as
  `mysql2` and `sqlstring`, MIT, with a provenance attestation. Nothing imports
  `mysql2` in this tree, so none of it is loaded, but the new package is worth
  naming rather than discovering later.
- `basic-ftp@6` is a major its parent never declared: `get-uri@6.0.5` asks for
  `^5.0.2`, and so does the newest `get-uri` (8.0.1 — `^5.3.1`), so no upstream
  has adopted 6.x yet. It is also the only one of the five whose behaviour was
  checked directly rather than read. `get-uri/dist/ftp.js` is the single
  consumer and touches six things: `new Client()`, `access`, `lastMod`,
  `list()` → `entry.name` / `entry.modifiedAt`, `downloadTo` and `close`, plus
  `err.code === 550`. All six exist on 6.2.1, the packaging is unchanged (CJS,
  `main: dist/index`, `engines.node >=10`), and `parseList` — the function the
  advisory is about — returns **byte-identical** output on 5.3.1 and 6.2.1 for
  both a Unix `LIST` and an `MLSD` listing, down to `modifiedAt` being
  `undefined` on the Unix form. `get-uri/dist/index.js` requires `./ftp`
  eagerly, so load order matters and `require('proxy-agent')` was run against
  the resolved tree. What would change the answer: a `get-uri` that declares
  `^6` (then the override can go), or a `basic-ftp@7`.
- **Not proved by a local run:** `npm run lhci` was not executed for these, and
  it is the one gate that exercises `uuid` and `tmp`. The three call sites above
  were read against the resolved tree and the APIs they use still exist, so the
  residual risk is an LHCI runtime path none of them touches. The `lighthouse`
  job on the PR settles it.

Seven more advisories across four packages (`brace-expansion` ×3,
`ip-address` ×2, `fast-uri`, `serialize-javascript`) appeared in dev-tool chains (`eslint > minimatch`,
`shadcn`, `ajv`, `@content-collections/core`) whose declared ranges already
admit the patched releases: those needed no override, only a lockfile bump
(`npm update brace-expansion ip-address fast-uri`, then
`npm update serialize-javascript`).

## Prisma CLI chain — dev-only, never bundled

The `prisma` CLI (migrations, `generate`, `db seed`) drags in a generic driver
and config layer. It is a `devDependency`, but npm marks its subtree
`devOptional` in the lockfile rather than plain `dev` — `prisma`,
`@prisma/config`, `deepmerge-ts` and `mysql2` all carry `"devOptional": true`
and no `dev` key — because the production `@prisma/client` declares an optional
peer on `prisma`. That peer edge is real: `npm ls --omit=dev --omit=optional`
still prints the chain. **So the scope flag is not the argument here; the
bundle is.** The
application itself talks to Postgres through `@prisma/adapter-pg` + `pg`, and
`serverExternalPackages` keeps the CLI out of every server bundle.

- **GHSA-ggr8-5vv4-36mx** — `deepmerge-ts` stack exhaustion on recursive object
  graphs. Path: `prisma > @prisma/config > deepmerge-ts@7.1.5`. The only object
  graph merged is our own `prisma.config.ts`. No attacker input. The fix is
  `deepmerge-ts@8`, a major that `@prisma/config@7.10.0` does not accept;
  overriding it would hand the Prisma CLI an untested major to run migrations
  with. It waits for a Prisma release. (GitHub's Dependabot auto-dismissed this
  one as a dev-scope advisory; `audit-ci` still sees it, which is why the id is
  in the array.)

## Lighthouse CI chain — dev/CI-only, runs against our own URLs

`@lhci/cli` pulls in Puppeteer, Express and an interactive prompt library. It
runs only in the `lighthouse` CI job and in `npm run lhci`, against URLs that
this repository declares in `lighthouserc.cjs`.

- **GHSA-jmr9-qjv8-65gv** and **GHSA-7pqw-9j4j-h8q3** — `extract-zip` symlink
  path traversal / arbitrary file write. Path: `@lhci/cli > lighthouse >
puppeteer-core > @puppeteer/browsers > extract-zip@2.0.1`. **There is no
  patched version** — the advisories cover every release, so there is nothing
  to override. The only archive extracted is the Chromium build downloaded from
  Google's own CDN, and `scripts/ci/lighthouse.sh` points `CHROME_PATH` at the
  browser already present in the Playwright container, so no download happens
  at all. What would change the answer: an `extract-zip` release above 2.0.1,
  or a Puppeteer that no longer needs it.
- **GHSA-x5fp-wj9c-mxmx** and **GHSA-4mjr-xmp4-gh2g** — `qs` array-limit bypass
  and `isBuffer` DoS. Paths: `@lhci/cli > express@4.22.2 > qs@6.15.3` and
  `shadcn > @modelcontextprotocol/sdk > express@5.2.1 > qs@6.15.3`. Neither
  Express is ever reachable: the first is the ephemeral LHCI report server bound
  to localhost during a CI job, the second only starts under `shadcn mcp`, which
  nothing in this repository runs. `express@4.22.2` declares `qs: "~6.15.1"`,
  which stops one minor short of the `6.16.0` fix; `express@5.2.1` declares
  `^6.14.0` and would take it, but both hoist to the one top-level `qs@6.15.3`,
  so an unscoped override hands LHCI's Express a minor it never shipped with.
  A **scoped** override (`"express": { "qs": "^6.16.0" }`) is mechanically
  available — npm does nest a second copy when a range demands one, and this
  very tree proves it: `node_modules/body-parser@1.20.8` declares `qs: "~6.16.0"`
  and got `node_modules/body-parser/node_modules/qs@6.16.0` beside the
  top-level 6.15.3. It is declined, not impossible: it would still be an
  untested minor under two servers that never listen, and the gate that would
  exercise it is `lighthouse`, which does not run in `npm run ci:local`. What
  would change the answer: an `express@4` release whose range reaches
  `qs@6.16`, or a `qs` in something that handles a real request.

## What is **not** allow-listed

Anything in `dependencies` that ships to the server or the browser: `next`,
`react`, `react-dom`, `next-auth`, `@auth/prisma-adapter`, `@prisma/client`,
`@prisma/adapter-pg`, `pg`, `bcryptjs`, `zod`, `three` and the React Three
Fiber stack. An advisory on any of those blocks the pipeline until it is fixed.

### That rule was tested on this branch: `next` (2026-09-30)

**GHSA-vcvr-r3jv-pc5j** — "Next.js: Remote Code Execution in `next/og`
ImageResponse", **critical**, range `>=16.2.0 <16.3.6`. It went live against
the 16.3.4 pin after the overrides above were recorded, and it is not
theoretical here: `app/[locale]/opengraph-image.tsx` and
`app/[locale]/guides/[slug]/opengraph-image.tsx` both
`import { ImageResponse } from "next/og"` and construct one.

`next` is a direct `dependencies` entry, so neither escape hatch applied — an
`overrides` entry is for a transitive whose parent pins it too low, and the
section above forbids allow-listing this package by name. The pin moved
instead: **`next` and `eslint-config-next` 16.3.4 → 16.3.6**, together,
because the second must match the first exactly. `npm audit` reports the bump
`isSemVerMajor: false`, and the resolved change is confined to the Next family
— `next`, `eslint-config-next`, `@next/env`, `@next/eslint-plugin-next` and
the eight `@next/swc-*` platform binaries. Nothing else in the lockfile moved.

### Why 16.3.6 and not the top of the line

The first draft of this branch took **16.3.8**, on the reasoning that the top
of the 16.3 line is the one that will not need re-bumping next week. That was
wrong against this repository's own written policy, and the correction is the
rule now stated in `CLAUDE.md`: **take the lowest release that clears the
advisory.**

`renovate.json` holds every update for **7 days** — its own words: “a freshly
published version can be a compromised one. Hold every update for 7 days so a
hijacked release is yanked before Renovate proposes it.” The hold is waived
for `vulnerabilityAlerts` (`minimumReleaseAge: null`) for one purpose: a
security response must not be _delayed_ by it. Here nothing was delayed.
Measured against the advisory's own publication at 2026-09-30T14:48:30Z
(`gh api /advisories/GHSA-vcvr-r3jv-pc5j`), `npm view next time` gives:

| Release    | Published            | Age at the fix | Clears the advisory | Clears the 7-day hold |
| ---------- | -------------------- | -------------- | ------------------- | --------------------- |
| **16.3.6** | 2026-09-22T16:19:00Z | **8 days**     | yes (first patched) | **yes**               |
| 16.3.7     | 2026-09-29T09:04:19Z | 1 day          | yes                 | no                    |
| 16.3.8     | 2026-09-30T16:07:21Z | **1 h 41 min** | yes                 | no                    |

16.3.6 is the first patched version named by the advisory and it satisfies
both constraints at once, so the waiver was never needed. 16.3.8 was published
**79 minutes after the advisory went public** — precisely the shape the hold
exists to catch — and buys nothing: no advisory in this tree names a version
above 16.3.6, and 16.3.7/16.3.8 fix nothing else this repository uses. `next`
is the largest single body of code shipped to production here, so “two extra
patch releases of unreviewed change” is not a rounding error. The pin is
16.3.6 and Renovate will propose 16.3.7+ on the normal schedule, once they
have aged through the hold like everything else.

If a future advisory forces a release that is inside the hold window, that is
a real decision and it belongs here in writing: name the advisory, the age of
the release taken, and why no aged release clears it.

At 16.3.6, `npm audit` reports **0 critical**, and the five ids still found are
exactly the five in the array — no allow-list entry is dead.

## Advisories that arrived while the branch was open

The advisory feed is fetched live, so the `audit` gate is a moving target: an
id that did not exist when a run went green can turn the next one red with no
commit in between. Three did so on this branch, in two days. None was among the
eight Dependabot alerts the branch set out to triage, and each is recorded here
so the next person can tell "we decided this" from "we never saw it".

| Published (UTC)  | Advisory            | Severity | Package                | Answer                                   |
| ---------------- | ------------------- | -------- | ---------------------- | ---------------------------------------- |
| 2026-09-30 14:48 | GHSA-vcvr-r3jv-pc5j | critical | `next` (direct)        | pin 16.3.4 → 16.3.6 (two sections above) |
| 2026-09-30 15:40 | GHSA-gfhx-hw2g-v5hg | low      | `serialize-javascript` | `npm update` — in range, no override     |
| 2026-10-01 14:42 | GHSA-c475-qrg2-pj4r | high     | `basic-ftp`            | `overrides` 5.3.1 → 6.2.1                |

**GHSA-c475-qrg2-pj4r** — quadratic-time CPU denial of service in
`Client.list()`'s Unix directory-listing parser (`RE_LINE` backtracking).
Reached three ways, all dev-only: `@lhci/cli > proxy-agent > pac-proxy-agent >
get-uri > basic-ftp`, and twice more through `lighthouse > puppeteer-core >
@puppeteer/browsers > proxy-agent > …`. It would have been defensible to
allow-list: the only caller is `get-uri`'s `ftp:` handler, which
`pac-proxy-agent` invokes solely to fetch a PAC file from an `ftp://` URL, and
nothing here configures a proxy at all — `lighthouserc.cjs` points at
localhost. It was **not** allow-listed, for three reasons. The patch is a real
release (6.2.1), it is **35 days old** so it clears the 7-day hold on its own,
and the vulnerable function's output is provably unchanged (the compatibility
note above). An allow-list entry is permanent and needs re-reading every
quarter; a patched leaf dependency needs nothing. The rule at the top of this
file — last resort, not first move — decides it.

**GHSA-gfhx-hw2g-v5hg** — XSS via an unescaped `</script>` in a serialized
function body, in `@content-collections/core > serialize-javascript@7.1.1`.
Low, and `audit-ci.json` fails at `moderate`, so this one never blocked the
gate. It was still fixed rather than left: `@content-collections/core@0.15.2`
declares `^7.0.5`, which already admits the patched **7.1.2** (published
2026-09-23, 8 days old), so a plain `npm update serialize-javascript` reached
it — no override, no allow-list entry, one line of lockfile. A fix that costs
nothing is not worth a justification paragraph explaining why it was skipped.

## Removed from the array (2026-09-30)

Seven ids left the allowlist because the vulnerable version is no longer in the
tree — see the `overrides` table above. If any of them comes back, the `audit`
job goes red, which is the point: GHSA-82x6-q7mm-w9cf, GHSA-v5mp-jgw5-2x6j
(`toml`), GHSA-w5hq-g745-h8pq (`uuid`), GHSA-ph9p-34f9-6g65,
GHSA-52f5-9888-hmc6 (`tmp`), GHSA-3f6p-5ww8-9rcr, GHSA-rgwj-5xj2-c3m3
(`mysql2`).

## Alerts dismissed on GitHub, and why (the maintainer runs these)

`audit-ci.json` governs the `audit` gate. GitHub's own alert lists are a second
record, and this section is the first one's written reason for every alert it
leaves open there: a dismissal changes the repository's security record, so it
is the maintainer's to make, never an agent's. The commands are exact — the
comment is what a reader finds months later next to a closed alert.

### CodeQL — four alerts stay open after this branch fixes eight

| #   | Rule                                       | Where                                       | Reason           |
| --- | ------------------------------------------ | ------------------------------------------- | ---------------- |
| 10  | `js/user-controlled-bypass`                | `app/api/session-expired/route.ts:50`       | `false positive` |
| 9   | `js/incomplete-sanitization`               | `tests/security/session-rewrite.test.ts:86` | `used in tests`  |
| 12  | `js/incomplete-url-substring-sanitization` | `components/shop/OutboundLink.test.tsx:163` | `used in tests`  |
| 3   | `js/identity-replacement`                  | `tests/e2e/auth-login.spec.ts:132`          | `used in tests`  |

```bash
gh api -X PATCH repos/lienardale/velo-atelier/code-scanning/alerts/10 -f state=dismissed \
  -f dismissed_reason='false positive' \
  -f dismissed_comment='loginUrl() only builds the sign-in path; CodeQL reads "login" as an auth check. The user value only decides whether ?callbackUrl is added, through safeCallbackUrl. The cookies are cleared only when server-side auth() rejects the visitors own session.'

gh api -X PATCH repos/lienardale/velo-atelier/code-scanning/alerts/9 -f state=dismissed \
  -f dismissed_reason='used in tests' \
  -f dismissed_comment='Test fixture, not a sanitiser: it percent-encodes one "." of a freshly minted token to forge a cookie header that differs from the decoded store value. That one encoded character IS the attack under test.'

gh api -X PATCH repos/lienardale/velo-atelier/code-scanning/alerts/12 -f state=dismissed \
  -f dismissed_reason='used in tests' \
  -f dismissed_comment='Test code, not a URL check: it narrows the anchors our own components rendered to the Rose FR ones, then asserts one equals outboundUrl(...) exactly. No navigation or trust decision depends on this startsWith.'

gh api -X PATCH repos/lienardale/velo-atelier/code-scanning/alerts/3 -f state=dismissed \
  -f dismissed_reason='used in tests' \
  -f dismissed_comment='Test code: builds the expected-URL regex for a Playwright toHaveURL assertion. The replace(/%/g, "%") is a no-op, not an escaping step; the encoded path (e.g. %2Ffr%2Fmes-velos) holds no regex metacharacter. Deleting the no-op would close this in code instead.'
```

Alert 3 is the one with a choice: that `replace` really is dead code, so removing
the line closes the alert without a dismissal. The ruling for this wave kept it
as a dismissal; either answer is defensible and this note is here so the next
reader knows it was a decision.

### Dependabot — the two `extract-zip` alerts have no patched version

Alerts **4** and **12** (`CVE-2026-56876`, `CVE-2026-19693`, both high) are
`extract-zip`, reached only through `@lhci/cli > puppeteer-core`. There is no
fixed release to move to (`first_patched_version: null` on both). It unpacks a
Chrome download on a CI runner and on a maintainer's machine, never a visitor's
input, and nothing in the deployed application imports it. The other six alerts
(`toml` ×2, `uuid`, `mysql2`, `tmp` ×2) close by themselves once the `overrides`
in this branch reach `main`.

```bash
gh api -X PATCH repos/lienardale/velo-atelier/dependabot/alerts/4 -f state=dismissed \
  -f dismissed_reason=tolerable_risk \
  -f dismissed_comment='extract-zip has no patched release. Dev-only: @lhci/cli > puppeteer-core unpacks a Chrome download on CI and on a maintainer machine, never visitor input, and nothing in the deployed app imports it. Revisit when a fix ships: audit-ci-allowlist.md.'

gh api -X PATCH repos/lienardale/velo-atelier/dependabot/alerts/12 -f state=dismissed \
  -f dismissed_reason=tolerable_risk \
  -f dismissed_comment='extract-zip has no patched release. Dev-only: @lhci/cli > puppeteer-core unpacks a Chrome download on CI and on a maintainer machine, never visitor input, and nothing in the deployed app imports it. Revisit when a fix ships: audit-ci-allowlist.md.'
```
