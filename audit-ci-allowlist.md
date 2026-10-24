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

Re-recorded on 2026-10-09, same Node and npm, after the pin moved to Next
16.3.8 (“Six advisories on `next`, published 2026-10-07”): `npm audit` finds
the same **19** vulnerable packages — 0 critical, 17 high, 2 moderate — under
the same **six** ids, and the six are exactly the array. Minutes earlier, on
`main`'s tree, it found 20 — `next` among them — under twelve.

Re-recorded on 2026-10-22, same Node and npm, after the advisories under
“Thirteen advisories of 2026-10-20 and 21” were fixed: `npm audit` finds the
same **19** vulnerable packages — 0 critical, 17 high, 2 moderate — under the
same **six** ids, and the six are exactly the array. On `main`'s tree it found
25 — 19 high, 6 moderate — under nineteen.

Re-recorded on 2026-10-24, same Node and npm, after the advisories under
“Ten advisories of 2026-10-23” were answered: `npm audit` finds **15**
vulnerable packages — 0 critical, 12 high, 2 moderate, 1 low — under **seven**
ids: the five the array names by id, GHSA-mrhx-c7xc-m3w5, which it names by
dependency path only, and one low id below the threshold, not taken (that
section says why). The `braces` id has left the array: the advisory was
withdrawn. On `main`'s tree it found 18 packages under fifteen ids.

## Pinned through `overrides` instead of allow-listed

These nine are **fixed**, not tolerated. For the first five the parent's
declared range excludes the patched version, so npm needs the override to reach
it. The last four are different shapes, each with its own note below:
`argparse` removes a package that has no patched version at all, and
`@modelcontextprotocol/sdk`, `vite` and `undici` under `jsdom` each pin a
version their parents' ranges already admit, because the newest release those
ranges admit was inside the 7-day hold — the last of them **scoped**, because
the tree's two `undici` majors have different parents. Each was proved by a green `bash scripts/ci.sh` and a green
`npm run build` on the resolved tree.

| Override                            | Resolves to | Replaces                                   | Fixes                                                                                                                              | Reached through                                                                                                                                   |
| ----------------------------------- | ----------- | ------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| `toml: ^5.0.1`                      | 5.0.1       | 3.0.0 (`^4.2.0`, 4.3.0, before 2026-10-23) | GHSA-82x6-q7mm-w9cf, GHSA-v5mp-jgw5-2x6j; since 2026-10-23 also GHSA-4qx8-w7c3-pj3p, GHSA-9j65-hcg3-gc64, GHSA-9qmh-m7c6-f92p      | `@content-collections/mdx > mdx-bundler > remark-mdx-frontmatter > toml`                                                                          |
| `uuid: ^11.1.1`                     | 11.1.1      | 9.0.1 / 8.3.2                              | GHSA-w5hq-g745-h8pq                                                                                                                | `@content-collections/mdx > mdx-bundler`, `@lhci/cli`                                                                                             |
| `tmp: ^0.2.7`                       | 0.2.7       | 0.1.0 / 0.0.33                             | GHSA-ph9p-34f9-6g65, GHSA-52f5-9888-hmc6                                                                                           | `@lhci/cli`, `@lhci/cli > inquirer > external-editor`                                                                                             |
| `mysql2: 3.23.1`                    | 3.23.1      | 3.15.3                                     | GHSA-3f6p-5ww8-9rcr, GHSA-rgwj-5xj2-c3m3                                                                                           | `prisma > mysql2` (optional MySQL driver; this project is PostgreSQL only)                                                                        |
| `basic-ftp: ^6.2.1`                 | 6.2.1       | 5.3.1                                      | GHSA-c475-qrg2-pj4r                                                                                                                | `@lhci/cli > proxy-agent > pac-proxy-agent > get-uri > basic-ftp`                                                                                 |
| `js-yaml@^3 > argparse: ^2.0.1`     | 2.0.1       | 1.0.10                                     | GHSA-hp3w-g68c-fv3c (`sprintf-js@1.0.3`, which leaves the lockfile)                                                                | `gray-matter > js-yaml@3` (under `@content-collections/core` and `@content-collections/mdx > mdx-bundler`), `@lhci/cli > @lhci/utils > js-yaml@3` |
| `@modelcontextprotocol/sdk: 1.32.0` | 1.32.0      | 1.31.0 (1.30.0 before 2026-10-06)          | GHSA-6qxp-vccf-f47h; since 2026-10-22 also GHSA-22jm-h49p-29qw, GHSA-46jr-4wx8-v453, GHSA-6prh-2h8m-c8cw, GHSA-rvq5-wwqv-78pq      | `shadcn > @modelcontextprotocol/sdk`                                                                                                              |
| `vite: 8.2.4`                       | 8.2.4       | 8.2.2                                      | GHSA-587h-7wmj-h5pm, GHSA-698v-4r3x-3vcv, GHSA-r825-w8mm-5pxw, GHSA-rq7h-c2jc-7f22, GHSA-vfpm-58rq-9qcg, GHSA-9jrq-w75r-8gcw (low) | `vitest`, `vitest > @vitest/mocker`, `@vitejs/plugin-react` (peer)                                                                                |
| `jsdom > undici: 8.12.2`            | 8.12.2      | 8.10.2                                     | GHSA-4qv8-2p9j-2685, GHSA-f72v-6w45-q472, GHSA-xjj6-f33q-929c                                                                      | `jsdom` (the Vitest `ui` tier's environment)                                                                                                      |

Compatibility notes, because an override is a version its parent never tested:

- `toml` is the one that touches the build. `remark-mdx-frontmatter@4.0.0`
  does `import { parse as parseToml } from 'toml'`. 4.x exported a named
  `parse` readable from ESM and from `require` (it dropped `stringify`, which
  nothing in this tree calls). **5.0.1**, the override since 2026-10-23, is
  still CommonJS — `main: index.js`, no `exports` map,
  `module.exports = { parse }`, `engines.node >=20` — and Node still reads the
  named `parse` from ESM: imported that way from the unpacked 5.0.1 tarball, it
  parsed a table (checked 2026-10-23). No file under `content/` has TOML front
  matter (`+++`), so this corpus never calls it. `npm run build` and
  `npm run content:check -- --strict` compile the whole `content/` corpus
  through that chain anyway.
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
  **Raised to 1.32.0 on 2026-10-22**, for four advisories published on
  2026-10-20 that all end at `<1.32.0` (“Thirteen advisories of 2026-10-20 and
  21”). 1.32.0 is the lowest release that clears them, and at 19 d 20 h old it
  was past the hold. It declares the same seventeen dependencies as 1.31.0, and
  `npx shadcn --version` was run against it. The pin is still the right shape:
  `shadcn@4.22.0` and `4.22.1` now declare `^1.32.0`, but they were published
  on 2026-10-16 and 2026-10-18, inside the hold. The day one of them has aged
  through it, a `shadcn` bump makes this pin redundant.
- `vite` is pinned **exactly**, at 8.2.4, for the same reason (2026-10-22). Its
  three parents admit every 8.x: `@vitejs/plugin-react@6.1.1` (peer `^8.0.0`),
  and `vitest` and `@vitest/mocker` 4.1.12 (`^6.0.0 || ^7.0.0 || ^8.0.0`). So
  `npm update vite` would take 8.3.5, published 2026-10-21, inside the hold.
  8.2.4 is the lowest release that clears all six ids on the 8.2 line, and it
  was 16 d old. It declares `rolldown: ~1.2.4`, as 8.2.2 does, so `rolldown`
  stays at 1.2.8 — but see “How the lockfile was resolved” below for what one
  `npm install` did to it. `vite` runs here only inside Vitest: the site is
  built by Next's Turbopack, so `bash scripts/ci.sh`'s three test tiers are its
  whole exercise, and they passed. The pin can go when the range's newest
  release has aged through the hold.
- `undici` under `jsdom` is pinned **exactly**, at 8.12.2, for the reason
  `mysql2`, the SDK and `vite` are (2026-10-24). `jsdom@30.0.1` declares
  `^8.9.0`, which admits the fix, so `npm update undici` would have been the
  whole answer — but it takes 8.12.3, published 2026-10-19 and inside the hold
  until 2026-10-26T14:02Z (measured on a scratch copy: that one command moved
  `jsdom`'s copy to 8.12.3). 8.12.2 is the lowest 8.x that clears all three
  ids, and was 9 d 1 h old. **Scoped**, unlike the SDK and `vite` pins,
  because the tree holds two `undici` majors with different parents:
  `shadcn` (`^7.27.2`) and `@dotenvx/dotenvx` (`^7.11.0`) are on 7.x, and an
  unscoped `"undici": "8.12.2"` would hand them a major they never declared.
  Their copies moved by `npm update undici` to 7.30.1, the newest 7.x, past the
  hold. One lockfile entry moves for the pin. `jsdom/lib/api.js` requires
  `undici` at load, so the `ui` tier is its exercise; it passed. **Renovate
  reads an override as a dependency**, so `renovate.json` caps this one below
  9: `jsdom` declares `^8`, and a v9 proposal would put a major under it that
  it never declared. The pin can go once 8.12.3 has aged through the hold:
  `npm update undici` then takes a release past it.
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
  (Since 2026-10-24 the second no longer does: `body-parser@2.4.0` declares
  `qs ^6.16.1`, npm nested `qs@6.16.1` under the SDK, and the SDK's Express
  resolves that copy, outside both ranges — measured with `npm ls qs`. The two
  ids stand for `express@4.22.2`'s `qs@6.15.3`, which two chains reach: the
  first path, and the peer `express@">= 4.11"` of `express-rate-limit@8.7.0`
  under `shadcn > @modelcontextprotocol/sdk`, which that hoisted Express
  satisfies (`npm explain express`). That edge is never loaded either: the SDK
  uses `express-rate-limit` only in its `server/auth/handlers`,
  `express-rate-limit` imports `express` in its type declarations and not at
  run time (read), and the three SDK modules `shadcn` imports load 300
  modules, through `require` and through `import` alike, none of them
  `express`, `express-rate-limit` or `qs` (measured on 2026-10-24). “Ten
  advisories of 2026-10-23”.)
  A **scoped** override (`"express": { "qs": "^6.16.0" }`) is mechanically
  available — npm does nest a second copy when a range demands one, and this
  very tree proves it: `node_modules/body-parser@1.20.9` (1.20.8 until 2026-10-24) declares `qs: "~6.16.0"`
  and got `node_modules/body-parser/node_modules/qs@6.16.0` beside the
  top-level 6.15.3. It is declined, not impossible: it would still be an
  untested minor under two servers that never listen, and the gate that would
  exercise it is `lighthouse`, which does not run in `npm run ci:local`. What
  would change the answer: an `express@4` release whose range reaches
  `qs@6.16`, or a `qs` in something that handles a real request.

## `zod@3.25.76`, two dev-only copies — allow-listed by path, never by id

**GHSA-mrhx-c7xc-m3w5** (high, `zod <4.6.6`) has **no patched 3.x release**:
3.25.76 is the newest 3.x, and two packages in the tree still declare
`zod ^3.24.1` — `shadcn@4.21.0`, and `chromium-bidi@14.0.0` under
`@lhci/cli > lighthouse > puppeteer-core`. Each kept its own nested copy when
the root moved to 4.6.6 (“Ten advisories of 2026-10-23”, below). They are
accepted by **path**, three strings in `audit-ci.json`, the first entries of
that form here:

```text
GHSA-mrhx-c7xc-m3w5|@lhci/cli>lighthouse>puppeteer-core>chromium-bidi>zod
GHSA-mrhx-c7xc-m3w5|@lhci/utils>lighthouse>puppeteer-core>chromium-bidi>zod>
GHSA-mrhx-c7xc-m3w5|shadcn>zod
```

**Why a path and not the id.** The id is also the shipped `zod`'s. An id
entry would accept the advisory on the direct dependency too, and a `zod` back
at 4.5.4 — a bad merge, a revert — would pass `audit` without a word, which
“What is **not** allow-listed” forbids. audit-ci 7.1.0 compares a path entry
with the whole path string, exactly, unless the entry holds a `*`
(`matchString`); these hold none, and the shipped copy's path is the bare
`zod`. Measured on 2026-10-24 on scratch copies of this tree's `package.json`
and lockfile, `audit-ci --directory <copy> --config <variant>`:

| Configuration, tree                                                                                      | Exit | Path named                                                                      |
| -------------------------------------------------------------------------------------------------------- | ---- | ------------------------------------------------------------------------------- |
| the committed array, this tree                                                                           | 0    | —                                                                               |
| without the `shadcn>zod` entry                                                                           | 1    | `GHSA-mrhx-c7xc-m3w5\|shadcn>zod`                                               |
| without the `@lhci/cli>…` entry                                                                          | 1    | `GHSA-mrhx-c7xc-m3w5\|@lhci/cli>lighthouse>puppeteer-core>chromium-bidi>zod`    |
| without the `@lhci/utils>…` entry                                                                        | 1    | `GHSA-mrhx-c7xc-m3w5\|@lhci/utils>lighthouse>puppeteer-core>chromium-bidi>zod>` |
| the committed array, root `zod` back at 4.5.4 (`npm install zod@4.5.4 --save-exact --package-lock-only`) | 1    | `GHSA-mrhx-c7xc-m3w5\|zod`                                                      |

Run with `--show-not-found`, the committed array reports no entry unused.

**The trailing `>` is audit-ci's, and the entry needs it.** audit-ci builds an
npm 7+ path by walking a vulnerable package's `effects` up to the root
(`recursiveMagic` in `dist/chunk-FA3SOWIW.js`, read). `@lhci/utils` is an
effect of `lighthouse` and `@lhci/cli` an effect of `@lhci/utils`; when the
walk meets `@lhci/cli` a second time it returns the path built so far, before
the slice that drops the trailing separator. That string is what audit-ci
compares, so it is what the entry says. A path is recomputed from the report
on every run: a new effect in the chain — an advisory on `lighthouse` itself —
changes it, and the gate goes red rather than wider.

**`trivy` needs no entry, and has none.** trivy 0.71.0 leaves dev dependencies
out of an npm lockfile scan unless it is given `--include-dev-deps`, which
`scripts/ci/trivy.sh` does not pass, and both copies are `dev`: on this tree
the gate is clean. Run with the flag, it reports `zod 3.25.76 CVE-2023-54404`,
which is how that reason was checked. The shipped copy is a production one, so
trivy still sees it: `trivy.sh`'s two passes and its allowlist translation,
pointed at the scratch tree with the root at 4.5.4, exit 1 on
`zod 4.5.4 CVE-2023-54404 / GHSA-mrhx-c7xc-m3w5`. The translation accepts a
finding whose id or `VendorIDs` equals an entry of the array, and a path string
equals none, so these three accept nothing on trivy's side. No `.trivyignore`
exists, and none is needed.

- **`shadcn`** (`devDependencies`, `^4.21.0`, locked at 4.21.0): every 4.21.x
  declares `zod ^3.24.1`; 4.22.0 (2026-10-16) is the first on `^4.2.0`.
  Nothing in this repository runs the CLI — no script, hook, workflow or test
  names it — so its zod runs when a developer types `npx shadcn`, on
  `components.json` and on registry items fetched from ui.shadcn.com. Its
  schemas hold **no** size-capped collection: the 345 reachable from its two
  schema chunks, walked under zod 3, have none, and the only size check in the
  four files of `dist/` that import zod is a string's `.min(2)` (searched). A
  size cap is the one case 4.6.6 changes — an uncapped array still costs one
  issue per failing element on 4.6.6 (“`zod` 4.5.4 → 4.6.6: what changed”,
  below). **This entry does not meet condition (c)** of the rule of thumb at
  the top of this file, and does not rest on it: a registry item fetched from
  ui.shadcn.com is input this repository does not control. It rests instead on
  the vulnerable construct, a size-capped collection, being absent from every
  schema that copy of zod runs: the fix acts on a capped collection and on
  nothing else (`capSize`, below), so on these schemas the patched release
  would allocate what 3.25.76 does. That is this change's decision, written
  here so that it is not read as an oversight. The `chromium-bidi` copy below
  does meet (c): it is never loaded, and would parse only the protocol
  traffic of the browser our own Lighthouse runs start.
- **`chromium-bidi`** (`@lhci/cli > lighthouse@12.6.1 > puppeteer-core@24.43.1 >
chromium-bidi@14.0.0`): `puppeteer-core` pins it exactly, 24.43.1 is the
  newest 24.x, `lighthouse` asks for `^24.10.0`, and every `chromium-bidi`
  release through 17.0.2 still declares `zod ^3.24.1` — no upstream release
  moves it. **`lhci autorun` never loads it** (read on 2026-10-24):
  `puppeteer-core` requires it only from `bidi/BidiOverCdp.js`, which a
  connection reaches with `protocol: 'webDriverBiDi'`; Lighthouse connects with
  `puppeteer.connect({browserURL, defaultViewport: null})`, CDP by default,
  and LHCI launches Puppeteer itself only for a `puppeteerScript`, which
  `lighthouserc.cjs` does not set. Its 2 371 reachable schemas hold no
  size-capped collection either (42 arrays with a minimum only).

**Two fixes were tried and declined**, both measured on 2026-10-24:

- _A scoped override to zod 4._ `"shadcn": { "zod": "$zod" }` resolved to one
  lockfile change — the nested copy removed — and a CLI that no longer starts:
  every command, `--version` included, exits 1 at load with
  `TypeError: o.deepPartial is not a function` (zod 4 has no `deepPartial`).
  It was reverted with `npm install`, and the lockfile came back
  byte-identical. For `chromium-bidi` the dependent tool cannot exercise one —
  it never loads the package — so the parser was loaded on its own, from a
  scratch copy with zod 4.6.6 beside it: it loads, and answers differently.
  `parseCreateParams({type: "tab"})` gains `"background": false`, and an
  invalid `session.subscribe` throws
  `TypeError: Cannot read properties of undefined (reading 'map')` where zod 3
  gives its `InvalidArgumentException`.
- _`shadcn` 4.22.0_, the vendor's own move to zod 4, past the hold since
  2026-10-23T13:26Z. On a scratch copy, `npm install shadcn@4.22.0
--package-lock-only` moved 26 lockfile entries, among them `caniuse-lite` and
  `baseline-browser-mapping` — no `dev` flag, `next` declares both — and
  `browserslist` 4.28.9 → 4.29.4, all three inside the hold. Restricted with
  `--before=2026-10-17T16:00Z` it still moved 26, the same two build-data
  packages among them: 4.22.0 asks for `browserslist ^4.29.3`, and 4.29.3 for
  `caniuse-lite ^1.0.30001813`. A dev CLI's advisory is not a reason to move
  the browser data the production build compiles against.

What would change the answer: a `shadcn` bump to 4.22 or later — then the
`shadcn>zod` entry goes **in the same change**, because a dead entry is silent
here (`show-not-found: false`); a `chromium-bidi` on zod 4, or a
`puppeteer-core` without it — then the other two go.

## What is **not** allow-listed

Anything in `dependencies` that ships to the server or the browser: `next`,
`react`, `react-dom`, `next-auth`, `@auth/prisma-adapter`, `@prisma/client`,
`@prisma/adapter-pg`, `pg`, `bcryptjs`, `zod`, `three` and the React Three
Fiber stack. An advisory on any of those blocks the pipeline until it is fixed.

`zod` is the one name in that list that also appears in the array, since
2026-10-24 — and only by dependency **path**, for two dev-only `zod@3.25.76`
copies under `shadcn` and `chromium-bidi`. The shipped copy was bumped to
4.6.6, and with it back at 4.5.4 the `audit` gate fails on
`GHSA-mrhx-c7xc-m3w5|zod` (measured; “`zod@3.25.76`, two dev-only copies”,
above).

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

(Added 2026-10-09. They never got that far: 16.3.8 was the vendor's fix for
six advisories that were not public when this was written, and the pin moved
to it nine days later — “Six advisories on `next`, published 2026-10-07”,
below. Nothing above is withdrawn: on 2026-09-30 the release was 101 minutes
old and no published advisory named it.)

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

## Six advisories on `next`, published 2026-10-07

Six ids against `next` itself entered the feed within two minutes of each
other on the evening of 2026-10-07, 5 h 38 min after `main`'s last CI run
started (run 37640409895, 14:52Z, on `9ae46bf`; it passed). Nothing was pushed
afterwards and no scheduled workflow ran `audit` or `trivy` — one does since
2026-10-19, `.github/workflows/advisories.yml` — so no run on GitHub ever
showed them; nor did Dependabot, whose open alerts on 2026-10-09 at about
14:45Z were the two `extract-zip` ones and nothing on `next`. They
were measured on 2026-10-09 at 13:52Z on a fresh `npm ci` of that same commit:
`bash scripts/ci/audit.sh` exits 1 on five ids and `bash scripts/ci/trivy.sh`
exits 1 on one. **None is allow-listed, and none could be**: `next` is the
first name under “What is **not** allow-listed”.

| In the feed (UTC)   | Advisory            | CVE            | Severity | Range              | What it is                                                                     |
| ------------------- | ------------------- | -------------- | -------- | ------------------ | ------------------------------------------------------------------------------ |
| 2026-10-07 20:30:55 | GHSA-cjq9-62q9-8jv4 | CVE-2026-94483 | high     | `>=16.0.0 <16.3.8` | server-side request forgery in Image Optimization, through an allow-listed URL |
| 2026-10-07 20:31:13 | GHSA-mcj8-r9mp-w47p | CVE-2026-94484 | moderate | `>=16.0.0 <16.3.8` | response-cache poisoning: a root-level catch-all page beside SSG/ISR routes    |
| 2026-10-07 20:31:33 | GHSA-f87g-xv8r-7p7x | CVE-2026-94485 | moderate | `>=16.0.0 <16.3.8` | metadata image routes ignore `dynamicParams`, in builds made with webpack      |
| 2026-10-07 20:31:51 | GHSA-39w2-rjm5-chcv | CVE-2026-94486 | low      | `>=16.0.0 <16.3.8` | the development server's MCP endpoint answers any site the developer visits    |
| 2026-10-07 20:32:06 | GHSA-4jqv-mc3x-m676 | CVE-2026-94543 | moderate | `>=16.0.0 <16.3.8` | cache poisoning of SSG/ISR pages — Pages Router, self-hosted                   |
| 2026-10-07 20:32:13 | GHSA-3w37-wq28-93x7 | CVE-2026-94544 | moderate | `>=16.3.0 <16.3.8` | a pending `use cache` fill leaks Draft Mode content into regular responses     |

“In the feed” is `github_reviewed_at`, as in the tables above; for these six it
equals `published_at`. `audit-ci.json` fails at `moderate`, so the low one
never blocked the gate, and the same release fixes it. `trivy` gates on HIGH
and CRITICAL and names only the first, as CVE-2026-94483, “fixed in 16.3.8”.
A seventh id is in 16.3.8's own release note and nowhere else:
GHSA-h694-7cp9-m8p3, “Cache leak across root param values in nested
`use cache` functions”. `gh api /advisories/GHSA-h694-7cp9-m8p3` answered 404
on 2026-10-09 and `npm audit` does not report it; the bump covers it by that
note's account, which nothing here checked.

The pin moved: **`next` and `eslint-config-next` 16.3.6 → 16.3.8**, together.
Twelve lockfile entries move and nothing else — the same twelve as on
2026-09-30: `next`, `eslint-config-next`, `@next/env`,
`@next/eslint-plugin-next` and the eight `@next/swc-*` binaries. The lockfile
holds 1898 entries before and after. 16.3.8 declares the dependencies 16.3.6
did, `sharp: ^0.35.4` among the optional ones, so `sharp` stays at 0.35.5.

On the result `bash scripts/ci/audit.sh` passed **six runs of six** (all
within the minute of 13:55Z; six because of the flapping recorded above, though
these ids were 41 hours old by then) and `bash scripts/ci/trivy.sh` is clean
(14:47Z).

### Why 16.3.8, and not the release `npm audit` proposes

`npm audit` reports `fixAvailable: next@16.4.0`. That is the newest release,
not the lowest one that clears the range, and on 2026-10-09 it was inside the
hold. `npm view next time`:

| Release    | Published            | Age on 2026-10-09 13:55Z | Clears the six       | Clears the 7-day hold            |
| ---------- | -------------------- | ------------------------ | -------------------- | -------------------------------- |
| 16.3.6     | 2026-09-22T16:19:00Z | 16 d 21 h                | no (the pin)         | yes                              |
| 16.3.7     | 2026-09-29T09:04:19Z | 10 d 4 h                 | no (last vulnerable) | yes                              |
| **16.3.8** | 2026-09-30T16:07:21Z | **8 d 21 h**             | yes (first patched)  | **yes**, since 2026-10-07T16:07Z |
| 16.4.0     | 2026-10-06T18:35:31Z | 2 d 19 h                 | yes                  | no, until 2026-10-13T18:35Z      |

Every one of the six ranges ends at `<16.3.8`, so one release is the first
patched version for all of them, and it had cleared the hold 4 h 23 min before
the first id was published. Lowest-that-clears and past-the-hold are the same
release: the waiver was not needed, and nothing was decided here that the rule
had not already decided. 16.4.0 is a minor, under three days old, and fixes
nothing these ranges name.

**What this does to the 2026-09-30 record above.** That section declined
16.3.8, then 101 minutes old, because no advisory in this tree named a version
above 16.3.6. That was true of what was public. 16.3.8 was also the release
that fixed these six, which stayed unpublished for seven more days. Its GitHub
release note, read on 2026-10-09, opens “This release contains security fixes
for the following advisories” and lists them. Whether it said so on
2026-09-30 was not established: the API gives the release an `updated_at`
equal to its `published_at` (2026-09-30T16:13:46Z), which means it did only if
that field tracks edits to the note. Either way the cost of the rule is now on
record: between a fix and its advisory, the lowest-release rule keeps the tree
on the vulnerable release, and `audit` has nothing to say about it. Whether
that changes the rule is the maintainer's to say; nothing here changes it.

### Exposure, for the record: it was fixed without an exposure argument

`next` ships, so the rule at the top of this file decided it before any of
this was weighed. What was read and measured on this tree all the same, so the
next reader need not redo it:

- **GHSA-cjq9-62q9-8jv4 (high).** The advisory exempts an application with no
  `images.remotePatterns`. This one has one — `next.config.ts` allows
  `https://lh3.googleusercontent.com` — so the exemption does not apply. No
  file under `app/`, `components/` or `lib/` imports `next/image`, and the
  optimizer does not need one: on a production server `/_next/image` is
  mounted (400 without parameters, 200 for `url=/favicon.ico`). Whether that
  one host can be made to serve what the attack needs was **not** established.
- **GHSA-mcj8-r9mp-w47p.** The tree has a catch-all page,
  `app/[locale]/[...rest]/page.tsx`, beside the 219 pages the build
  prerenders. It sits one dynamic segment below the root; whether that is the
  advisory's “root-level catch-all” was not established.
- **GHSA-f87g-xv8r-7p7x.** Webpack builds only. Every build here is Turbopack,
  and `--webpack`, the fallback `scripts/ci/build.sh` names for
  prisma/prisma#29025, has never been applied.
  Related, and **not** changed by this bump: `guides/[slug]/page.tsx` sets
  `dynamicParams = false`, the image route beside it exported no segment option
  of its own, and on 16.3.6 and 16.3.8 alike
  `/fr/guides/<unknown>/opengraph-image` answered 200 with the generic card —
  rendered on demand, then cached on disk — while the page answered 404. That
  was this repository's code, not the advisory, and it was **fixed on
  2026-10-19 by a change of its own**: both image routes now export
  `dynamicParams = false` (the site card had the same shape, reached past the
  proxy by any first segment with a dot in it, `/de.x/opengraph-image`), and
  on Turbopack builds of 16.3.8 and, on 2026-10-23, of 16.4.1, every
  unknown pair answers 404 with nothing written to disk. Without the fix,
  16.4.1 still draws and caches the card. `.debug/017` §2.7 has the
  measurements.
- **GHSA-4jqv-mc3x-m676.** Pages Router, self-hosted; the advisory says
  applications deployed on Vercel are not affected. There is no `pages/`
  directory.
- **GHSA-3w37-wq28-93x7.** Needs Cache Components (or `experimental.useCache`)
  and Draft Mode. None of `"use cache"`, `draftMode` and `cacheComponents`
  occurs in `app/`, `components/`, `lib/`, `proxy.ts`, `auth.ts` or
  `next.config.ts`.
- **GHSA-39w2-rjm5-chcv (low).** `next dev` only, and `npm run dev` is how
  this repository is developed: the exposure was a developer's machine, never
  the site.

### What the bump changed

**In `next`**, read from the two tarballs (`npm pack next@16.3.6 next@16.3.8`;
each sha512 equals its lockfile `integrity`): 8 531 files become 8 539, and 79
differ outside source maps, `dist/esm` and `dist/compiled`. 16.3.7 is one
Turbopack backport. The rest is 16.3.8: the image optimizer (318 changed
lines: its own HTTP agents and a pinned DNS lookup), the response cache and
the file-system incremental cache, now keyed by the route that owns an entry
(a new `server/lib/route-cache-key.js`), the `use cache` wrapper, the
development MCP middleware, the webpack metadata-route loader, and how a
pathname served by several app paths picks its entry (`selectAppPageEntry`).
`dist/client/index.js` and `app-bootstrap.js` differ by the version string
alone.

**In this build**, measured on one machine: `main`'s tree, then this one, the
hooks-on and the hooks-off build of each through `scripts/ci/build.sh`.

| Measured                                              | 16.3.6                       | 16.3.8                                    |
| ----------------------------------------------------- | ---------------------------- | ----------------------------------------- |
| route table (`●` / `ƒ` / `○`), 219 prerendered pages  | —                            | identical, line for line                  |
| `bundle-guard`, files checked (hooks on / off)        | 65 / 63                      | 65 / 63                                   |
| files under `.next/static` (hooks on / off)           | 77 / 75                      | 77 / 75                                   |
| first-load JS, gzip, each of the nine budgeted routes | `/[locale]`: 195 750 B       | **+95 B** on each; `/[locale]`: 195 845 B |
| all JS under `.next/static`, raw (hooks off)          | 4 985 697 B                  | 4 985 933 B (+236 B)                      |
| CSS under `.next/static`                              | 67 663 B                     | 67 663 B                                  |
| boot check; `boot` tier                               | `{"ok":true,"db":true}`; 4/4 | the same                                  |

No ceiling in `perf.budgets.json` moves; headroom stays between 8.5 % and
9.4 %. `/fr` and `/en` still carry the `app/[locale]` card, and a refused boot
looks as it did (three 500s from `/api/health`, the process alive,
`/tree-drawings.json` and a chunk still served).

**On a started server**, 44 requests to 39 URLs — pages, guides, the 404s, the
two card routes, the bike routes, `/_next/image` — answered alike on a fresh
build of each release, line for line: status, content type, byte count,
`Location` and `x-nextjs-cache`.

**One thing changed, on disk.** An entry a self-hosted server caches on demand
used to be written beside the prerendered files
(`.next/server/app/fr/guides/<slug>/opengraph-image.body`); 16.3.8 writes it
under `.next/server/route-cache/APP_ROUTE/<sha256 of the owning route>/$/…`.
What the build prerenders is where it was, and nothing in this repository
reads the other kind.

**Not proved by a local run:** the browser tiers. `bash scripts/ci.sh` and the
hooks-on `scripts/ci/build.sh` passed on the result; e2e, perf and Lighthouse
were not run, and their jobs on the pull request are the first to put 16.3.8
in front of a browser.

## Thirteen advisories of 2026-10-20 and 21

Thirteen ids entered the feed between 2026-10-20 14:36Z and 2026-10-21
19:54Z, against four packages. Every one sits under a developer tool.
Nothing ran `audit` on `main` until #27 was merged: run 39784476611, on
`0ad0982`, at 2026-10-22 13:10:05Z, 46 h 34 min after the first id. That run's
`npm audit (audit-ci)` job was its only failure. `trivy`, which gates on HIGH
and CRITICAL, passed. This is the same gap §2.7 of `.debug/017` records for
2026-10-07. Measured on `main`'s lockfile, `npm audit` names 25 packages under
nineteen ids, the six in the array and these thirteen. **None is allow-listed.**
Each has a patched release its parent can reach, so each is fixed, by the rule
at the top of this file.

| In the feed (UTC)   | Advisory            | CVE             | Severity | Package and range                                                        | Fixed by                      |
| ------------------- | ------------------- | --------------- | -------- | ------------------------------------------------------------------------ | ----------------------------- |
| 2026-10-20 14:36:11 | GHSA-5r4p-p66f-jhc7 | CVE-2026-111757 | moderate | `hono >=4.12.4 <4.13.11`: `serveStatic` decodes the path twice           | `hono` 4.13.7 → 4.13.13       |
| 2026-10-20 18:26:30 | GHSA-6prh-2h8m-c8cw | CVE-2026-111769 | moderate | `@modelcontextprotocol/sdk <1.32.0`: client transports follow redirects  | the SDK pin, 1.31.0 → 1.32.0  |
| 2026-10-20 18:26:54 | GHSA-22jm-h49p-29qw | CVE-2026-111767 | high     | `@modelcontextprotocol/sdk >=1.24.0 <1.32.0`: tasks not session-bound    | the SDK pin                   |
| 2026-10-20 18:30:24 | GHSA-698v-4r3x-3vcv | CVE-2026-112943 | moderate | `launch-editor`, bundled in `vite >=8.2.0 <=8.2.3`                       | the `vite` pin, 8.2.2 → 8.2.4 |
| 2026-10-20 19:43:36 | GHSA-rvq5-wwqv-78pq | CVE-2026-111771 | moderate | `@modelcontextprotocol/sdk >=1.6.0 <1.32.0`: bearer token audience       | the SDK pin                   |
| 2026-10-20 19:48:25 | GHSA-587h-7wmj-h5pm | CVE-2026-112942 | high     | `launch-editor`, bundled in `vite >=8.2.0 <=8.2.3`                       | the `vite` pin                |
| 2026-10-20 19:51:52 | GHSA-r825-w8mm-5pxw | CVE-2026-112944 | moderate | `launch-editor`, bundled in `vite >=8.2.0 <=8.2.3`                       | the `vite` pin                |
| 2026-10-20 20:06:35 | GHSA-46jr-4wx8-v453 | CVE-2026-111768 | high     | `@modelcontextprotocol/sdk >=1.3.0 <1.32.0`: one request exhausts memory | the SDK pin                   |
| 2026-10-21 16:47:15 | GHSA-vfpm-58rq-9qcg | CVE-2026-112947 | moderate | `vite >=8.2.0 <=8.2.3`: four bytes outside `server.fs`                   | the `vite` pin                |
| 2026-10-21 16:47:42 | GHSA-rq7h-c2jc-7f22 | CVE-2026-112946 | moderate | `vite >=8.2.0 <=8.2.3`: files outside `server.fs.allow`                  | the `vite` pin                |
| 2026-10-21 16:48    | GHSA-9jrq-w75r-8gcw | —               | low      | `vite >=8.2.0 <=8.2.3`: cross-origin script through custom middleware    | the `vite` pin                |
| 2026-10-21 19:48:38 | GHSA-xp26-3454-mjgp | CVE-2026-112950 | moderate | `@vitest/mocker >=4.1.11 <4.1.12`: Windows backslash traversal           | `vitest` 4.1.11 → 4.1.12      |
| 2026-10-21 19:54:26 | GHSA-qxg6-89mg-rqv8 | CVE-2026-112949 | moderate | `@vitest/mocker <4.1.12`: unauthenticated manual mock registration       | `vitest` 4.1.11 → 4.1.12      |

“In the feed” is `github_reviewed_at`. The low one is below the threshold
`audit-ci.json` fails at, so it never failed the gate, and the `vite` pin
clears it with the others. Three of the `vite` ids name `launch-editor`, which
is not in `node_modules`: `vite` bundles it into its own `dist`.

The four moves, each by the rule that fits its shape:

- **`@modelcontextprotocol/sdk`**: the exact override moves 1.31.0 → 1.32.0,
  the lowest release that clears all four (note above). Renovate's #33 proposes
  the same move, with `package.json` only and no lockfile change. This change
  carries both.
- **`hono`** is reached through the SDK (`^4.11.4`) and `@hono/node-server`
  (peer `^4`). Both ranges admit the fix, and the newest release they admit,
  4.13.13, was published on 2026-10-04 and is past the hold. So
  `npm update hono` is the whole fix: no override.
- **`vite`**: an exact override at 8.2.4, because `npm update` would take a
  release inside the hold (note above).
- **`vitest` and `@vitest/coverage-v8`**, 4.1.11 → 4.1.12 together: one pin,
  as `renovate.json`'s `vitest` group says, and both are direct
  `devDependencies`, so they are bumped, not overridden. `vitest@4.1.12` pins
  `@vitest/mocker` to 4.1.12, the first patched release for both ids. Those
  three were published on 2026-10-15 between 14:39Z and 14:51Z. At the bump,
  2026-10-22 about 13:45Z, they were 6 d 23 h old, about an hour short of the
  hold. They are the lowest releases that clear the two ids, so waiting for the
  hold would only have kept `main` red longer: the hold's own waiver for a
  security response.

**The lockfile moves thirteen entries**, and its count is 1898 before and
after: `@modelcontextprotocol/sdk`, `hono`, `vite`, `vitest`,
`@vitest/coverage-v8`, the seven other `@vitest/*` packages (`expect`,
`mocker`, `pretty-format`, `runner`, `snapshot`, `spy`, `utils`), and `chai`. `chai` moves 6.2.2 → 6.3.0, which
no advisory names: `@vitest/expect@4.1.12` declares `^6.2.2`, as 4.1.11 does,
and npm takes the newest release when it re-resolves the range. 6.3.0 was
published on 2026-09-30, past the hold.

### How the lockfile was resolved: one change at a time

Resolved in ONE `npm install` with all four changes in `package.json`, npm
11.13.0 moved **thirty** entries, not thirteen. The extra seventeen were
`rolldown` 1.2.8 → 1.2.15 with its fifteen `@rolldown/binding-*` packages, and
`@oxc-project/types` 0.149.0 → 0.155.0. `rolldown` 1.2.15 was published on
2026-10-21, one day before, and `@oxc-project/types` 0.155.0 on 2026-10-19.
That is seventeen packages inside the hold that nothing asked for:
`vite` 8.2.4 declares `rolldown: ~1.2.4`, as 8.2.2 does, and 1.2.8 satisfies
it.

Each change on its own, applied with `npm install --package-lock-only` to
`main`'s lockfile, left `rolldown` at 1.2.8. Applied in sequence on the same
lockfile — the `vite` override, the SDK pin, the `vitest` pair, then
`npm update hono` — the result is the thirteen entries above, with a
`package.json` identical to the one-step attempt. That sequenced lockfile is
the one committed, installed with `npm ci`. **Read the lockfile diff of a
security change before trusting it**: the advisory names four packages, and
the one-step install would have brought in seventeen others published in the
week the hold exists for.

### Gates

On the result, 2026-10-22:

- `bash scripts/ci/audit.sh` exits 0, with the six allow-listed ids and
  nothing else.
- `bash scripts/ci/trivy.sh` is clean.
- `bash scripts/ci.sh` passed 12/12 in 491 s. That includes 4 369 unit, ui and
  security tests and 474 integration tests on `vitest` 4.1.12; coverage at
  95.56 % of statements and 92.18 % of branches; and the boot tier 4/4.
- `ast-v8-to-istanbul`, which reads the `c8 ignore` / `v8 ignore` hints for
  `@vitest/coverage-v8`, stays at 1.0.6.

**Not run:** e2e, perf, Lighthouse and the hooks-on build. None of them loads
`vite`, `vitest`, the SDK or `hono`.

## Seven advisories of 2026-10-22, two of them critical on `next`

Seven ids entered the feed on 2026-10-22 between 15:50Z and 16:43Z. Three are
on `next`, which ships: **two critical, unauthenticated remote code
execution**, and one high. Nothing ran `audit` on `main` until #34 was merged:
run 39925596793, on `97707a9`, at 2026-10-23 08:34:24Z, 16 h 44 min after the
first id. Its `npm audit (audit-ci)` and `trivy fs scan` jobs both failed: the
same gap as on 2026-10-07 and 2026-10-20 (`.debug/017` §2.7). **None is
allow-listed**: `next` is a shipped direct dependency, and the other two have
a patched release their parents can reach.

| In the feed (UTC)   | Advisory            | CVE             | Severity | Package and range                                                                             | Fixed by                      |
| ------------------- | ------------------- | --------------- | -------- | --------------------------------------------------------------------------------------------- | ----------------------------- |
| 2026-10-22 15:50:34 | GHSA-p3m5-59mp-jv5r | CVE-2026-94482  | high     | `next >=16.0.0 <=16.4.0`: denial of service in the App Router through Server Actions          | `next` 16.3.8 → 16.4.1        |
| 2026-10-22 15:52:53 | GHSA-2464-fhr4-w9xw | —               | critical | `next >=16.0.0 <=16.4.0`: unauthenticated RCE in the Image Optimization API with SVG files    | `next` 16.4.1                 |
| 2026-10-22 16:19:39 | GHSA-rxp7-6hxx-x8q5 | CVE-2026-111997 | moderate | `ip-address <=10.7.3`: quadratic zone-id matching in `Address6`                               | `ip-address` 10.7.2 → 10.7.4  |
| 2026-10-22 16:36:50 | GHSA-9qmh-m7c6-f92p | CVE-2026-114144 | high     | `toml <=5.0.0`: CPU DoS through unbounded integer literals in `toml.parse()`                  | the `toml` override, `^5.0.1` |
| 2026-10-22 16:38:06 | GHSA-9j65-hcg3-gc64 | CVE-2026-114143 | high     | `toml <=5.0.0`: quadratic DoS through long dotted keys or table paths                         | the `toml` override           |
| 2026-10-22 16:38:44 | GHSA-4qx8-w7c3-pj3p | CVE-2026-114141 | high     | `toml <=5.0.0`: quadratic DoS through many array-of-tables headers                            | the `toml` override           |
| 2026-10-22 16:42:31 | GHSA-673q-mjm6-r5xr | —               | critical | `next >=16.0.0 <=16.4.0`: unauthenticated RCE in `use cache` functions returning typed arrays | `next` 16.4.1                 |

“In the feed” is `github_reviewed_at`. `trivy` gates on HIGH and CRITICAL and
went red with `audit` on `main`.

**Exposure, as read on 2026-10-23, and not what decided the fix.** No file in
`app/`, `lib/` or `components/` holds `"use cache"`, and none imports
`next/image`. But `next.config.ts` configures `images` (`remotePatterns` for
`lh3.googleusercontent.com`, the Google avatars), so the optimizer's route
exists. Server Actions are the app's write path, so the DoS applies as
written. Whether Vercel serves `/_next/image` through Next's own handler was
not checked. The pin moves whatever the answer: a shipped direct dependency is
bumped.

The three moves:

- **`next` and `eslint-config-next` 16.3.8 → 16.4.1**, together, a minor.
  16.4.1 is the first patched release for all three ids, published on
  2026-10-14T17:43Z, 8 d 15 h before the bump: past the hold. 16.4.2 (10-15)
  fixes nothing this tree needs.
- **`toml`**: the unscoped override `^4.2.0` → `^5.0.1`, a major. The
  compatibility note is with the table at the top of this file. 5.0.1 was
  published on 2026-10-12, past the hold.
- **`ip-address`** 10.7.2 → 10.7.4 by `npm update ip-address`. It is a dev
  dependency, reached only through `shadcn` (`@modelcontextprotocol/sdk >
express-rate-limit`, and `socks`), and both ranges (`^10.2.0`, `^10.1.1`)
  admit 10.7.4, the newest release, published on 2026-10-11. No override.

**The lockfile moves fourteen entries**, each change applied on its own with
`--package-lock-only` as the section above recommends: the twelve of the Next
family (`next`, `eslint-config-next`, `@next/env`, `@next/eslint-plugin-next`
and the eight `@next/swc-*` binaries — the same twelve as on 2026-09-30 and
2026-10-09), then `toml`, then `ip-address`. Nothing else moved.

**What a minor of the framework was checked against.** Unlike 16.3.6 → 16.3.8,
all four files the facts in `instrumentation.ts` rest on differ:
`router-server.js`, `start-server.js`, `bin/next` and
`instrumentation-globals.external.js`. `next-server.js` still swallows a
rejected `prepare()` with `.catch(…)`. So the facts were measured again by
behaviour, not by identity. The boot tier passed 4/4 on a fresh build of this
tree, but its refusal case also passes on a server that EXITS, so the refusal
was measured directly too, with `next start` on that build,
`VERCEL_ENV=production` and `ENABLE_TEST_PAGES=1`: "Ready", then "Failed to
prepare server" naming `ENABLE_TEST_PAGES`; 500 on `/api/health` three times,
`/fr`, `/fr/connexion`, `/robots.txt`, `/sitemap.xml` and `/favicon.ico`; 200 on
`/tree-drawings.json`; and the process still alive — the shape measured on
16.3.6 and 16.3.8. The fourth fact, the held request, was not re-polled.
`scripts/ci/build.sh`'s build printed `●` for `/fr` and `ƒ` for
`/[locale]/velo/[id]`, `bundle-guard` checked 61 files with no problem, and the
budget held.

### Gates

On the result, 2026-10-23:

- `bash scripts/ci/audit.sh` exits 0 three runs out of three, with the six
  allow-listed ids and nothing else.
- `bash scripts/ci/trivy.sh` is clean.
- `bash scripts/ci.sh` passed 12/12 in 192 s: 4 369 unit, ui and security
  tests and 474 integration tests; coverage at 95.56 % of statements and
  92.18 % of branches; the build, `bundle-guard` and the budget; the boot tier
  4/4.

**e2e found one change, and it was fixed in the page.** On the pull request's
first run, `guides-filter.spec.ts` "for my bike" failed on three Chromium
legs: on 16.4.1 the router applies a `replaceState` to `useSearchParams` up
to 133 ms after the click, and React puts the controlled checkbox back in the
meantime. `GuideFilters` now keeps the query it wrote until
`useSearchParams` moves (`.debug/017` §2.7, CLAUDE.md "URL state"). In
`npm run e2e:docker` the spec then passed every "for my bike" run; perf and
Lighthouse ran green in CI on the first commit.

## Ten advisories of 2026-10-23, one of them on `zod`, which ships

Ten ids entered the feed on 2026-10-23 between 18:26Z and 22:14Z, against
five packages, and one left it: GitHub withdrew the `braces` advisory at
12:53Z. One of the five ships: **`zod`**, the validator the server actions,
the guest import's contract and the environment contract are written in. The
scheduled check is what read them on `main`: its run of 2026-10-24 at 09:37Z
and issue #39 are as reported to this branch, not read here. Measured on this
branch at 16:28Z, on a fresh `npm ci` of `main`'s `e4011fd`:
`bash scripts/ci/audit.sh` exits 1 on seven ids, `npm audit` names 18
packages under fifteen ids, and `trivy` (database of 2026-10-24 07:11Z) finds
one id outside the array, `zod` 4.5.4 as CVE-2023-54404. **The shipped `zod`
is bumped, and nothing is allow-listed by id.** Two dev-only copies of zod 3
have no patched release and are allow-listed by **path** (“`zod@3.25.76`,
two dev-only copies”, above).

| In the feed (UTC)   | Advisory            | CVE             | Severity | Package and range                                                                           | Answer                                                         |
| ------------------- | ------------------- | --------------- | -------- | ------------------------------------------------------------------------------------------- | -------------------------------------------------------------- |
| 2026-10-23 18:26:50 | GHSA-mrhx-c7xc-m3w5 | CVE-2023-54404  | high     | `zod <4.6.6`: memory exhaustion validating oversized constrained collections                | `zod` 4.5.4 → 4.6.6; two `zod@3.25.76` copies by path          |
| 2026-10-23 20:53:11 | GHSA-27r3-jxmh-p828 | CVE-2026-111181 | high     | `body-parser <1.20.9`, `>=2.0.0 <2.4.0`: DoS through trailing bytes after a compressed body | `npm update`: 1.20.9 and 2.4.0, **inside the hold**            |
| 2026-10-23 21:36:40 | GHSA-333x-w4r6-6crp | CVE-2026-110725 | low      | `fast-uri >=3.0.0 <3.1.9`: scheme injection through a first-segment colon                   | `npm update`: 3.1.9, **inside the hold**                       |
| 2026-10-23 21:37:59 | GHSA-wjr9-j795-jxcr | CVE-2026-110180 | moderate | `fast-uri >=3.1.3 <3.1.9`: host confusion in WHATWG host canonicalisation                   | the same                                                       |
| 2026-10-23 21:39:34 | GHSA-xhq7-xmqj-769h | CVE-2026-110095 | low      | `fast-uri >=3.0.0 <3.1.9`: path equivalence in relative-reference normalisation             | the same                                                       |
| 2026-10-23 21:41:36 | GHSA-w74x-v6f9-j3xg | CVE-2026-110306 | moderate | `fast-uri >=3.0.0 <3.1.9`: scheme spoofing through percent-encoded decoding                 | the same                                                       |
| 2026-10-23 22:09:52 | GHSA-m5mm-p8h7-m29v | CVE-2026-115897 | low      | `serialize-javascript <7.1.3`: XSS through an unescaped `</script` in a function body       | **not taken** (below)                                          |
| 2026-10-23 22:12:57 | GHSA-f72v-6w45-q472 | CVE-2026-109841 | moderate | `undici >=7.15.0 <7.30.1`, `>=8.0.0 <8.12.2`: SRI bypass through non-lowercase tokens       | 7.30.1 by `npm update`; 8.12.2 by an exact override on `jsdom` |
| 2026-10-23 22:13:29 | GHSA-4qv8-2p9j-2685 | CVE-2026-109924 | moderate | `undici >=7.0.0 <7.30.1`, `>=8.0.0 <8.12.2`: unbounded memory in the EventSource parser     | the same                                                       |
| 2026-10-23 22:14:31 | GHSA-xjj6-f33q-929c | CVE-2026-109869 | high     | `undici >=7.18.0 <7.30.1`, `>=8.0.0 <8.12.2`: DoS through excessive content-encodings       | the same                                                       |

“In the feed” is `github_reviewed_at` (`gh api /advisories/<id>`). For nine
of the ten it equals `published_at`; GHSA-mrhx-c7xc-m3w5 was published on
2026-10-01 and reviewed on 2026-10-23, which is when `npm audit` began to
report it. The three low ids fail no gate here (`audit-ci.json` fails at
`moderate`). `trivy` gates on HIGH and CRITICAL and scans the production tree
only (“`zod@3.25.76`, two dev-only copies”), so of the ten it reported `zod`.

The moves, each by the rule that fits its shape:

- **`zod` 4.5.4 → 4.6.6**, the exact pin kept (`npm install zod@4.6.6
--save-exact`). A shipped direct dependency is bumped — never overridden,
  never allow-listed. 4.6.6 is the first patched release, published
  2026-10-11T16:18Z, 13 d old: past the hold. 4.6.7 (2026-10-12) fixes nothing
  the advisory names. What changed, and what was checked, is below.
- **`undici`**: the 7.x copies under `shadcn` and `@dotenvx/dotenvx` by
  `npm update undici`, to 7.30.1, the newest 7.x and 9 d 2 h old; `jsdom`'s
  8.x copy by an exact, scoped override at 8.12.2, because `npm update` takes
  8.12.3, five days old (the compatibility note under the overrides table).
- **`body-parser`** by `npm update body-parser`: 1.20.9 under `@lhci/cli`'s
  `express@4.22.2` (`~1.20.5`), 2.4.0 under the SDK's `express@5.2.1`
  (`^2.2.1`). Each is the first patched release and the newest of its line,
  and each is two days old — inside the hold, taken on the maintainer's ruling
  (“The hold, skipped on a ruling”, below).
- **`fast-uri`** by `npm update fast-uri`: 3.1.9, the one copy, under four
  `ajv@8` (`^3.0.1`). First patched and newest; four days old, inside the
  hold, on the same ruling.
- **`serialize-javascript`**, low: **not taken**. Both releases that clear it
  are inside the hold — 7.1.3 until 2026-10-29T21:24Z, 7.1.4 until
  2026-10-30T14:53Z — and a low id fails no gate, so nothing is delayed and
  the waiver does not apply: `CLAUDE.md` says it “is not a licence to skip the
  hold when nothing is delayed”. It is also the one of the five that runs in
  the production build: `@content-collections/core`, a `dependencies` entry,
  declares `^7.0.5`, which admits both. `npm update serialize-javascript` once
  the release it takes has aged through the hold.
- **`braces`**, GHSA-vfj7-8cjw-p6xm: **removed from the array**. The advisory
  was withdrawn on 2026-10-23 at 12:53:02Z (`withdrawn_at`), and `npm audit`
  no longer reports it: on this tree, audit-ci run with `--show-not-found` and
  the old array prints “Consider not allowlisting advisory:
  GHSA-vfj7-8cjw-p6xm.” `audit-ci.json` sets `show-not-found: false`, so a dead
  entry says nothing — the reason it is removed rather than left: re-published,
  the advisory turns `audit` red and somebody decides. Its section below is
  kept, with the date.

### `zod` 4.5.4 → 4.6.6: what changed, and what this tree uses

Read from the two tarballs (`npm pack zod@4.5.4 zod@4.6.6`, each `integrity`
equal to the registry's), and measured where it says so:

- **The fix** is a `capSize` wrapper on `$ZodArray`, `$ZodMap` and `$ZodSet`
  (`src/v4/core/schemas.ts`): a container larger than its smallest size cap
  fails that check before any element is parsed. Measured with 100 000 numbers
  against `z.array(z.string()).max(10)`: 100 001 issues on 4.5.4, **one** on
  4.6.6 (and 100 001 on both `zod@3.25.76` copies). Without a cap the count is
  100 000 on every copy, 4.6.6 included: the release bounds a constrained
  collection, not an unconstrained one. `z.record` has no such wrapper.
- **Packaging**: the `exports` map is identical, and `package.json` differs by
  the version, one build flag (`sealCjsExports`) and its scripts; neither
  release has a dependency. **No runtime export is removed** from `zod`,
  `zod/mini`, `zod/v4`, `zod/v4/core` or `zod/v3`. Added, by entry point:
  six to `zod` and `zod/v4` (`INVALID`, `ZodIBAN`, `ZodInstanceOf`,
  `currencyCode`, `iban`, `withParser`); five to `zod/mini` (the same, with
  `ZodMiniIBAN` and no `ZodInstanceOf`); ten to `zod/v4/core`; none to
  `zod/v3` (measured: the keys of each entry point, loaded with `require` from
  each tarball). `maxLength`, `minLength`, `minValue`, `maxValue`, `isInt` and
  `format` are no longer own enumerable properties of a schema, and are still
  readable (measured); nothing here reads them.
- **Behaviour changes read in the diff**: `safeParse` builds its `error` on
  the first read of that property; checks no longer fill the internal
  `_zod.bag` when attached; an ambiguous discriminator value throws; and
  `validate` / `validateAsync` stop at the first aborting issue. Nothing in
  `app/`, `lib/`, `components/`, `scripts/` or `prisma/` reads `_zod` or
  `.bag`, calls `z.validate`, or builds a discriminated union.
- **Formats** (`src/v4/core/regexes.ts`, and `$ZodURL`). The **`email`**
  pattern is rewritten, and the sign-up action validates with `z.email()`
  (`app/[locale]/(auth)/inscription/actions.ts`): the local part's
  `^(?!\.)(?!.*\.\.)([A-Za-z0-9_'+\-\.]*)[A-Za-z0-9_+-]@` became
  `^(?:[A-Za-z0-9_'+\-]+\.)*[A-Za-z0-9_'+\-]*[A-Za-z0-9_+-]@`, the domain
  part unchanged but for a non-capturing group. Read, the two describe the same strings — no leading dot,
  no two dots in a row, a last character before the `@` that is neither a dot
  nor an apostrophe; the old whole-string `(?!.*\.\.)` never had a pair to
  find in the domain, whose labels each start with a letter or a digit — and
  the new one says it without lookaheads. Measured, `z.email()` from each
  tarball over 39 146 835 generated strings — every local part of 0 to 7
  characters over `a.'+-_9Z` before each of 14 domains (`x..co`, `.x.co`,
  `x-.co`, `x.co@y.co` among them), and every string of 0 to 11 characters
  over `a.@'` — accepts 5 949 114 on 4.5.4, and 4.6.6 gives the same answer
  for every one. The exported **`regexes.base64url`** is tightened (a length
  of 1 modulo 4 is now refused by the regex; `z.base64url()` already refused
  it on 4.5.4 — the same verdicts on both tarballs, measured in review) and
  so is **`emoji`** (one pictograph, regional indicator or
  keycap is now required); nothing here calls `z.base64url()` or `z.emoji()`
  — `lib/auth/tokens.ts`'s `base64url` is Node's `Buffer`, not zod's. A bare
  **`z.url()`**, `lib/env.ts`'s, now asks `URL.canParse` instead of
  constructing a `URL` (read); measured on twelve inputs, `localhost:3000`
  and `http:example.com` among them, it gives the same verdict and the same
  output on both.
- **Objects**: a key whose `.default()` resolves to `undefined` is now present
  in the output — `z.object({ u: z.string().optional().default(undefined) })`
  parses `{}` to `{}` on 4.5.4 and to `{ u: undefined }` on 4.6.6 (measured).
  The only `.default()` calls here are `lib/env.ts`'s, whose defaults are
  `false`, `"development"` and `12`; a schema of those three shapes parses
  `{}` to the same object on both (measured).
- **What this tree pins about zod, measured again on 4.6.6**: an own
  `__proto__` key in a `z.record` is skipped, and on a `strictObject` refused,
  in classic zod and in `zod/mini`, exactly as on 4.5.4. The four comments that
  said “verified against the installed zod 4.5.4” (`lib/guest/schema.ts`,
  `tests/integration/build-lists.test.ts`, two in
  `tests/security/guest-import.test.ts`) now name both.
- **The tiers, run once the five lockfile changes below were in, and before
  any document changed**: `tsc` clean; unit and security 2 810 tests, ui and
  bike3d 1 134, integration 474, all green. The bundle, with `zod/mini` in it,
  is under “Gates”.

**Exposure, for the record: it was fixed without an exposure argument**,
because it ships. It did apply. `importGuestStateAction` runs `withUser`, then
the 256 KB budget, then `parseGuestState`, and only then the rate limiter. The
contract's outer shape — `strictObject`, `bikes: z.array(…)` with
`.check(z.maxLength(10))` — handed `{ version: 2, bikes: Array(100000).fill(0) }`,
200 023 bytes of JSON, inside that budget and inside `next.config.ts`'s
`serverActions.bodySizeLimit` of `512kb`, made 100 001 issues on 4.5.4's
`zod/mini` and one on 4.6.6's; `parseGuestState` itself, on the installed
4.6.6, returns one issue for that payload (measured). So a signed-in request
could have the server allocate a hundred thousand issue objects, every time,
before any bucket was consumed.

**What the bump does not bound: a record.** 4.6.6 stops a capped array, map
or set at its cap before its elements are parsed. The contract's records — a
checkup's `answers`, `symptoms` and `notes`, a line's `refinement` — are held
to their count by `maxEntries`, a `z.refine`: a check, which runs once every
entry has been parsed, and is skipped once an entry has failed. So a record
whose entries each fail still costs one issue per entry, on 4.6.6 as on
4.5.4, and what bounds it is the 256 KB budget, not the cap. Measured on
2026-10-24: one checkup whose `answers` hold 32 928 entries of `0` under
base-36 keys, `{ version: 2, bikes: [{ checkups: [{ answers }] }] }`, is
262 144 bytes, exactly the budget, and `parseGuestState` on the installed
4.6.6 returns 32 939 issues in 35 to 43 ms (four runs); a record schema of
the same shape in `zod/mini`, capped by a refine at 250, makes 32 928 issues
from each tarball, 4.5.4 and 4.6.6 alike. Linear in the budget — as the
capped array of before the bump was, 100 001 issues for 200 023 bytes on
4.5.4: the two differ by a constant factor, not in kind — but not one issue
either. Nor does 4.6.6 bound the case the advisory's own DESCRIPTION opens
with, a collection with no length constraint at all (its table above quotes
the summary): an uncapped array still costs one issue per failing element
(measured unchanged above).

**And the shipped actions' records have no entry cap at all.** Three server
actions parse a `z.record` from a signed-in request, with no count of any
kind and no rate limiter in front, inside the 512 KB body limit
(`next.config.ts`): `updateBikeFitAction`'s `fit`
(`app/[locale]/velo/[id]/reglages/actions.ts`), `updateBikePartAction`'s
`attributes` (`app/[locale]/velo/[id]/actions.ts`) and the list's
`refinement` (`app/[locale]/velo/[id]/liste/actions.ts`, whose 24 is
counted after the parse; read). Measured in review on 2026-10-24, on schemas
copied verbatim from the first two: a `fit` of 57 221 entries of `""` under
base-36 keys, 524 279 bytes of JSON, makes 57 221 issues in 37 ms; the same
keys as `attributes`, each value `{}` (a failing three-way union), 57 221 in
124 ms — on 4.6.6 and on the 4.5.4 tarball alike. Bounded by the body limit
and linear in it, so not a dependency problem, and no part of this bump.
Counting a record's keys before its entries are parsed, as `capSize` does
for an array, is in `docs/backlog.md` (“A request's records are counted
after their entries are parsed”); it is a change to the schemas, not to the
dependency, and is not made here.

### The hold, skipped on a ruling

| Release                          | Published (UTC)  | Age at the bump (2026-10-24 16:45Z) | Clears the advisory             | Clears the 7-day hold          |
| -------------------------------- | ---------------- | ----------------------------------- | ------------------------------- | ------------------------------ |
| `zod` 4.6.6                      | 2026-10-11 16:18 | 13 d 0 h                            | yes (first patched)             | yes                            |
| `undici` 7.30.1                  | 2026-10-15 14:18 | 9 d 2 h                             | yes (first patched, newest 7.x) | yes                            |
| `undici` 8.12.2                  | 2026-10-15 15:05 | 9 d 1 h                             | yes (first patched)             | yes                            |
| `undici` 8.12.3 — not taken      | 2026-10-19 14:02 | 5 d 2 h                             | yes                             | no, until 2026-10-26 14:02     |
| `qs` 6.16.1 (new, under the SDK) | 2026-10-14 22:06 | 9 d 18 h                            | — (no advisory names it)        | yes                            |
| **`body-parser` 1.20.9**         | 2026-10-22 11:38 | **2 d 5 h**                         | yes (first patched, newest 1.x) | **no, until 2026-10-29 11:38** |
| **`body-parser` 2.4.0**          | 2026-10-22 11:39 | **2 d 5 h**                         | yes (first patched, newest 2.x) | **no, until 2026-10-29 11:39** |
| **`fast-uri` 3.1.9**             | 2026-10-19 23:05 | **4 d 17 h**                        | yes (first patched, newest 3.x) | **no, until 2026-10-26 23:05** |

The three in bold are in the lockfile inside the hold, **on the maintainer's
ruling of 2026-10-24**, and this is the record of why — a decision, not an
oversight, and not a precedent:

- _Something was delayed._ `audit` is a required check: it has been red on
  `main` since the scheduled run, and on every pull request with it. Waiting
  for 2026-10-29 would have kept every change out for five more days. That is
  the delay the waiver (`vulnerabilityAlerts.minimumReleaseAge: null`) exists
  to remove, and the lowest-release rule still chose the versions: only the
  date was waived.
- _The reach is dev-only_ (below): neither Express listens, and `fast-uri`
  resolves the URIs of schemas its packages ship.
- _What was checked in place of the hold_ (measured): each lockfile entry's
  `integrity` equals the registry's `dist.integrity`; all three were published
  from GitHub Actions with a SLSA provenance attestation, and the audit of
  signatures (`npm audit signatures`) exits 0 on the resolved tree: 1 698
  registry signatures and 567 attestations verified, these three among them
  (its JSON output, with attestations included, lists each). None is a new
  package. The one new entry, `qs` 6.16.1, is past the hold, and carries a
  registry signature but no attestation.

**Exposure**, read and measured:

- **`body-parser`** needs a server that parses a compressed request body.
  Neither Express here listens (the `qs` paragraph under “Lighthouse CI
  chain”): LHCI's is the static fallback server `lighthouserc.cjs` never
  configures, the SDK's belongs to HTTP transports `shadcn` never imports.
  Measured all the same, both Express copies started in-process on
  `127.0.0.1:0` with their own `json()` and `urlencoded()`: a plain and a
  gzip-compressed JSON body and a nested form each round-trip, on 1.20.9 with
  `qs` 6.16.0 and on 2.4.0 with `qs` 6.16.1. `@lhci/cli`'s
  `fallback-server.js` loads.
- **`fast-uri`** is `ajv@8`'s URI resolver for `$id` and `$ref`. Its four
  `ajv` copies sit under the SDK, `ajv-formats`, `conf` (`@dotenvx/dotenvx`,
  under `shadcn`) and `@prisma/streams-local` (`prisma dev`, never run here);
  each validates its own package's schemas. Measured on the first three: a
  cross-document `$ref` resolves and validates as before.
- **`undici`**: `jsdom/lib/api.js` requires it at load, so the Vitest `ui`
  tier runs on 8.12.2; `shadcn`'s 7.30.1 is its registry client. Measured:
  eight `shadcn` commands — `--version`, `info --json`, `view button`,
  `search @shadcn -q button --json`, `add button --dry-run`, and `info` and
  `add --dry-run` against an invalid `components.json` — give byte-identical
  output and the same exit codes before and after this change; `view`,
  `search` and `add` fetch the registry through it. `shadcn --version` prints
  `4.21.0`.

### How the lockfile was resolved: one change at a time

Each change made by npm in the worktree, then `npm ls <pkg>` and the audit,
and the lockfile diff read after each:

1. `npm install zod@4.6.6 --save-exact` — one entry, `zod` 4.5.4 → 4.6.6.
2. `"jsdom": { "undici": "8.12.2" }` in `overrides`, then `npm install` — one
   entry, `undici` 8.10.2 → 8.12.2 (`npm explain`: `overridden
undici@"8.12.2" (was "^8.9.0") from jsdom@30.0.1`). Run alone on a scratch
   copy, `npm update undici` had moved it to 8.12.3.
3. `npm update undici` — two entries, the 7.x copies 7.29.1 → 7.30.1.
4. `npm update body-parser` — two entries, 1.20.8 → 1.20.9 and 2.3.0 → 2.4.0,
   and **one added**, `@modelcontextprotocol/sdk/node_modules/qs` 6.16.1:
   2.4.0 declares `qs ^6.16.1` where 2.3.0 declared `^6.15.2`. The SDK's
   `express@5.2.1` (`qs ^6.14.0`) resolves the nested copy too, so it leaves
   `qs@6.15.3` — and with it, one of the two paths the `qs` entries were
   written for (“Lighthouse CI chain”).
5. `npm update fast-uri` — one entry, 3.1.8 → 3.1.9.

Eight entries move and one is added, 1898 → 1899. Nothing else moved.

### Gates

On the result, 2026-10-24:

- `bash scripts/ci/audit.sh` exits 0 three runs of three (17:22Z), the five
  ids the array names by id found, the three path entries matched; run with
  `--show-not-found`, audit-ci reports no entry unused.
- `bash scripts/ci/trivy.sh` is clean: `deepmerge-ts` accepted, nothing else
  found.
- `bash scripts/ci.sh` passed 12/12 in 172 s: 3 944 unit, ui, bike3d and
  security tests and 474 integration tests; coverage at 95.57 % of statements
  and 92.22 % of branches; the build, `bundle-guard` (61 files) and the
  budget; the boot tier 4/4. The route table prints `●` for `/fr`, `/en` and
  every guide, `ƒ` for `/[locale]/velo/[id]` and its sub-routes.
- First-load JS, gzip, against its ceiling in `perf.budgets.json`:
  `/[locale]` 195 870 B of 216 064, `/[locale]/velo/[id]` 248 971 of
  275 456, `/controle` 221 596 of 244 736, `/liste` 242 380 of 269 312; every
  budgeted route is 9 to 10 % under.
- The hooks-on build (`ENABLE_TEST_PAGES=1 NEXT_PUBLIC_TEST_HOOKS=1 bash
scripts/ci/build.sh`, `bundle-guard` 63 files), then
  `npx playwright test --project=desktop-chromium` on `guest-import.spec.ts`,
  `checkup-partial.spec.ts` and `auth-signup.spec.ts` — `zod/mini` in the
  browser, classic `zod` in the actions: 44 passed, FR and EN.
- `bash scripts/ci/renovate-config.sh`: valid. `npx shadcn --version`: 4.21.0.
  `npm audit signatures`: exit 0.

**Not run:** perf, Lighthouse, the other e2e specs and the other Playwright
projects. `lhci autorun` loads `body-parser` 1.20.9 through LHCI's Express when
it starts; the `lighthouse` job on the pull request is its first run.

## Removed from the array (2026-09-30)

Seven ids left the allowlist because the vulnerable version is no longer in the
tree — see the `overrides` table above. If any of them comes back, the `audit`
job goes red, which is the point: GHSA-82x6-q7mm-w9cf, GHSA-v5mp-jgw5-2x6j
(`toml`), GHSA-w5hq-g745-h8pq (`uuid`), GHSA-ph9p-34f9-6g65,
GHSA-52f5-9888-hmc6 (`tmp`), GHSA-3f6p-5ww8-9rcr, GHSA-rgwj-5xj2-c3m3
(`mysql2`).

**2026-10-24**: GHSA-vfj7-8cjw-p6xm (`braces`) left it too, for a different
reason: GitHub withdrew the advisory on 2026-10-23 at 12:53:02Z, and audit-ci
then reported the entry unused (“Ten advisories of 2026-10-23”). Its section
below is kept, dated.

## `braces`, through three dev-tool glob chains — no patched release

**Withdrawn, and removed from the array on 2026-10-24.** GitHub withdrew
GHSA-vfj7-8cjw-p6xm on 2026-10-23 at 12:53:02Z (`withdrawn_at`, read with
`gh api /advisories/GHSA-vfj7-8cjw-p6xm`), and `npm audit` stopped reporting
it. What follows is the entry's reason as written on 2026-10-06, kept for the
record.

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
