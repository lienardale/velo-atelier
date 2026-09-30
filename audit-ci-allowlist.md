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

Baseline recorded on 2026-09-30 with Node 24.16.0 / npm 11.13.0.

## Pinned through `overrides` instead of allow-listed

These four are **fixed**, not tolerated. Each parent's declared range excludes
the patched version, so npm needs the override to reach it; each was proved by
a green `bash scripts/ci.sh` and a green `npm run build` on the resolved tree.

| Override          | Resolves to | Replaces       | Fixes                                    | Reached through                                                            |
| ----------------- | ----------- | -------------- | ---------------------------------------- | -------------------------------------------------------------------------- |
| `toml: ^4.2.0`    | 4.3.0       | 3.0.0          | GHSA-82x6-q7mm-w9cf, GHSA-v5mp-jgw5-2x6j | `@content-collections/mdx > mdx-bundler > remark-mdx-frontmatter > toml`   |
| `uuid: ^11.1.1`   | 11.1.1      | 9.0.1 / 8.3.2  | GHSA-w5hq-g745-h8pq                      | `@content-collections/mdx > mdx-bundler`, `@lhci/cli`                      |
| `tmp: ^0.2.6`     | 0.2.7       | 0.1.0 / 0.0.33 | GHSA-ph9p-34f9-6g65, GHSA-52f5-9888-hmc6 | `@lhci/cli`, `@lhci/cli > inquirer > external-editor`                      |
| `mysql2: ^3.22.0` | 3.24.5      | 3.15.3         | GHSA-3f6p-5ww8-9rcr, GHSA-rgwj-5xj2-c3m3 | `prisma > mysql2` (optional MySQL driver; this project is PostgreSQL only) |

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
- `tmp@0.2.x` keeps `fileSync`/`dirSync`; 0.2.6 is the release that sanitises
  `prefix`/`postfix`, which is the fix itself.
- `mysql2` is never loaded — the override only stops the advisory tracking a
  version we do not run.

Three more advisories (`brace-expansion` ×3, `ip-address` ×2, `fast-uri`)
appeared in dev-tool chains (`eslint > minimatch`, `shadcn`, `ajv`) whose
declared ranges already admit the patched releases: those needed no override,
only a lockfile bump (`npm update brace-expansion ip-address fast-uri`).

## Prisma CLI chain — dev-only, never bundled

The `prisma` CLI (migrations, `generate`, `db seed`) drags in a generic driver
and config layer. It is a `devDependency`; npm marks its subtree `prod` in the
lockfile only because `@prisma/client` declares an optional peer on it. The
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
  `^6.14.0` and would take it, but npm resolves one `qs` for both, so a global
  override hands LHCI's Express a minor it never shipped with. Not worth it for
  two servers that never listen. What would change the answer: an `express@4`
  release whose range reaches `qs@6.16`, or a `qs` in something that handles a
  real request.

## What is **not** allow-listed

Anything in `dependencies` that ships to the server or the browser: `next`,
`react`, `react-dom`, `next-auth`, `@auth/prisma-adapter`, `@prisma/client`,
`@prisma/adapter-pg`, `pg`, `bcryptjs`, `zod`, `three` and the React Three
Fiber stack. An advisory on any of those blocks the pipeline until it is fixed.

## Removed from the array (2026-09-30)

Seven ids left the allowlist because the vulnerable version is no longer in the
tree — see the `overrides` table above. If any of them comes back, the `audit`
job goes red, which is the point: GHSA-82x6-q7mm-w9cf, GHSA-v5mp-jgw5-2x6j
(`toml`), GHSA-w5hq-g745-h8pq (`uuid`), GHSA-ph9p-34f9-6g65,
GHSA-52f5-9888-hmc6 (`tmp`), GHSA-3f6p-5ww8-9rcr, GHSA-rgwj-5xj2-c3m3
(`mysql2`).
