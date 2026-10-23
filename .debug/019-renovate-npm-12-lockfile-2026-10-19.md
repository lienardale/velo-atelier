# 019 — Renovate's PRs carried `package.json` alone: npm 12 refuses this tree under `--package-lock-only`

**Date** 2026-10-19 · **Status** fixed in `renovate.json`, not yet observed on
Renovate; the automerge finding at the end is open · **Touches**
`renovate.json`, `CLAUDE.md`

## Symptom

PR #28, "fix(deps): update dependency next to v16.3.8 [security]" — Renovate
44.164.1, branch `renovate/npm-next-vulnerability`, head `64e3ebd`, opened
2026-10-17T07:25:54Z — is one commit that changes one line of `package.json`
and nothing else. Its CI run (39013603559) was red on nine jobs within 46 s.
Eight of them (`audit`, `content`, `typecheck`, `lint`, `unit`, `integration`,
`build`, `coverage`) stop at `npm ci`:

```
npm error code EUSAGE
npm error `npm ci` can only install packages when your package.json and package-lock.json or npm-shrinkwrap.json are in sync. Please update your lock file with `npm install` before continuing.
npm error Invalid: lock file's next@16.3.6 does not satisfy next@16.3.8
npm error Invalid: lock file's @next/env@16.3.6 does not satisfy @next/env@16.3.8
npm error Invalid: lock file's @next/swc-darwin-arm64@16.3.6 does not satisfy @next/swc-darwin-arm64@16.3.8
… and the same for the seven other @next/swc-* packages
```

The ninth, `trivy`, is the same failure seen from the other side: it scans
the lockfile, which still pins `next` 16.3.6, and reports CVE-2026-94483 (HIGH,
fixed in 16.3.8) — the advisory the PR exists to fix.

## Investigation

### 1. What Renovate said

Renovate posted an "Artifact update problem" comment on the PR two seconds
after opening it. It retries that step only when a package file changes, the
branch conflicts, or someone ticks the rebase box:

```
##### File name: package-lock.json
npm warn Unknown env config "store". This will error in a future major version of npm. …
npm error code EALLOWREMOTE
npm error Fetching packages of type "remote" have been disabled
npm error Refusing to fetch "https://registry.npmjs.org/@tailwindcss/oxide-wasm32-wasi/-/oxide-wasm32-wasi-4.3.3.tgz"
```

So Renovate did run `npm install --package-lock-only`, it failed, and Renovate
committed the `package.json` edit anyway. (The `store` warning is Renovate
passing `npm_config_store` through for pnpm; it is harmless.)

### 2. Which npm, and why it refused

- **Renovate installs a chosen npm only when the repository names one.** Read
  in Renovate 44.164.1's `lib/modules/manager/npm/post-update/npm.ts` and
  `utils.ts`: the constraint comes from `constraints.npm`, then `devEngines`,
  `volta`, `packageManager` or `engines.npm` in `package.json`, then the
  lockfile version (only v1 and v2 imply one). This repository named none —
  `engines` has `node` only, `lockfileVersion` is 3 — so npm was left out of
  the tool list and the hosted runner's own npm ran.
- **That npm was 12.x — inferred, not read from Renovate's log.** pacote's
  check says "have been disabled" only when `allow-remote` is `none` (with
  `root` it says "non-root"). npm/cli's `definitions.js` defaults `allow-remote`
  to `all` up to v11.21.1 and to `none` from v12.0.0 (published 2026-07-08,
  `latest` on npm since). Nothing here sets it: there is no `.npmrc`, and
  Renovate's npm code does not set it either. The Mend job log would show the
  version; it is behind the maintainer's sign-in and was not read.
- **npm 12's exception for registry tarballs misses this code path.** In
  arborist 12.2.0, `reify.js` passes `allowRemote: 'all'` for a tarball on the
  configured registry (its own comment: pacote "re-parses our `name@URL` spec as
  type=remote, so allowRemote would mis-fire on registry tarballs").
  `build-ideal-tree.js` does not. Under `--package-lock-only` (or `--dry-run`)
  arborist builds a _complete_ tree, and for any package that declares
  `bundleDependencies` it calls `pacote.extract(node.resolved, …)` to read the
  bundle — a full URL, so type `remote`, so refused. The same code is in
  v12.2.1 and on npm's default branch. Upstream: npm/cli#9800, open, which
  names `@tailwindcss/oxide-wasm32-wasi` and `--package-lock-only`.

### 3. Why this tree trips it every time

`@tailwindcss/oxide-wasm32-wasi` (an optional dependency of
`@tailwindcss/oxide`, `cpu: ["wasm32"]`, never installed here) is the only
lockfile entry with `bundleDependencies` — six of them — and the lockfile holds
none of the bundled packages (no `inBundle` entries). Arborist queues every
node with a missing edge before it starts, so it opens this package on every
run, whatever is being bumped.

### 4. Reproduction

Renovate's command, `npm install --package-lock-only --no-audit --ignore-scripts`,
on scratch copies of `package.json` and `package-lock.json`. npm 12.2.0 was
installed into a scratch prefix; the repository was not touched:

| npm                           | input                                                                  | result                                                                                                                         |
| ----------------------------- | ---------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| 11.13.0 (Node 24.16.0)        | `64e3ebd`'s `package.json` + `main`'s lockfile                         | exit 0; exactly the 10 entries CI named move to 16.3.8 (`next`, `@next/env`, 8 × `@next/swc-*`); `npm ci --dry-run` accepts it |
| 12.2.0                        | same                                                                   | `EALLOWREMOTE`, the URL Renovate printed                                                                                       |
| 12.2.0                        | `main` unchanged, nothing bumped                                       | `EALLOWREMOTE`                                                                                                                 |
| 12.2.0, `--allow-remote=all`  | `64e3ebd`'s `package.json`                                             | exit 0, the same 10 entries                                                                                                    |
| 11.13.0, `--before=<7 d ago>` | `main`, lockfile-only `pg@8.23.1` (the shape of a non-security branch) | exit 0; `npm ci --dry-run` accepts it                                                                                          |

The control — `64e3ebd`'s files as committed — gives CI's `EUSAGE` under
`npm ci --dry-run`. CI itself ran Node 24.21.0 with npm 11.19.0.

### Ruled out

- **The root `overrides` block** (`toml`, `uuid`, `tmp`, `mysql2`,
  `basic-ftp`, `@modelcontextprotocol/sdk`, `js-yaml@^3` → `argparse`): every
  passing row above keeps it unchanged.
- **The Node pin**: Renovate reads `.nvmrc` (24) for Node; the refusal is
  npm's, not Node's.
- **`postUpdateOptions`, `lockFileMaintenance`, the `matchDepTypes` rules**:
  none sets anything on this code path. Lock-file maintenance deletes the
  lockfile and rebuilds it with the same flag, so it fails the same way
  (inferred from arborist's code, not run).

## Root cause

npm 12 defaults `allow-remote` to `none` and, under `--package-lock-only`,
fetches a package with `bundleDependencies` by its tarball URL without the
exception it grants registry tarballs during a real install (npm/cli#9800).
This lockfile always holds such a package, and `renovate.json` did not pin
npm, so the hosted runner's npm 12 failed every lockfile update and Renovate
committed `package.json` alone.

It is systematic, and the second Renovate PR showed it: #33,
"update dependency @modelcontextprotocol/sdk to v1.32.0 [security]", opened
2026-10-22 13:22Z, changed the `overrides` pin in `package.json` and nothing
else, and its "Artifact update problem" comment is the same `EALLOWREMOTE` on
the same `oxide-wasm32-wasi` tarball. Renovate autoclosed it on 2026-10-23
08:36Z, like #28, once `main` no longer needed it. On 2026-10-20 the
dependency dashboard (#11) listed 33 more branches that rewrite the lockfile —
32 updates and lock-file maintenance. GitHub Actions, Docker and
`customManagers` updates do not touch the lockfile and are unaffected.

## Fix

`renovate.json`: `"constraints": { "npm": "^11" }`, and a second entry in the
top-level `description` (an array of strings is allowed there) saying why.
npm 11 is the major Node 24 bundles and the one CI's `npm ci` reads the
lockfile with. With a constraint set, Renovate puts npm in its tool list and
installs the newest matching release.

Not chosen:

- A committed `.npmrc` with `allow-remote=all`: CLAUDE.md forbids a committed
  `.npmrc`, and it would loosen a security default for every `npm` run in the
  repository, not only Renovate's.
- `engines.npm` or `devEngines` in `package.json`: Renovate reads them too, but
  they reach every developer's npm.
- An exact version: Renovate does not apply `minimumReleaseAge` to the npm it
  installs, so `^11` takes the newest 11.x (11.21.1 on 2026-10-19, four days
  old). An exact pin would honour the hold, but nothing would ever bump it
  without a `customManagers` entry like the validator's. Before this change the
  runner used an unpinned npm 12, so `^11` narrows the exposure rather than
  widening it.

Checked: `bash scripts/ci/renovate-config.sh` (valid; its "Config migration
necessary" warning, `fileMatch` → `managerFilePatterns`, is identical on
`main`), Prettier, `npx vitest run --project unit tests/unit/ci` (42/42).

Not yet seen working on Renovate, and #28 will not show it: PR #27 brought
`next` 16.3.8 to `main` on 2026-10-22, and Renovate closed #28 as
"autoclosed" the same day (13:22Z). The first Renovate branch that touches the
lockfile after this lands — the dashboard listed 33 — should carry a
`package-lock.json` change.

## How to detect a regression

No test pins the constraint. A Renovate PR whose diff has no
`package-lock.json` is this again; its "Artifact update problem" comment names
the npm error. To check a lockfile against npm 12 by hand, from a scratch copy
of `package.json` and `package-lock.json`:

```bash
npx --yes npm@12.2.0 install --package-lock-only --no-audit --ignore-scripts
```

It exits 1 with `EALLOWREMOTE` while npm/cli#9800 is open and the lockfile
holds `@tailwindcss/oxide-wasm32-wasi`. When that changes, or when `.nvmrc`
moves to a Node that bundles npm 12, revisit the constraint.

## Found on the way, not fixed: patch automerge overrides every `automerge: false`

#28's body says "🚦 **Automerge**: Enabled." Renovate applies every matching
`packageRules` entry in order, and a later one overrides an earlier one. The
last entry, "Patch updates are automerged on a branch", matches every patch
update to `dependencies` or `devDependencies` and sets `automerge: true`. So it
overrides the `automerge: false` of the groups above it — `next + react`,
`prisma`, `next-auth`, `three-stack`, `vitest`, `playwright`,
`content-collections` — whenever the update is a patch. Read from the config
and #28's body; Renovate's resolved config was not read.

Why it matters once lockfiles are fixed: a patch branch whose checks go green
may be merged by Renovate without review. #28 was the sharpest case — a
vulnerability PR is never grouped, so `next` would have moved without
`eslint-config-next`, against the rule that the two are one pin — and it is
gone (autoclosed, above). The rule still covers the next one, and every
grouped patch: `prisma` 7.10.1 and `vitest` 4.1.12 were on the dashboard on
2026-10-20, both groups marked `automerge: false`. Moving the patch rule above
the group rules is the maintainer's call.
