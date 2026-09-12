# Contributing to vélo-atelier

Thanks for wanting to help people fix their own bikes.

**Language policy.** `README.md` is bilingual (FR + EN). Everything else in the
repository — code, comments, commit messages, issues, pull requests, these docs
— is in **English**, so that contributors who do not read French can work here.
**Vous pouvez écrire en français** dans une issue ou une PR si c'est plus simple
pour vous : quelqu'un traduira. The _content_ (`content/**`) is the exact
opposite: French is written first and English is mandatory before merge.

---

## Getting set up

```bash
nvm use                 # Node 24 (.nvmrc)
npm ci                  # never `npm install`, never --legacy-peer-deps
cp .env.example .env.local
npm run db:setup        # Docker Postgres + migrate + seed  (Docker must be running)
npm run dev             # http://localhost:3000
```

The seeded demo account is printed by `npm run db:setup`; it is also in
`prisma/seed-data.ts`, which the e2e fixtures import so the two can never drift.

## Before you push

```bash
npm run ci:local        # the exact scripts CI runs (scripts/ci/*.sh)
```

`ci:local` is what `.husky/pre-push` runs, minus `next build`. A step whose
target does not exist yet prints `SKIP` — that is expected while the repository
is still being built out, and it is never silent.

| Knob                     | Effect                                                           |
| ------------------------ | ---------------------------------------------------------------- |
| `SKIP_BUILD=1`           | skip `next build` (the pre-push default; CI always builds)       |
| `SKIP_DB=1`              | skip the integration tier when Docker is not running             |
| `SKIP_SECURITY=1`        | skip gitleaks / audit-ci / semgrep / trivy — never before a push |
| `STEPS="lint typecheck"` | run a subset                                                     |

Browser suites are deliberately not in `ci:local`: they need a production build
and several minutes. Run them explicitly.

```bash
ENABLE_TEST_PAGES=1 npm run build && npm run e2e
npm run e2e:docker             # the full suite in the amd64 container
```

## Branches and commits

- Branch from `main`: `feat/decision-tree-help`, `fix/checkup-abandon`,
  `docs/retailers`.
- Conventional commits, scope required:
  `feat(checkup): mark a step as skipped`, `fix(bike3d): …`, `test(e2e): …`,
  `docs(guides): …`, `chore(deps): …`.
- One logical change per PR. A refactor and a behaviour change in the same diff
  cannot be reviewed.
- `main` is protected: linear history, no force-push, every required check green.

## What CI will hold you to

- **ESLint + Prettier + `tsc --noEmit`.** No warnings suppressed without a
  comment saying why.
- **Coverage ≥ 80 %** overall, **100 % on `lib/domain/**`** and on the branches
  of `lib/checkup/**`. The gate is `vitest run --coverage` exiting non-zero, not
  a report someone reads.
- **Both locales.** Every user-facing string exists in `messages/fr/<ns>.json`
  _and_ `messages/en/<ns>.json`, with the same ICU placeholders.
  `tests/unit/i18n/messages-parity.test.ts` fails naming the missing keys.
- **Playwright** on desktop, Pixel 7, landscape, 320 px wide and with WebGL
  disabled. Mobile is not an afterthought here: the target user is holding a
  phone in a garage.
- **Security tier**: gitleaks, audit-ci, semgrep, trivy, CodeQL, plus
  `tests/security/**` (IDOR, mass assignment, CSRF, open redirect, rate limits,
  path traversal, quotas…).

## Rules that are enforced mechanically

Learn these three early; they are the ones that surprise people.

1. **No logic in `components/bike3d/parts/**`.** No `if`, no ternary, no `&&`
   rendering, no loops, no `switch`. Those components are declarative meshes.
   Every decision — which parts exist, where they sit, which variant to draw —
   belongs in `lib/bike3d/**`, where it is unit-testable without a WebGL
   context. ESLint enforces it with `no-restricted-syntax`.
2. **Messages are keys, never strings.** A server action returns
   `errors.invalidCredentials`, and the form renders `t(code)`. French strings
   in TypeScript are a bug.
3. **Import navigation from `@/lib/i18n/navigation`**, never from `next/link`
   or `next/navigation`, or the locale prefix is lost.

## Adding a guide

```bash
npm run content:new          # scaffolds content/guides/<slug>/{fr,en}.mdx
npm run content:check        # validates frontmatter, partIds, reasons, tools
```

- Write **French first**, then English. A guide without both is not merged.
- `kind` is one of `check | replace | clean | adjust | measure` — the field is
  always `kind`, never `type`.
- Every `partId` must exist in `lib/domain`; every `KoConsequence` must point at
  a guide whose `kind` matches its `action` (`fix` maps to an `adjust` guide).
- Say what tools are needed **and their alternatives**. "You need a torque
  wrench" stops a beginner; "a torque wrench, or go slowly and check the marked
  value at a shop" does not.
- Anything involving hydraulic bleeding, wheel truing, bearing replacement or a
  motor/battery is an `inspect-shop` outcome, not a guide. Send people to a
  mechanic rather than to A&E.

## Adding a user-facing string

1. Add the key to `messages/fr/<namespace>.json` **and** `messages/en/<namespace>.json`.
2. Namespaces are files; a new one is appended to `lib/i18n/namespaces.ts`.
3. next-intl keys are leaves: a key is either a string or an object, never both,
   and an id that becomes a key segment never contains a `.`.

## Visual baselines and performance

- Screenshot baselines are byte comparisons produced on amd64 Linux. Regenerate
  them with `npm run e2e:update-snapshots` (the container) or the `perf.yml`
  workflow, never from a laptop's own browser.
- A PR touching `tests/e2e/__screenshots__/**` must carry the
  **`visual-baseline`** label — a human saying they looked at every image.
- A PR touching `lib/bike3d/**` or `components/bike3d/**` must carry
  **`perf-verified`**: run `RUN_LOCAL_PERF=1 npm run perf:local` on a real GPU
  and link the generated `.perf/local-<date>.json` in the PR description. CI's
  frame times come from a software rasteriser and cannot answer that question.

## Reporting a problem

- A guide that is wrong or dangerous: open a **Guide error** issue. Please say
  which bike and which step.
- A security issue: **do not** open an issue — see [SECURITY.md](./SECURITY.md).

## Licences

Code is MIT. Everything under `content/` is CC BY-SA 4.0. By contributing you
agree your work is published under the licence of the directory it lands in.
