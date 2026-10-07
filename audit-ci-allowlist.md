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

Re-recorded on 2026-10-06, same Node and npm, after the four advisories under
“The four advisories of 2026-10-05” were answered and with the `braces` entry
(#13) in the array: `npm audit` finds **19** vulnerable
packages — 0 critical, 17 high, 2 moderate — under **six** advisory ids, and the
six are exactly the array. The count rose from 11 because `braces` marks the
whole glob chain above it; the number of ids is the figure to watch.

## Pinned through `overrides` instead of allow-listed

These seven are **fixed**, not tolerated. For the first five the parent's
declared range excludes the patched version, so npm needs the override to reach
it. The last two are different shapes, each with its own note below: `argparse`
removes a package that has no patched version at all, and
`@modelcontextprotocol/sdk` pins a version its parent's range already admits,
because the newest release that range admits was one day old. Each was proved by a green
`bash scripts/ci.sh` and a green `npm run build` on the resolved tree.

| Override                            | Resolves to | Replaces       | Fixes                                                               | Reached through                                                                                                                                   |
| ----------------------------------- | ----------- | -------------- | ------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| `toml: ^4.2.0`                      | 4.3.0       | 3.0.0          | GHSA-82x6-q7mm-w9cf, GHSA-v5mp-jgw5-2x6j                            | `@content-collections/mdx > mdx-bundler > remark-mdx-frontmatter > toml`                                                                          |
| `uuid: ^11.1.1`                     | 11.1.1      | 9.0.1 / 8.3.2  | GHSA-w5hq-g745-h8pq                                                 | `@content-collections/mdx > mdx-bundler`, `@lhci/cli`                                                                                             |
| `tmp: ^0.2.7`                       | 0.2.7       | 0.1.0 / 0.0.33 | GHSA-ph9p-34f9-6g65, GHSA-52f5-9888-hmc6                            | `@lhci/cli`, `@lhci/cli > inquirer > external-editor`                                                                                             |
| `mysql2: 3.23.1`                    | 3.23.1      | 3.15.3         | GHSA-3f6p-5ww8-9rcr, GHSA-rgwj-5xj2-c3m3                            | `prisma > mysql2` (optional MySQL driver; this project is PostgreSQL only)                                                                        |
| `basic-ftp: ^6.2.1`                 | 6.2.1       | 5.3.1          | GHSA-c475-qrg2-pj4r                                                 | `@lhci/cli > proxy-agent > pac-proxy-agent > get-uri > basic-ftp`                                                                                 |
| `js-yaml@^3 > argparse: ^2.0.1`     | 2.0.1       | 1.0.10         | GHSA-hp3w-g68c-fv3c (`sprintf-js@1.0.3`, which leaves the lockfile) | `gray-matter > js-yaml@3` (under `@content-collections/core` and `@content-collections/mdx > mdx-bundler`), `@lhci/cli > @lhci/utils > js-yaml@3` |
| `@modelcontextprotocol/sdk: 1.31.0` | 1.31.0      | 1.30.0         | GHSA-6qxp-vccf-f47h                                                 | `shadcn > @modelcontextprotocol/sdk`                                                                                                              |

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
  has adopted 6.x yet. It was also the only one of the first five whose
  behaviour was checked directly rather than read. `get-uri/dist/ftp.js` is the single
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
- `argparse@2` under `js-yaml@3` is the one override here where **the
  vulnerable package is not the one overridden**, and the one that is
  **scoped**. `sprintf-js` has no patched release — GHSA-hp3w-g68c-fv3c covers
  `<= 1.1.3` and 1.1.3 is the latest — so there is nothing to pin it to. What
  can be removed is its only parent in the lockfile: `argparse@1.0.10` is the
  single package that declares `sprintf-js` (`~1.0.2`), `argparse@2` has no
  dependencies at all, and `js-yaml@3.15.2`, the newest 3.x, still asks for
  `argparse: ^1.0.7`. The override swaps that edge. No new version enters
  the tree: `argparse@2.0.1` was already installed twice, nested under the two
  `js-yaml@4.3.2` copies (`@eslint/eslintrc`, `cosmiconfig`), and the three now
  share one top-level copy with the same integrity hash — 1901 lockfile entries
  become 1898. One flag does change on the surviving entry: it is licensed
  `Python-2.0` (1.0.10 was `MIT`) and carries no `dev` flag, where both copies
  it replaces were `dev: true`. No gate here reads licences, and no trace names
  the package. **2.0.1 and not 2.0.0**, although 2.0.0 is the lowest release
  that drops `sprintf-js`: both `js-yaml@4.3.2` copies declare `^2.0.1`, so
  2.0.0 would add a third `argparse` version instead of reusing the one
  installed. It is six years old (2020-08-28), so the 7-day hold is not in
  play. `^2.0.1` cannot reach the 3.0.x line through npm, but **Renovate reads
  an override as a dependency** and would propose `^3.0.0` — its dashboard
  already proposes `toml` 5 and `uuid` 14 for the entries above — so
  `renovate.json` holds this one below 3: a v3 override would put a second
  `argparse` version back beside the 2.0.1 that `js-yaml@4` needs.
  **It is not the only edge npm rewrites, though.** A ranged key with no `.`
  entry also replaces the range of every edge _to_ `js-yaml` that intersects
  `^3` with `^3` itself: `npm explain js-yaml@3.15.2` prints
  `overridden js-yaml@"^3" (was "^3.13.1")` for both `gray-matter` and
  `@lhci/utils`. Today that changes nothing — 3.15.2 is the newest 3.x under
  either range. The day a package arrives that pins an older 3.x exactly, it
  is handed the hoisted 3.15.2 instead of its own copy, with no gate going
  red. The un-ranged key, `"js-yaml": { "argparse": "^2.0.1" }`, resolves to
  the byte-identical lockfile without that rewrite, at the price of also
  holding `argparse` at `^2.0.1` under any later `js-yaml` major. Neither side
  effect bites today; the ranged key was kept because its hypothetical hands a
  package a newer release of the major it asked for, and the other's hands
  one an older major.
  **Why scoped, when the other five are not.** `CLAUDE.md` says to scope an
  override the day two parents need different majors, and here they do by
  construction: `js-yaml@4` declares `argparse ^2`, `js-yaml@3` declares `^1`,
  and this entry exists to overrule the second. The unscoped form resolves to
  the identical lockfile today. They differ on the day another package arrives
  that really runs `argparse@1`: unscoped, it would silently be handed the v2
  compatibility shim; scoped, `sprintf-js` comes back, the `audit` job goes
  red, and somebody decides. The second is the failure this file prefers.
  Exactly one file of `js-yaml@3` reaches the swapped package:
  `js-yaml/bin/js-yaml.js`, the command-line tool. `js-yaml/index.js` and
  `lib/**` never require it, so `gray-matter/lib/engines.js` (`yaml.safeLoad`,
  `yaml.safeDump`) and `@lhci/utils/src/lighthouserc.js` run the same 3.15.2
  code as before. Nothing here runs that CLI — no script, workflow, hook or
  dependency spawns `js-yaml` (`jju`, under `audit-ci`, mentions it twice — a
  `Makefile` target and a comment in `index.js` that quotes a `postinstall`
  line — and neither is a lifecycle script: its `package.json` declares only
  `test` and `lint`). It was run anyway, on both majors:
  against 2.0.1 the 3.15.2 CLI parses a file and stdin to byte-identical
  output, `-c`, `-t` and `-j` included, and keeps its exit codes (0, 1 on a
  YAML error, 2 on a bad flag); argparse 2 carries a v1 compatibility layer
  and says so in eight `DeprecationWarning`s on stderr. **One thing does
  break: `js-yaml --version` prints nothing at all instead of `3.15.2`** (the
  legacy `version` shim in `argparse.js` reads a property the constructor
  never sets). `--help` differs in capitalisation, and on a bad flag the usage
  line moves from stdout to stderr with a reworded message (exit code still
  2). That is the whole cost, on a binary nothing calls. What would change the
  answer: all three consumers leaving `js-yaml@3` —
  `@content-collections/core` (0.15.3 already has; the pin here is 0.15.2),
  `mdx-bundler` and `@lhci/utils` — then the override goes, and nothing will
  flag that it can; or an `argparse@1` release that drops `sprintf-js`. A
  patched `sprintf-js` alone would **not** change it: the fix would be a 1.1.x
  release, and `argparse@1`'s `~1.0.2` cannot reach one.
- `@modelcontextprotocol/sdk` is pinned **exactly**, at 1.31.0, for the reason
  `mysql2` is. `shadcn@4.21.0` declares `^1.26.0`, which already admits the
  first patched release — so by the rule above this needed no override, only
  `npm update`. But `npm update` takes the NEWEST release a range admits, and
  on 2026-10-06 that was 1.32.1, published the day before; 1.32.0 was four days
  old. 1.31.0 is the lowest release that clears GHSA-6qxp-vccf-f47h and was
  7 d 22 h old, past the 7-day hold on its own, so the pin is what makes the
  lockfile say 1.31.0 rather than whatever the registry holds that minute. One
  lockfile entry moves, and 1.31.0 declares the same seventeen dependencies as
  1.30.0. `npx shadcn --version` was run against it. The pin can go the day
  `shadcn`'s own floor reaches 1.31, or be raised when Renovate proposes a
  release that has aged through the hold — `shadcn@4.21.3`, the newest, still
  declares `^1.26.0`.
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
`npm update serialize-javascript`). Three more were answered the same way on
2026-10-06 — `source-map-js`, `proxy-addr` and `compression`
(`npm update source-map-js proxy-addr compression`) — and are recorded under
“The four advisories of 2026-10-05” below.

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
  Express ever listens here (corrected 2026-10-06 — this sentence used to say
  the first was a report server bound to localhost during the CI job, and the
  second started under `shadcn mcp`; neither was true). The first is LHCI's
  static fallback server, `@lhci/cli/src/collect/fallback-server.js`, which
  `collect.js` constructs only when `collect.staticDistDir` is set:
  `lighthouserc.cjs` sets `url` and `startServerCommand` instead, so
  `lhci autorun` loads the module and never calls `express()`. The second belongs to
  the MCP SDK's HTTP transports, and `shadcn` imports only
  `server/index.js`, `server/stdio.js` and `types.js` from that SDK, none of
  which loads Express — not even under `shadcn mcp`, which nothing in this
  repository runs anyway. `express@4.22.2` declares `qs: "~6.15.1"`,
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

## The four advisories of 2026-10-05

Four ids entered the feed within twenty minutes of each other late on
2026-10-05, after the branch above had merged. The next push to `main`
(2026-10-06 09:32Z) failed `audit` on all four and `trivy` on one, so nothing
could merge. (`audit` had already failed the push before it, 2026-10-04 17:03Z,
on `braces`; that allow-list entry landed in the 2026-10-06 push itself, so on
`main` the job has been red since 2026-10-04 and these four are why it stayed
red. `trivy` is the one that turned red.) They were answered together on
2026-10-06, and **none is allow-listed**.

| In the feed (UTC) | Advisory            | Severity | Package         | Answer                                                              |
| ----------------- | ------------------- | -------- | --------------- | ------------------------------------------------------------------- |
| 2026-10-05 23:28  | GHSA-vc2v-76pw-4v95 | high     | `compression`   | `npm update` — in range, no override                                |
| 2026-10-05 23:30  | GHSA-jqcg-44mw-7w3h | critical | `proxy-addr`    | `npm update` — in range, no override                                |
| 2026-10-05 23:31  | GHSA-68fv-2mgg-jv7q | high     | `source-map-js` | `npm update` — in range; the release was **6 days old** (see below) |
| 2026-10-05 23:47  | GHSA-hp3w-g68c-fv3c | moderate | `sprintf-js`    | scoped `overrides`: `argparse` 1.0.10 → 2.0.1 under `js-yaml@3`     |

“In the feed” is GitHub's review time (`github_reviewed_at`), the event that
makes `npm audit` and Dependabot fire. All four had been public as CVEs before
that evening (NVD: `compression` 2026-09-11, `proxy-addr` 2026-09-15,
`source-map-js` 2026-09-18, `sprintf-js` 2026-09-24); no gate here saw any of
them until the review.

The lockfile moves in **seven entries** and nothing else: `compression` 1.8.1 →
1.8.2, `proxy-addr` 2.0.7 → 2.0.8, `source-map-js` 1.2.1 → 1.2.2, `argparse`
1.0.10 → 2.0.1, and three removals — `sprintf-js@1.0.3` and the two nested
`argparse@2.0.1` copies the top-level one now replaces. Each resolved version
and integrity hash was asserted against the registry before any gate ran,
because `npm update` takes the newest release a range admits at the moment it
runs: today lowest-that-clears and newest are the same version for all three.
On the result `npx audit-ci --config audit-ci.json` passes and
`bash scripts/ci/trivy.sh` is clean. The exposure paragraphs below were measured
on a production build: none of its 32 `.nft.json` traces names
`source-map-js`, `postcss`, `proxy-addr`, `express`, `compression`, `@lhci`,
`gray-matter`, `js-yaml`, `argparse` or `sprintf-js` from `node_modules/`.

### `source-map-js` — fixed in range, by a release still inside the hold

**GHSA-68fv-2mgg-jv7q** / CVE-2026-93749 (high, CVSS v4 8.7): an indexed source
map whose section carries a huge `offset.line` blocks the event loop once its
mappings are copied into a `SourceMapGenerator`. Range `>= 1.0.0, < 1.2.2`;
first patched **1.2.2**, which is also the newest release. It is the one that
fails two gates: `audit`, and `trivy` (HIGH, fix available).

One copy in the tree, and all five packages that declare it ask for `^1.2.1`:
`postcss@8.5.23` (under `next`), `postcss@8.5.28` (under
`@tailwindcss/postcss`), `@tailwindcss/node`, `css-tree` (under `jsdom`) and
`magicast` (under `@vitest/coverage-v8`). Every range admits 1.2.2, so no
override is needed.

**Exposure here: build-time only, on our own stylesheets.** The lockfile gives
the package no `dev` flag, because `next` — a `dependencies` entry — declares
`postcss`; that is why Trivy reports it. As with the Prisma chain, the scope
flag is not the argument; the bundle is. Outside `.next/cache` the package
appears in exactly one place, `.next/build/chunks/`, Turbopack's build-time
PostCSS worker, which no trace references. In `next/dist`,
`require("postcss")` occurs only under `build/webpack/**` and in compiled
PostCSS plugins, nothing under `server/`. And PostCSS hands a map to
`SourceMapConsumer` only when a stylesheet carries a `sourceMappingURL`
comment: `styles/globals.css`, `styles/print.css` and Tailwind's own CSS carry
none. No request, no guide, nothing a visitor writes reaches it. It is fixed
all the same: a release its parents already accept exists.

**The hold, and whose decision it was.** 1.2.2 is the first patched release
_and_ the only one, so no aged release clears the advisory:

| Release   | Published            | Age on 2026-10-06 11:06Z | Clears the advisory         | Clears the 7-day hold          |
| --------- | -------------------- | ------------------------ | --------------------------- | ------------------------------ |
| 1.2.1     | 2024-09-08T16:22:55Z | 2 years                  | no (last vulnerable)        | yes                            |
| **1.2.2** | 2026-09-30T14:08:09Z | **5 d 21 h**             | yes (first patched, latest) | **no** until 2026-10-07T14:08Z |

The lockfile entry was committed 27 hours inside the hold. Whether it reached
`main` inside it is a different fact, and this file does not pre-write it: the
date of the merge that brought this section, set against 2026-10-07T14:08Z,
says which, and a merge before that moment was the maintainer's explicit
decision, asked for on the pull request — never the branch's.
`CLAUDE.md` is plain that the waiver “is not a licence to skip the hold when
nothing is delayed”. Both sides, because the next reader should not have to
reconstruct them:

- _What the hold protects here._ A hijacked release would run in every build,
  including the Vercel production build that has just applied the migrations
  and holds the database URLs. And by the exposure paragraph above, no
  _security_ response was being delayed: the vulnerable function is fed
  nothing. What waiting delays is the merge queue — `audit` and `trivy` red on
  `main`, and with them every other change, for one more day.
- _What was checked in place of those 27 hours._ All 18 files of the installed
  package are byte-identical to the upstream tag `v1.2.2` (commit `0a1d334`,
  which is also the `gitHead` the registry records), and that tag is four
  commits past 1.2.1: the fix (`source-map-consumer.js`,
  `source-map-generator.js`, `source-node.js`), a CSP fallback in
  `quick-sort.js`, the changelog and the version bump. Same npm publisher as
  1.2.1, no dependencies, no install script. So what was installed is the
  reviewed source, which is the thing the hold exists to make likely.
- _The timeline, in one yardstick._ CVE public 2026-09-18; fix commit and
  release 2026-09-30, within the hour of each other; GitHub's review
  2026-10-05. The release is a response to a public CVE, not a version that
  appeared behind an advisory.

None of this is a precedent. A release that cannot be compared with its source
file by file should wait out the hold, and so should one whose advisory leaves
no gate red.

**What the bump does not reach.** `magicast@0.5.4` declares `source-map-js` but
never imports it: its `dist/builders-*.js` carries its own inlined copy,
`SourceMapConsumer` included. No scanner sees that copy and no override can
move it. It is dev-only — coverage, and the Prisma CLI's config loader — and
reads this repository's own files.

### `proxy-addr` — fixed in range

**GHSA-jqcg-44mw-7w3h** / CVE-2026-90711 (critical), `>= 1.1.0, < 2.0.8`: a
trust subnet written as an IPv4-mapped IPv6 address with a short prefix
compiles to a predicate that matches every IPv4 client, so Express believes
whatever `X-Forwarded-For` says. One copy, under both dev-only Express
servers: `express@4.22.2` under `@lhci/cli` (declares `~2.0.7`) and
`express@5.2.1` under `shadcn > @modelcontextprotocol/sdk` (`^2.0.7`). Both
admit **2.0.8**,
the first patched release and the only one above 2.0.7, published 2026-09-15 —
21 days old, so the hold was never in question. `forwarded` and `ipaddr.js`
are exact pins in 2.0.7 and 2.0.8 alike and do not move.

Exposure was nil before the bump, and that is written down so the word
“critical” is not misread later. The bug needs a configured trust subnet and a
listening Express; this repository has neither (the `qs` paragraph above says
why neither Express ever listens), nothing under `@lhci/` sets `trust proxy`,
and the site's own `clientIp()` (`lib/security/ip.ts`) reads its headers by
hand. Compatibility: the diff is 32 added lines inside `trustSingle` /
`trustMulti`; the exports and the `compile([])` path Express takes while
`trust proxy` is unset are untouched, and the call sites it adds are all for
`ipaddr.js` methods 2.0.7 already uses — no new `ipaddr.js` API.

### `compression` — fixed in range

**GHSA-vc2v-76pw-4v95** / CVE-2026-87776 (high), `< 1.8.2`: when a client
disconnects before a compressed response finishes, the zlib stream made for it
is never destroyed. One copy, one parent: `@lhci/cli` declares `^1.7.4`, which
admits **1.8.2**, the first patched release and the only one above 1.8.1,
published 2026-09-11 — 24 days old when the advisory went public. It adds one
dependency, `destroy: 1.2.0`, the exact copy already installed for Express's
`send`; nothing else moves.

Exposure: its single consumer is the same never-constructed LHCI fallback
server (`fallback-server.js` requires it on line 11 and mounts it on line 30),
so `lhci autorun` loads the module and never calls it.

**Not the same artifact:** `next` ships its own precompiled copy at
`next/dist/compiled/compression`, which `npm audit` cannot see and this update
does not touch. It is an older build (no brotli branch), and Next guards the
same leak itself: `server/lib/router-server.js` releases the compression stream
on a `close` that arrives before the response has finished. No trace of the
production build lists `next/dist/compiled/compression`, though
`next-server.js.nft.json` does list `router-server.js`; whether Vercel's
runtime ever serves through that path was not observed on the deployment.

**Not proved by a local run, for both Express-side packages:** `npm run lhci`.
`lhci autorun` is the one command here that loads `proxy-addr@2.0.8` and
`compression@1.8.2`; the `lighthouse` job on the PR settles it.

### `sprintf-js` — removed, not tolerated

**GHSA-hp3w-g68c-fv3c** / CVE-2026-97058 (moderate): `sprintf-js` hands an
unbounded precision to `toFixed`, so a format string the caller controls
(`%.200f`) throws an uncaught `RangeError`. Range `<= 1.1.3`, **no patched
release**. Upstream: issue `alexei/sprintf.js#237` (2026-09-16) and a
third-party fix, PR `#238` (2026-09-29), are both open and unanswered; the last
commit on the default branch is from 2023-09-11.

The chain is `js-yaml@3.15.2 > argparse@1.0.10 > sprintf-js@1.0.3`, and
`js-yaml@3` is reached three ways: through `gray-matter` under
`@content-collections/core`, through `mdx-bundler > gray-matter` under
`@content-collections/mdx`, and through `@lhci/cli > @lhci/utils`. **The first
two are hard dependencies of two `dependencies` entries**, one of which
(`@content-collections/mdx`) does ship a file to the server. That is what made
this a decision rather than one more line in the dev-tool lists above.

Exposure is nil, and it was measured rather than argued. `argparse@1` is
loaded only by the `js-yaml` command-line tool, and nothing runs that tool;
the only format strings it would hand `sprintf` are literals in `argparse` and
in `js-yaml`'s own bin. From this whole chain the build ships one file,
`@content-collections/mdx/dist/react/server.js`, which imports React and
nothing else. (A plain `grep content-collections` over the traces does return
two, `/acheter` and `/velo/[id]/liste`: both list this repository's own
`content-collections.ts` as an inert traced source file, and none of its
imports is traced.)

So it met the rule at the top of this file — build-time only, no fixed release
— and could have been allow-listed. It was **not**, by the rule that decided
`basic-ftp` — last resort, not first move — and for two reasons of its own: an
entry would have been the first one under a shipped `dependencies` entry, and
permanent in practice, since the upstream that has to ship the fix
has merged nothing in three years. Removing the package costs one flag of a
binary nobody calls (the compatibility note under the overrides table), adds
no version the tree did not already hold, and turns a quarterly re-read into a
gate that fails if `argparse@1` ever comes back.

**The override removes the only copy npm can see, not every copy on disk.**
`@prisma/query-plan-executor@7.2.0` (`prisma > @prisma/dev`, `devOptional`)
bundles `tedious` and, inside it, `sprintf-js@1.1.3` — also in range. It is not
a lockfile package, so no scanner reports it and no override can move it. It
formats `tedious`'s own literal strings on a SQL Server connection; this
project is PostgreSQL only, never runs `prisma dev`, and no trace names it.

Two other fixes were tried in a scratch copy and declined.
`@content-collections/core@0.15.3` is what `npm audit` itself proposes: it
clears one path of three, `sprintf-js` stays through `mdx-bundler` and
`@lhci/utils` (both at their latest release), and it brings `js-yaml@5.4.3`,
published 2026-10-05, the evening before. Overriding `js-yaml` to `^4` does remove
`sprintf-js`, and breaks a library instead of a binary: `gray-matter@4.0.3`'s
default engine and `@lhci/utils` both call `yaml.safeLoad`, which 4.x keeps
only as a function that throws.

## Two more on 2026-10-06, the day the four above were fixed

The fix for the four advisories above merged at 15:54Z, and the push it made
failed `audit` anyway — on an id that had not existed when its last pull-request
run passed. A second arrived while that one was being fixed. Neither is
allow-listed.

| In the feed (UTC) | Advisory            | Severity | Package                     | Answer                                                     |
| ----------------- | ------------------- | -------- | --------------------------- | ---------------------------------------------------------- |
| 2026-10-06 13:43  | GHSA-wq5f-xc86-pv6w | high     | `sharp`                     | `npm update` — in range, no override                       |
| 2026-10-06 15:35  | GHSA-6qxp-vccf-f47h | high     | `@modelcontextprotocol/sdk` | `overrides`, pinned exactly at the lowest clearing release |

**The gate flapped while the second one arrived, and that is worth knowing.**
Between 17:00Z and 17:10Z `npx audit-ci --config audit-ci.json` was run six
times on one unchanged tree: two runs failed and four passed. The one failure
whose path was read named GHSA-6qxp-vccf-f47h; the same command passed on
either side of it. The registry's advisory endpoint does not serve a new id to every request at
once. So on a day advisories are landing, one green `audit` run is not a
verdict — run it again before believing it, and expect a required check to
disagree with a local run made a minute earlier.

### `sharp` — fixed in range, and this one ships

**GHSA-wq5f-xc86-pv6w** (high, CVSS 8.9): a memory-safety bug in librsvg,
which `sharp`'s prebuilt binaries bundle; the advisory rates it possible remote
code execution on glibc Linux when an SVG is decoded. Range `< 0.35.5`, first
patched **0.35.5**, which is also the newest release — published 2026-09-27, so
nine days old and clear of the 7-day hold with no waiver.

`sharp` is not a dependency of this repository: `next@16.3.6` declares it as an
optional dependency, `^0.35.4`, for its image optimizer. That range admits
0.35.5, so `npm update sharp` reached it with no override. **27 lockfile
entries move and nothing else**: `sharp` and its 26 `@img/*` platform packages
(`sharp-*` 0.35.4 → 0.35.5, `sharp-libvips-*` 1.3.3 → 1.3.4). On the installed
tree `sharp.versions.rsvg` reports 2.63.2, the librsvg release the advisory
names as fixed, and `sharp` still encodes a PNG.

Unlike everything else recorded in this file, **this package is deployed**:
`next-server.js.nft.json` and the page traces of a production build list
`node_modules/sharp/`. That is why it was fixed without an exposure argument.
What is known, for the record: no file under `app/`, `components/` or `lib/`
imports `next/image`; `next.config.ts` allows one remote host
(`lh3.googleusercontent.com`) and does not set `dangerouslyAllowSVG`. Whether a
request could still make the optimizer hand an SVG to librsvg was **not**
established, and with a patched release in range it did not need to be.

### `@modelcontextprotocol/sdk` — pinned at the lowest release that clears it

**GHSA-6qxp-vccf-f47h** / CVE-2026-104850 (high): the SDK's OAuth client let an
MCP server choose which authorization server received the client's stored
credentials. Range `>= 1.12.0, < 1.31.0`; first patched **1.31.0**. One copy,
dev-only: `shadcn@4.21.0 > @modelcontextprotocol/sdk@1.30.0`.

The compatibility note under the overrides table says why this is an exact pin
and not a plain `npm update`: the range admits the patch, and also two newer
releases still inside the hold. Exposure here was nil before the bump: the bug
needs the SDK's OAuth client over HTTP, and `shadcn` imports only
`server/index.js`, `server/stdio.js` and `types.js` from the SDK; nothing in
this repository runs `shadcn mcp` at all.

## Removed from the array (2026-09-30)

Seven ids left the allowlist because the vulnerable version is no longer in the
tree — see the `overrides` table above. If any of them comes back, the `audit`
job goes red, which is the point: GHSA-82x6-q7mm-w9cf, GHSA-v5mp-jgw5-2x6j
(`toml`), GHSA-w5hq-g745-h8pq (`uuid`), GHSA-ph9p-34f9-6g65,
GHSA-52f5-9888-hmc6 (`tmp`), GHSA-3f6p-5ww8-9rcr, GHSA-rgwj-5xj2-c3m3
(`mysql2`).

## `braces`, through three dev-tool glob chains — no patched release

**GHSA-vfj7-8cjw-p6xm** (high, published 2026-09-18): stack exhaustion on deeply
nested patterns, `braces <= 3.0.3`, and **3.0.3 is the latest release** — there
is nothing to move to, so this is an allowlist entry rather than an override.

Reached three ways, all dev-only and all through `fast-glob > micromatch`:
`eslint-config-next > @next/eslint-plugin-next`, the `shadcn` CLI, and
`ts-morph > @ts-morph/common`. Every pattern any of them expands comes from this
repository's own configuration — `eslint.config.mjs`, a `components.json` path,
a `tsconfig` include — never from a request, a guide or anything a visitor
writes. Nothing in the deployed application imports `braces`, `micromatch` or
`fast-glob`: they exist for linting, scaffolding and type-analysis on a
developer's machine and on CI.

Re-evaluate when `braces` ships a fix, or when `fast-glob` moves off it.

## Alerts dismissed on GitHub, and why (the maintainer runs these)

`audit-ci.json` governs the `audit` gate. GitHub's own alert lists are a second
record, and this section is the first one's written reason for every alert it
leaves open there: a dismissal changes the repository's security record, so it
is the maintainer's to make, never an agent's. The commands are exact — the
comment is what a reader finds months later next to a closed alert.

### CodeQL — four alerts stay open after this branch fixes eight

**Run on 2026-10-06 (16:00Z)**: the four commands below, by the agent on the
maintainer's explicit instruction (`.debug/017` §1), after which
`gh api "repos/lienardale/velo-atelier/code-scanning/alerts?state=open" --jq length`
returned `0`.

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
