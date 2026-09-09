# Audit allowlist

Every advisory id in the `allowlist` array of [`audit-ci.json`](./audit-ci.json) is
justified below. **Re-evaluate quarterly, or whenever the upstream fix lands.**

Rule of thumb used here: an advisory is allow-listed only when the vulnerable
package is (a) a transitive dependency of a _developer_ tool, (b) never bundled
into the deployed application, and (c) only ever fed inputs that we control
(our own repository files, our own Lighthouse runs). Anything reachable from a
request handler is fixed, never allow-listed.

Baseline recorded on 2026-09-09 with Node 24.16.0 / npm 11.13.0.

## Prisma CLI chain — dev-only, never bundled

The `prisma` CLI (migrations, `generate`, `db seed`) drags in a generic driver
and config layer. The application itself talks to Postgres through
`@prisma/adapter-pg` + `pg`, and `serverExternalPackages` keeps the CLI out of
every server bundle.

- **GHSA-ggr8-5vv4-36mx** — `deepmerge-ts` stack exhaustion on recursive object
  graphs. Path: `prisma > @prisma/config > deepmerge-ts`. The only object graph
  merged is our own `prisma.config.ts`. No attacker input.
- **GHSA-3f6p-5ww8-9rcr** — `mysql2` auth-plugin downgrade leaks plaintext
  credentials. Path: `prisma > mysql2`. We use PostgreSQL exclusively; the MySQL
  connector is never loaded.
- **GHSA-rgwj-5xj2-c3m3** — `mysql2` unbounded zlib inflate (decompression-bomb
  DoS). Same path, same reasoning: no MySQL connection is ever opened.

## Lighthouse CI chain — dev/CI-only, runs against our own URLs

`@lhci/cli` pulls in Puppeteer, Express and an interactive prompt library. It
runs only in the `lighthouse` CI job and in `npm run lhci`, against URLs that
this repository declares in `lighthouserc.cjs`.

- **GHSA-jmr9-qjv8-65gv** and **GHSA-7pqw-9j4j-h8q3** — `extract-zip` symlink
  path traversal / arbitrary file write. Path: `@lhci/cli > lighthouse >
puppeteer-core > @puppeteer/browsers > extract-zip`. The only archive
  extracted is the Chromium build downloaded from Google's own CDN — and in CI
  we set `CHROME_PATH` to the browser already present in the Playwright
  container, so no download happens at all.
- **GHSA-52f5-9888-hmc6** and **GHSA-ph9p-34f9-6g65** — `tmp` arbitrary write /
  path traversal through an unsanitised `dir`, `prefix` or `postfix`. Path:
  `@lhci/cli > inquirer > external-editor > tmp` and `@lhci/cli > lighthouse >
tmp`. Those parameters are hard-coded by the libraries; nothing user-supplied
  reaches them.
- **GHSA-x5fp-wj9c-mxmx** and **GHSA-4mjr-xmp4-gh2g** — `qs` array-limit bypass
  and `isBuffer` DoS. Path: `@lhci/cli > express > qs`. The Express server here
  is the ephemeral LHCI report server bound to localhost during a CI job; it is
  never exposed.
- **GHSA-w5hq-g745-h8pq** — `uuid` missing buffer bounds check in v3/v5/v6 when
  a `buf` argument is provided. Paths: `@lhci/cli` and
  `@content-collections/mdx > mdx-bundler > uuid`. Neither caller passes `buf`.

## MDX build pipeline — build-time only, inputs are repository files

`@content-collections/mdx` compiles `content/**/*.mdx` at build time. The only
input is content committed to this repository and reviewed in a pull request.

- **GHSA-82x6-q7mm-w9cf** — `toml` uncontrolled recursion. Path:
  `@content-collections/mdx > mdx-bundler > remark-mdx-frontmatter > toml`.
- **GHSA-v5mp-jgw5-2x6j** — `toml` prototype pollution via a `__proto__`
  key path. Same path. Our frontmatter is YAML, not TOML, so the TOML parser is
  not even reached; and `scripts/content-check.ts` validates every frontmatter
  block against a zod schema before the build runs.

## What is **not** allow-listed

Anything in `dependencies` that ships to the server or the browser: `next`,
`react`, `react-dom`, `next-auth`, `@auth/prisma-adapter`, `@prisma/client`,
`@prisma/adapter-pg`, `pg`, `bcryptjs`, `zod`, `three` and the React Three
Fiber stack. An advisory on any of those blocks the pipeline until it is fixed.
