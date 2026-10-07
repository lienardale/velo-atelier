# vélo-atelier 0.1.0

**En bref.** Première version publique de vélo-atelier, un site libre et
bilingue (français d'abord, anglais) pour entretenir soi-même son vélo : on
l'identifie en quelques questions, on le retrouve en 3D pièce par pièce, on le
contrôle, puis on repart avec la liste de ce qu'il faut réparer et des liens
simples vers trois boutiques. 47 guides dans les deux langues, dont 26
complets ; tout fonctionne sans compte. En ligne sur
[velo-atelier.vercel.app][site] depuis le 29 septembre 2026. La suite est en
anglais, comme le reste de la documentation du dépôt.

First public release. vélo-atelier is an open-source, bilingual (French first,
English) website for people who maintain their own bike: identify the bike,
check it part by part, and leave with a list of what to fix and what to buy. It
runs at [velo-atelier.vercel.app][site], in production since 2026-09-29.

## What's in it

- **Identify your bike.** The home page is a decision tree of up to 16
  questions, one per screen. Each has an "I don't know" that takes the most
  common answer, and a drawing of where to look on your own bike; the tree
  carries 54 line drawings.
- **A 3D bike, every part selectable.** A parametric model generated in code
  from your answers: 48 parts in 11 systems, 36 drawn and 12 (pads, tubes,
  cables…) reached through the part that carries them. Without WebGL it is a
  clickable SVG outline. The [demo bike][demo] needs no account.
- **Guides.** 47, each in French and English: 13 check, 13 replace, 6 clean,
  10 adjust, 5 measure. 26 are complete, every check and measure guide among
  them; the other 21 give the main steps only, and say so. 14 more drawings,
  and a catalogue of 34 tools, 20 of them with a stand-in.
- **Checkup and to-fix list.** A checkup, on the whole bike or on selected
  parts, walks through the check guides step by step and can be resumed. Its
  result is one to-fix list per bike (replace, fix, clean, adjust, take to a
  shop), which later checkups add to.
- **Buying help.** For a part to replace: questions that narrow it down,
  compatibility warnings (53 rules), brands in three tiers, and plain links to
  Rose Bikes, Alltricks and Decathlon, with no affiliate id and no tracking.
  The [shop page][shop] has 11 categories and a free-text box.
- **Fit.** Per bike, up to 8 measurements (saddle height and setback, reach,
  bar drop, cleats, tyre pressure, sag, chain wear), with a saddle height
  worked out from your inseam and tyre pressures from rider and bike weight.
- **Accounts, guest mode, import.** Everything works without an account, kept
  in the browser. An account (e-mail and a password of at least 12 characters,
  or Google) keeps up to 20 bikes across devices and imports the bike prepared
  as a guest, with its to-fix list.
- **French and English.** Every screen and every guide in both languages, at
  localized addresses: 1 680 interface strings per language, kept in step by
  [a test][parity-test]. No analytics, no cookie banner.

## How it is built and checked

Next.js 16.3.6 (App Router), React 19 and TypeScript 5.9 on Node 24; next-intl
4, Tailwind 4, React Three Fiber 9, Prisma 7.10 on PostgreSQL 16, Auth.js v5.
Hosted on Vercel (Paris) and Neon (Frankfurt). Guides and bike data live in the
repository; the database holds user data only. What the repository enforces,
and where:

- **Merge gate.** 20 required checks on `main`, administrators included,
  listed in [`tests/unit/ci/required-checks.test.ts`][required-checks].
- **Tests.** 3 552 Vitest tests at the last merge; 42 Playwright spec files, in
  both languages, on desktop, on a phone (portrait, landscape, 320 px wide) and
  without WebGL. Coverage in [`vitest.config.ts`][vitest-config]: 80 % overall,
  100 % on `lib/domain` (the bike rules) and on the statements and branches of
  `lib/checkup`.
- **Accessibility.** [`tests/e2e/a11y.spec.ts`][a11y-spec] runs axe on seven
  pages and the open mobile menu, in both languages, light and dark: zero
  serious or critical violations.
- **Performance.** [`lighthouserc.cjs`][lighthouserc], eight URLs as a phone,
  median of three runs. Content pages: performance ≥ 0.85, LCP ≤ 2.5 s, TBT
  ≤ 300 ms, CLS ≤ 0.1, accessibility ≥ 0.95. 3D pages: performance ≥ 0.69, LCP
  ≤ 3 s, TBT ≤ 1 100 ms. On 2026-10-06 production's performance score was 0.93
  on `/fr` and `/en` and 0.96 on a guide page.
  [`perf.budgets.json`][perf-budgets] caps first-load JavaScript on nine routes.
- **Security.** Every signed-in server action checks the origin, then the
  session ([`lib/actions/with-user.ts`][with-user]), and another user's bike
  answers 404; [`tests/security/`][security-tests] has 24 test files. The
  Content-Security-Policy allows no `eval` in production
  ([`lib/security/csp.ts`][csp]). Sign-in is limited to 10 attempts per 15
  minutes per address, sign-up to 5 per hour
  ([`lib/security/rate-limit.ts`][rate-limit]).
- **Environment contract.** [`lib/env.ts`][env] is applied during the Vercel
  build, before any migration ([`scripts/check-env.ts`][check-env]), and again
  at every server start ([`instrumentation.ts`][instrumentation]).
- **Scanning.** gitleaks, `audit-ci`, semgrep, trivy and CodeQL are five of the
  20 checks. `audit-ci` fails from moderate up, and its six exceptions are
  justified in [`audit-ci-allowlist.md`][audit-allowlist]. CodeQL has no open
  alert (2026-10-07).

## Known limits

Deliberately not in 0.1.0; [`docs/backlog.md`][backlog] has the reason for
each. Eight of them are open issues, linked here.

- No password reset by e-mail: there is no mailer yet ([#18][i18]), which is
  also why sign-up says when an address is already registered.
- A static Content-Security-Policy that keeps `'unsafe-inline'` for scripts
  ([#19][i19]).
- Rate-limit counters in Postgres rather than a dedicated store ([#20][i20]).
- No text search in the guides, only filters ([#21][i21]), and no glossary
  ([#22][i22]).
- No affiliate programme: the retailer links earn nothing ([#23][i23]).
- One shared database for preview deployments ([#24][i24]), and no Docker
  `seed` profile ([#25][i25]).
- 21 of the 47 guides are outlines, and jobs that need a workshop (hydraulic
  bleeding, wheel truing, bearing replacement, motor and battery service)
  appear only as "take it to a shop".
- The 3D model has no dedicated variant for hub or coaster brakes, folding
  bikes, front-hub motors, 13-speed drivetrains or tubular tyres, and its
  default view is a mirror image of a real bike ([`docs/bike3d.md`][bike3d]).
- Metric units only, no CSV export, no passkeys, no admin interface.
- Two performance targets are missed: the home page's first-load JavaScript is
  capped at 211 KiB gzip for a 130 KiB target, and the 3D page's Lighthouse
  blocking time at 1 100 ms for 600 ms.

## Licence

Code is [MIT][license]. The content under `content/` is
[CC BY-SA 4.0][content-license]. Vendored material is listed in
[`THIRD_PARTY_NOTICES.md`][notices].

## Contributing

[`CONTRIBUTING.md`][contributing] covers the setup, the local gates and how to
add a guide; issues and pull requests may be written in French. Vulnerabilities
are reported privately ([`SECURITY.md`][security]). Thanks to the projects this
is built on, and to SecLists for the common-password list.

[site]: https://velo-atelier.vercel.app
[demo]: https://velo-atelier.vercel.app/en/bike/demo
[shop]: https://velo-atelier.vercel.app/en/shop
[backlog]: https://github.com/lienardale/velo-atelier/blob/main/docs/backlog.md
[bike3d]: https://github.com/lienardale/velo-atelier/blob/main/docs/bike3d.md
[contributing]: https://github.com/lienardale/velo-atelier/blob/main/CONTRIBUTING.md
[security]: https://github.com/lienardale/velo-atelier/blob/main/SECURITY.md
[license]: https://github.com/lienardale/velo-atelier/blob/main/LICENSE
[content-license]: https://github.com/lienardale/velo-atelier/blob/main/content/LICENSE
[notices]: https://github.com/lienardale/velo-atelier/blob/main/THIRD_PARTY_NOTICES.md
[parity-test]: https://github.com/lienardale/velo-atelier/blob/main/tests/unit/i18n/messages-parity.test.ts
[required-checks]: https://github.com/lienardale/velo-atelier/blob/main/tests/unit/ci/required-checks.test.ts
[vitest-config]: https://github.com/lienardale/velo-atelier/blob/main/vitest.config.ts
[a11y-spec]: https://github.com/lienardale/velo-atelier/blob/main/tests/e2e/a11y.spec.ts
[lighthouserc]: https://github.com/lienardale/velo-atelier/blob/main/lighthouserc.cjs
[perf-budgets]: https://github.com/lienardale/velo-atelier/blob/main/perf.budgets.json
[with-user]: https://github.com/lienardale/velo-atelier/blob/main/lib/actions/with-user.ts
[security-tests]: https://github.com/lienardale/velo-atelier/tree/main/tests/security
[csp]: https://github.com/lienardale/velo-atelier/blob/main/lib/security/csp.ts
[rate-limit]: https://github.com/lienardale/velo-atelier/blob/main/lib/security/rate-limit.ts
[env]: https://github.com/lienardale/velo-atelier/blob/main/lib/env.ts
[check-env]: https://github.com/lienardale/velo-atelier/blob/main/scripts/check-env.ts
[instrumentation]: https://github.com/lienardale/velo-atelier/blob/main/instrumentation.ts
[audit-allowlist]: https://github.com/lienardale/velo-atelier/blob/main/audit-ci-allowlist.md
[i18]: https://github.com/lienardale/velo-atelier/issues/18
[i19]: https://github.com/lienardale/velo-atelier/issues/19
[i20]: https://github.com/lienardale/velo-atelier/issues/20
[i21]: https://github.com/lienardale/velo-atelier/issues/21
[i22]: https://github.com/lienardale/velo-atelier/issues/22
[i23]: https://github.com/lienardale/velo-atelier/issues/23
[i24]: https://github.com/lienardale/velo-atelier/issues/24
[i25]: https://github.com/lienardale/velo-atelier/issues/25
