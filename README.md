# vélo-atelier

[![CI](https://github.com/lienardale/velo-atelier/actions/workflows/ci.yml/badge.svg)](https://github.com/lienardale/velo-atelier/actions/workflows/ci.yml)

## 🇫🇷 Français

**vélo-atelier** est un site public et bilingue (français par défaut, anglais)
qui apprend à contrôler, réparer, nettoyer et régler son propre vélo.

1. **L'accueil est un arbre de décision visuel** (transmission, pratique, taille
   de roue, freins, pédales…). Chaque question a une réponse par défaut
   « Je ne sais pas » et une aide visuelle pour vérifier sur son propre vélo.
2. **Le résultat est un vélo 3D paramétrique** dont chaque pièce est cliquable :
   consulter ou modifier ses informations, ou lancer un **contrôle** (complet ou
   sur une sélection de pièces) qui déroule les gestes, les outils et leurs
   alternatives, et construit une **liste de choses à réparer**.
3. Depuis cette liste : **conseils d'achat** (taille, marque, compatibilité) et
   liens sortants vers Rose Bikes, Alltricks et Decathlon — des liens simples,
   sans affiliation ni suivi.
4. Des guides pour **remplacer**, **nettoyer**, **régler** une pièce, y compris
   la **géométrie et les réglages de position** (quoi mesurer, comment).
5. Compte par e-mail + mot de passe fort, ou Google. Le **mode invité**
   fonctionne sans compte (`localStorage`) ; une fois connecté, un bandeau sur
   « Mes vélos » propose d'importer ce vélo dans le compte (`/import`).

> Site en ligne : _(W5)_ — l'adresse sera publiée au premier déploiement, décrit
> dans [`docs/deploy.md`](./docs/deploy.md).

### Démarrage rapide

Prérequis : [nvm](https://github.com/nvm-sh/nvm) avec Node 24 (`.nvmrc`),
Docker Desktop en cours d'exécution, et `npm` — jamais `pnpm`, `yarn` ni `bun`.

La séquence est celle du critère d'acceptation §4.8 AC1 du plan, telle quelle :

```bash
rm -rf node_modules && env -i PATH="$PATH" HOME="$HOME" npm ci
nvm use && cp .env.example .env.local && npm run db:setup && npm run dev
```

1. La première ligne réussit sans aucun fichier d'environnement : `postinstall`
   ne lance que `prisma generate`, qui n'a pas besoin de base.
2. La seconde démarre Postgres (`docker compose up -d --wait`), applique les
   migrations, charge le jeu de démonstration, puis lance le serveur sur
   <http://localhost:3000>.
3. Connectez-vous avec `DEMO_USER` (ci-dessous) : **3 vélos**, **1 contrôle
   terminé avec exactement 2 points KO**, **1 liste de réparations avec
   2 lignes**.
4. Le seed est idempotent : dans un second terminal, `npm run db:seed` lancé
   deux fois ne change aucun nombre de lignes.

```bash
npm run db:seed
npm run db:seed
npx tsx scripts/db/count.ts   # affiche : users=2 bikes=4
```

Si la base `velo_atelier_test` manque (volume Docker créé avant
`docker/initdb/`), `npm run db:reset` la recrée — en détruisant le volume, donc
aussi les données locales de `velo_atelier`.

### Comptes de démonstration

Créés par le seed (`prisma/seed-data.ts`). Le seed refuse `VERCEL_ENV=production`
et tout hôte de base non local, sauf `ALLOW_REMOTE_SEED=1` explicite
(`lib/db/guard.ts`).

|              | `DEMO_USER` (fr)                                                                                                                    | `DEMO_USER_EN` (en)         |
| ------------ | ----------------------------------------------------------------------------------------------------------------------------------- | --------------------------- |
| E-mail       | `demo@velo-atelier.test`                                                                                                            | `demo-en@velo-atelier.test` |
| Mot de passe | `Demo-Velo-Atelier-2026!`                                                                                                           | `Demo-Velo-Atelier-2026!`   |
| Contenu      | 3 vélos (« Vélo de route », « Gravel », « VTT électrique ») ; sur le Gravel, un contrôle terminé et la liste « Révision printemps » | 1 vélo (« Gravel bike »)    |

Avec `NEXT_PUBLIC_DEMO_LOGIN=1` (déjà dans `.env.example`), la page de connexion
propose un bouton qui remplit `DEMO_USER`.

### Variables d'environnement

La liste commentée est [`.env.example`](./.env.example) ; leur répartition entre
les environnements Vercel est dans [`docs/deploy.md`](./docs/deploy.md).

| Variable                                | En local (`.env.example`) | Sur Vercel                              | Rôle                                                                                         |
| --------------------------------------- | ------------------------- | --------------------------------------- | -------------------------------------------------------------------------------------------- |
| `POSTGRES_URL`                          | Postgres Docker           | les trois environnements                | connexion de l'application (pool) ; `DATABASE_URL` accepté en repli                          |
| `POSTGRES_URL_NON_POOLING`              | Postgres Docker           | les trois environnements                | connexion directe : migrations, seed ; `DATABASE_URL_UNPOOLED` en repli, jamais l'URL poolée |
| `AUTH_SECRET`                           | valeur de développement   | les trois, une valeur par environnement | clé de signature Auth.js, au moins 32 caractères (`npx auth secret`)                         |
| `AUTH_URL`                              | `http://localhost:3000`   | Production seulement                    | origine publique à partir de laquelle Auth.js construit ses URL de retour                    |
| `AUTH_TRUST_HOST`                       | `true`                    | les trois (`true`)                      | faire confiance à l'hôte transmis par le proxy                                               |
| `NEXT_PUBLIC_SITE_URL`                  | `http://localhost:3000`   | les trois environnements                | URL canonique, sitemap, `hreflang`, images OpenGraph — figée au build                        |
| `AUTH_GOOGLE_ID` / `AUTH_GOOGLE_SECRET` | vides (facultatif)        | Production seulement                    | connexion Google ; vides, seul le formulaire e-mail + mot de passe aboutit                   |
| `BCRYPT_COST`                           | `12`                      | non définie (12 par défaut)             | facteur de coût bcrypt, ramené entre 4 et 15 (`.env.test` utilise 4)                         |
| `NEXT_PUBLIC_DEMO_LOGIN`                | `1`                       | **jamais**                              | bouton « compte de démonstration » sur la page de connexion                                  |
| `ENABLE_TEST_PAGES`                     | `1`                       | **jamais**                              | ouvre `/dev/bike3d` et `/dev/bike3d-perf` (lu à chaque requête)                              |
| `NEXT_PUBLIC_TEST_HOOKS`                | `1`                       | **jamais**                              | compile les sondes Playwright `window.__va` dans le bundle (lu au build)                     |
| `ALLOW_REMOTE_SEED`                     | absente                   | **jamais**                              | laisse le seed écrire dans une base non locale                                               |

### Commandes

| Commande                                | Ce qu'elle fait                                                                   |
| --------------------------------------- | --------------------------------------------------------------------------------- |
| `npm run dev`                           | dessins de l'arbre, puis serveur de développement Turbopack sur le port 3000      |
| `npm run build`                         | dessins de l'arbre, contrôle du contenu, puis build de production                 |
| `npm run lint` / `npm run format:check` | ESLint / Prettier                                                                 |
| `npm run typecheck`                     | génère le client Prisma et le contenu, puis `tsc --noEmit`                        |
| `npm run content:check`                 | valide `content/**` (règles structurelles et règles du corpus, `--strict`)        |
| `npm run content:new <kind>-<slug>`     | crée un guide dans les deux langues (voir [`CONTRIBUTING.md`](./CONTRIBUTING.md)) |
| `npm run db:up` / `db:down`             | démarre / arrête le Postgres Docker                                               |
| `npm run db:seed`                       | recharge le jeu de démonstration (idempotent)                                     |
| `npm run db:reset`                      | détruit le volume, puis migrations et seed depuis zéro                            |
| `npm run ci:local`                      | `scripts/ci.sh` : le miroir local de la CI (le hook `pre-push` le lance aussi)    |

### Tests

| Commande                                                                               | Ce qu'elle lance                                                                                                                                                                             |
| -------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `npm test`                                                                             | toute la suite Vitest : `unit`, `ui`, `bike3d`, `integration`, `security` — si rien ne répond sur la base `_test`, `integration` est sauté avec un avertissement                             |
| `npm run test:unit` · `test:ui` · `test:bike3d` · `test:integration` · `test:security` | un seul projet Vitest ; `integration` utilise `velo_atelier_test` (`.env.test`)                                                                                                              |
| `npm run test:coverage`                                                                | Vitest avec la barrière de couverture : 80 % global, 100 % sur `lib/domain/**`, 100 % des instructions et branches de `lib/checkup/**`, et des seuils par dossier                            |
| `npm run e2e -- --project=desktop-chromium`                                            | Playwright sur un build de production, fait d'abord avec `ENABLE_TEST_PAGES=1 NEXT_PUBLIC_TEST_HOOKS=1 npm run build` ; sans `--project`, tous les projets tournent (WebKit et perf compris) |
| `npm run e2e:mobile`                                                                   | les projets mobiles : Pixel 7, paysage, 320 px et WebKit (`npx playwright install webkit` au besoin)                                                                                         |
| `npm run e2e:docker`                                                                   | Playwright dans l'image Linux amd64 de la CI, pour reproduire un échec propre à Linux (build sur l'hôte d'abord)                                                                             |
| `npm run perf`                                                                         | projets `perf` et `perf-mobile` : compteurs WebGL (draw calls, triangles)                                                                                                                    |
| `npx tsx scripts/perf/bundle-budget.ts`                                                | JavaScript chargé au premier affichage, par route, contre `perf.budgets.json` (après un build)                                                                                               |
| `npm run lhci`                                                                         | Lighthouse CI                                                                                                                                                                                |

### Documentation

| Document                                               | Contenu                                                              |
| ------------------------------------------------------ | -------------------------------------------------------------------- |
| [`docs/bike3d.md`](./docs/bike3d.md)                   | le visualiseur 3D : couches, API publique, crochets de test, limites |
| [`docs/bike3d-geometry.md`](./docs/bike3d-geometry.md) | la géométrie du vélo : axes, solveur, tableau des tailles            |
| [`docs/bike3d-perf.md`](./docs/bike3d-perf.md)         | la performance 3D et la vérification sur un vrai appareil            |
| [`docs/illustrations.md`](./docs/illustrations.md)     | dessiner une illustration, pour un guide ou pour l'arbre de décision |
| [`docs/retailers.md`](./docs/retailers.md)             | les liens vers les boutiques et leur vérification à la main          |
| [`docs/deploy.md`](./docs/deploy.md)                   | la mise en ligne (W5) : Neon, Vercel, Google, protection de `main`   |
| [`docs/qa/google-oauth.md`](./docs/qa/google-oauth.md) | la recette manuelle de « Continuer avec Google »                     |
| [`docs/backlog.md`](./docs/backlog.md)                 | ce qui est volontairement reporté : W5, puis après le MVP            |
| [`content/README.md`](./content/README.md)             | écrire un guide : slugs, gabarit, règles du contrôle                 |
| [`CLAUDE.md`](./CLAUDE.md)                             | les contrats d'architecture, en anglais                              |
| [`CONTRIBUTING.md`](./CONTRIBUTING.md)                 | contribuer : branches, commits, barrières, ajout d'un guide          |
| [`SECURITY.md`](./SECURITY.md)                         | signaler une faille en privé                                         |
| [`.debug/README.md`](./.debug/README.md)               | l'index des notes de débogage                                        |

### Architecture

- Next.js 16 (App Router) + TypeScript 5.9, Turbopack, **sans `src/`** — l'alias
  `@` désigne la racine du dépôt.
- Internationalisation : next-intl v4, préfixe de langue toujours présent
  (`/fr/…`, `/en/…` ; `/` mène à `/fr`), un fichier de messages par espace de
  noms dans `messages/`.
- Données : le **contenu** (arbre de décision, taxonomie des pièces, règles de
  compatibilité, guides MDX) vit dans le dépôt ; la base ne contient que les
  **données des utilisateurs** (Prisma 7 + PostgreSQL 16).
- 3D : React Three Fiber, géométrie **paramétrique écrite en code**, sans aucun
  fichier glTF — voir [`docs/bike3d.md`](./docs/bike3d.md).
- Authentification : Auth.js v5 (mot de passe + Google), sessions JWT.

Les contrats qui tiennent le tout sont dans [`CLAUDE.md`](./CLAUDE.md).

### Licence

Code sous [licence MIT](./LICENSE). Contenu éditorial (`content/**`) sous
[CC BY-SA 4.0](./content/LICENSE). Voir aussi
[`THIRD_PARTY_NOTICES.md`](./THIRD_PARTY_NOTICES.md).

---

## 🇬🇧 English

**vélo-atelier** is a public, bilingual (French by default, English) website
that teaches you to inspect, repair, clean and adjust your own bike.

1. **The home page is a visual decision tree** (drivetrain, discipline, wheel
   size, brakes, pedals…). Every question has an "I don't know" default and a
   visual aid so you can check the answer on your own bike.
2. **The result is a parametric 3D bike** with every part clickable: read or
   edit its details, or start a **checkup** (full, or on selected parts) that
   walks you through the how-tos — tools and their alternatives included — and
   builds a **to-fix list**.
3. From that list: **buying guidance** (size, brand, compatibility) and outbound
   links to Rose Bikes, Alltricks and Decathlon — plain links, with no affiliate
   id and no tracking.
4. Guides to **replace**, **clean** and **adjust** a part, including **fit and
   geometry** (what to measure, and how).
5. Sign in with email + a strong password, or with Google. **Guest mode** works
   without an account (`localStorage`); once signed in, a banner on "My bikes"
   offers to import that bike into the account (`/import`).

> Live site: _(W5)_ — the address is published on the first deploy, described in
> [`docs/deploy.md`](./docs/deploy.md).

### Quick start

Requirements: [nvm](https://github.com/nvm-sh/nvm) with Node 24 (`.nvmrc`), a
running Docker Desktop, and `npm` — never `pnpm`, `yarn` or `bun`.

This is the plan's acceptance criterion §4.8 AC1, verbatim:

```bash
rm -rf node_modules && env -i PATH="$PATH" HOME="$HOME" npm ci
nvm use && cp .env.example .env.local && npm run db:setup && npm run dev
```

1. The first line succeeds with no env file at all: `postinstall` only runs
   `prisma generate`, which needs no database.
2. The second starts Postgres (`docker compose up -d --wait`), applies the
   migrations, loads the demo data, then serves the site on
   <http://localhost:3000>.
3. Log in with `DEMO_USER` (below): **3 bikes**, **1 completed checkup with
   exactly 2 KO items**, **1 build list with 2 items**.
4. The seed is idempotent: in a second terminal, running `npm run db:seed`
   twice leaves every row count unchanged.

```bash
npm run db:seed
npm run db:seed
npx tsx scripts/db/count.ts   # prints: users=2 bikes=4
```

If the `velo_atelier_test` database is missing (a Docker volume created before
`docker/initdb/` existed), `npm run db:reset` recreates it — by destroying the
volume, so the local `velo_atelier` data goes too.

### Demo accounts

Created by the seed (`prisma/seed-data.ts`). The seed refuses
`VERCEL_ENV=production` and any non-local database host, unless
`ALLOW_REMOTE_SEED=1` is set explicitly (`lib/db/guard.ts`).

|          | `DEMO_USER` (fr)                                                                                                              | `DEMO_USER_EN` (en)         |
| -------- | ----------------------------------------------------------------------------------------------------------------------------- | --------------------------- |
| Email    | `demo@velo-atelier.test`                                                                                                      | `demo-en@velo-atelier.test` |
| Password | `Demo-Velo-Atelier-2026!`                                                                                                     | `Demo-Velo-Atelier-2026!`   |
| Holds    | 3 bikes ("Vélo de route", "Gravel", "VTT électrique"); on the Gravel, one completed checkup and the "Révision printemps" list | 1 bike ("Gravel bike")      |

With `NEXT_PUBLIC_DEMO_LOGIN=1` (already in `.env.example`), the sign-in page
offers a button that fills in `DEMO_USER`.

### Environment variables

The annotated list is [`.env.example`](./.env.example); how they are split
across Vercel's environments is in [`docs/deploy.md`](./docs/deploy.md).

| Variable                                | Local (`.env.example`)  | On Vercel                           | Purpose                                                                                                    |
| --------------------------------------- | ----------------------- | ----------------------------------- | ---------------------------------------------------------------------------------------------------------- |
| `POSTGRES_URL`                          | Docker Postgres         | all three environments              | the app's (pooled) connection; `DATABASE_URL` is accepted as a fallback                                    |
| `POSTGRES_URL_NON_POOLING`              | Docker Postgres         | all three environments              | direct connection for migrations and the seed; `DATABASE_URL_UNPOOLED` as a fallback, never the pooled URL |
| `AUTH_SECRET`                           | a development value     | all three, a distinct value in each | Auth.js signing key, at least 32 characters (`npx auth secret`)                                            |
| `AUTH_URL`                              | `http://localhost:3000` | Production only                     | the public origin Auth.js builds its callback URLs from                                                    |
| `AUTH_TRUST_HOST`                       | `true`                  | all three (`true`)                  | trust the host forwarded by the proxy                                                                      |
| `NEXT_PUBLIC_SITE_URL`                  | `http://localhost:3000` | all three environments              | canonical URLs, sitemap, `hreflang`, OpenGraph images — baked in at build time                             |
| `AUTH_GOOGLE_ID` / `AUTH_GOOGLE_SECRET` | empty (optional)        | Production only                     | Google sign-in; when empty, only the email + password form can sign in                                     |
| `BCRYPT_COST`                           | `12`                    | unset (defaults to 12)              | bcrypt work factor, clamped to 4–15 (`.env.test` uses 4)                                                   |
| `NEXT_PUBLIC_DEMO_LOGIN`                | `1`                     | **never**                           | the "demo account" button on the sign-in page                                                              |
| `ENABLE_TEST_PAGES`                     | `1`                     | **never**                           | unlocks `/dev/bike3d` and `/dev/bike3d-perf` (read on every request)                                       |
| `NEXT_PUBLIC_TEST_HOOKS`                | `1`                     | **never**                           | compiles the `window.__va` Playwright hooks into the bundle (read at build time)                           |
| `ALLOW_REMOTE_SEED`                     | unset                   | **never**                           | lets the seed write to a non-local database                                                                |

### Commands

| Command                                 | What it does                                                                   |
| --------------------------------------- | ------------------------------------------------------------------------------ |
| `npm run dev`                           | tree drawings, then the Turbopack dev server on port 3000                      |
| `npm run build`                         | tree drawings, content check, then the production build                        |
| `npm run lint` / `npm run format:check` | ESLint / Prettier                                                              |
| `npm run typecheck`                     | generates the Prisma client and the content, then `tsc --noEmit`               |
| `npm run content:check`                 | validates `content/**` (structural and corpus rules, `--strict`)               |
| `npm run content:new <kind>-<slug>`     | scaffolds a guide in both locales (see [`CONTRIBUTING.md`](./CONTRIBUTING.md)) |
| `npm run db:up` / `db:down`             | starts / stops the Docker Postgres                                             |
| `npm run db:seed`                       | reloads the demo data (idempotent)                                             |
| `npm run db:reset`                      | destroys the volume, then migrates and seeds from scratch                      |
| `npm run ci:local`                      | `scripts/ci.sh`: the local mirror of CI (the `pre-push` hook runs it too)      |

### Tests

| Command                                                                                | What it runs                                                                                                                                                                            |
| -------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `npm test`                                                                             | the whole Vitest suite: `unit`, `ui`, `bike3d`, `integration`, `security` — when nothing answers on the `_test` database, `integration` is skipped with a warning                       |
| `npm run test:unit` · `test:ui` · `test:bike3d` · `test:integration` · `test:security` | one Vitest project; `integration` uses `velo_atelier_test` (`.env.test`)                                                                                                                |
| `npm run test:coverage`                                                                | Vitest with the coverage gate: 80 % overall, 100 % on `lib/domain/**`, 100 % of the statements and branches of `lib/checkup/**`, and per-folder floors                                  |
| `npm run e2e -- --project=desktop-chromium`                                            | Playwright against a production build, made first with `ENABLE_TEST_PAGES=1 NEXT_PUBLIC_TEST_HOOKS=1 npm run build`; without `--project`, every project runs (WebKit and perf included) |
| `npm run e2e:mobile`                                                                   | the mobile projects: Pixel 7, landscape, 320 px and WebKit (`npx playwright install webkit` if needed)                                                                                  |
| `npm run e2e:docker`                                                                   | Playwright in CI's amd64 Linux image, to reproduce a Linux-only failure (build on the host first)                                                                                       |
| `npm run perf`                                                                         | the `perf` and `perf-mobile` projects: WebGL counters (draw calls, triangles)                                                                                                           |
| `npx tsx scripts/perf/bundle-budget.ts`                                                | first-load JavaScript per route against `perf.budgets.json` (after a build)                                                                                                             |
| `npm run lhci`                                                                         | Lighthouse CI                                                                                                                                                                           |

### Documentation

| Document                                               | What is in it                                                    |
| ------------------------------------------------------ | ---------------------------------------------------------------- |
| [`docs/bike3d.md`](./docs/bike3d.md)                   | the 3D viewer: layers, public API, test hooks, known limitations |
| [`docs/bike3d-geometry.md`](./docs/bike3d-geometry.md) | bike geometry: axes, the solver, the size table                  |
| [`docs/bike3d-perf.md`](./docs/bike3d-perf.md)         | 3D performance and the real-device check                         |
| [`docs/illustrations.md`](./docs/illustrations.md)     | drawing an illustration, for a guide or for the decision tree    |
| [`docs/retailers.md`](./docs/retailers.md)             | the retailer links and how they are verified by hand             |
| [`docs/deploy.md`](./docs/deploy.md)                   | going live (W5): Neon, Vercel, Google, protecting `main`         |
| [`docs/qa/google-oauth.md`](./docs/qa/google-oauth.md) | the manual QA of "Continue with Google"                          |
| [`docs/backlog.md`](./docs/backlog.md)                 | what is deliberately deferred: W5, then post-MVP                 |
| [`content/README.md`](./content/README.md)             | writing a guide: slugs, template, the content check's rules      |
| [`CLAUDE.md`](./CLAUDE.md)                             | the architecture contracts                                       |
| [`CONTRIBUTING.md`](./CONTRIBUTING.md)                 | contributing: branches, commits, gates, adding a guide           |
| [`SECURITY.md`](./SECURITY.md)                         | reporting a vulnerability privately                              |
| [`.debug/README.md`](./.debug/README.md)               | the index of debug notes                                         |

### Architecture

- Next.js 16 (App Router) + TypeScript 5.9, Turbopack, **no `src/`** — the `@`
  alias is the repository root.
- i18n: next-intl v4 with an always-present locale prefix (`/fr/…`, `/en/…`; `/`
  goes to `/fr`), one message file per namespace under `messages/`.
- Data: **content** (decision tree, part taxonomy, compatibility rules, MDX
  guides) lives in the repository; the database holds **user data only**
  (Prisma 7 + PostgreSQL 16).
- 3D: React Three Fiber with **parametric geometry written in code** — no glTF
  asset anywhere; see [`docs/bike3d.md`](./docs/bike3d.md).
- Auth: Auth.js v5 (password + Google) with JWT sessions.

The contracts that hold it together are in [`CLAUDE.md`](./CLAUDE.md).

### Licence

Code is [MIT](./LICENSE). Editorial content under `content/**` is
[CC BY-SA 4.0](./content/LICENSE). See also
[`THIRD_PARTY_NOTICES.md`](./THIRD_PARTY_NOTICES.md).
