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
   liens sortants vers Rose Bikes, Alltricks et Decathlon.
4. Des guides pour **remplacer**, **nettoyer**, **régler** une pièce, y compris
   la **géométrie et les réglages de position** (quoi mesurer, comment).
5. Compte par e-mail + mot de passe fort, ou Google. Le **mode invité**
   fonctionne sans compte (localStorage) et est importé à la première connexion.

> Site en ligne : _(à renseigner au premier déploiement — voir `docs/deploy.md`)_

### Démarrage rapide

Prérequis : [nvm](https://github.com/nvm-sh/nvm), Node 24 (`.nvmrc`), Docker
Desktop en cours d'exécution, et `npm` (jamais `pnpm`, `yarn` ou `bun`).

```bash
nvm use                     # Node 24
npm ci                      # installe exactement le package-lock.json
cp .env.example .env.local  # la base pointe sur le Postgres Docker
npm run db:setup            # docker compose up + migrations + jeu de démo
npm run dev                 # http://localhost:3000
```

Compte de démonstration (créé par `npm run db:setup`, jamais en production) :

| Champ        | Valeur                    |
| ------------ | ------------------------- |
| E-mail       | `demo@velo-atelier.test`  |
| Mot de passe | `Demo-Velo-Atelier-2026!` |

Il contient trois vélos, un contrôle terminé et une liste « Révision
printemps ». `npm run db:seed` est idempotent : le relancer ne duplique rien.

### Variables d'environnement

Voir [`.env.example`](./.env.example) pour la liste commentée.

| Variable                                | Requise | Rôle                                                  |
| --------------------------------------- | ------- | ----------------------------------------------------- |
| `POSTGRES_URL`                          | oui     | connexion applicative (pool)                          |
| `POSTGRES_URL_NON_POOLING`              | oui     | migrations et seed (connexion directe)                |
| `AUTH_SECRET`                           | oui     | clé de signature Auth.js, ≥ 32 caractères             |
| `AUTH_URL`                              | oui     | origine publique utilisée par Auth.js                 |
| `AUTH_TRUST_HOST`                       | oui     | `true` derrière Vercel                                |
| `NEXT_PUBLIC_SITE_URL`                  | oui     | URL canonique, sitemap, images OpenGraph              |
| `AUTH_GOOGLE_ID` / `AUTH_GOOGLE_SECRET` | non     | connexion Google (production)                         |
| `BCRYPT_COST`                           | non     | facteur de coût bcrypt (12 par défaut)                |
| `NEXT_PUBLIC_DEMO_LOGIN`                | non     | affiche le raccourci « compte démo »                  |
| `ENABLE_TEST_PAGES`                     | non     | déverrouille `/dev/*` — **jamais** sur Vercel         |
| `NEXT_PUBLIC_TEST_HOOKS`                | non     | compile les sondes Playwright — **jamais** sur Vercel |

### Commandes

| Commande                                 | Ce qu'elle fait                                 |
| ---------------------------------------- | ----------------------------------------------- |
| `npm run dev`                            | serveur de développement (Turbopack)            |
| `npm run build`                          | validation du contenu puis build de production  |
| `npm run lint` / `npm run format:check`  | ESLint / Prettier                               |
| `npm run typecheck`                      | `tsc --noEmit`                                  |
| `npm test`                               | toute la suite Vitest                           |
| `npm run test:coverage`                  | Vitest + seuil de couverture 80 % (la barrière) |
| `npm run e2e`                            | Playwright (nécessite un build de production)   |
| `npm run e2e:mobile`                     | Playwright sur les profils mobiles              |
| `npm run lhci`                           | Lighthouse CI                                   |
| `npm run db:up` / `db:down` / `db:reset` | Postgres Docker                                 |
| `npm run ci:local`                       | mirroir local de la CI GitHub Actions           |

### Architecture

- Next.js 16 (App Router) + TypeScript 5.9, Turbopack, **sans `src/`** — alias
  `@` = racine du dépôt.
- Internationalisation : next-intl v4, préfixe d'URL toujours présent
  (`/fr/…`, `/en/…`), messages découpés par espace de noms dans `messages/`.
- Données : le **contenu** (arbre de décision, taxonomie des pièces, règles de
  compatibilité, guides MDX) vit dans le dépôt ; la base ne contient que les
  **données utilisateur** (Prisma 7 + PostgreSQL).
- 3D : React Three Fiber, géométrie **paramétrique en code** (aucun asset glTF).
- Authentification : Auth.js v5 (mot de passe + Google), sessions JWT.

Documentation détaillée : [`CLAUDE.md`](./CLAUDE.md), [`docs/`](./docs),
[`CONTRIBUTING.md`](./CONTRIBUTING.md).

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
   links to Rose Bikes, Alltricks and Decathlon.
4. Guides to **replace**, **clean** and **adjust** a part, including **fit and
   geometry** (what to measure, and how).
5. Sign in with email + a strong password, or with Google. **Guest mode** works
   without an account (localStorage) and is imported on first sign-in.

> Live site: _(to be filled in on first deploy — see `docs/deploy.md`)_

### Quick start

Requirements: [nvm](https://github.com/nvm-sh/nvm), Node 24 (`.nvmrc`), a
running Docker Desktop, and `npm` (never `pnpm`, `yarn` or `bun`).

```bash
nvm use                     # Node 24
npm ci                      # installs exactly what package-lock.json says
cp .env.example .env.local  # points at the Docker Postgres
npm run db:setup            # docker compose up + migrations + demo data
npm run dev                 # http://localhost:3000
```

Demo account (created by `npm run db:setup`, never in production):

| Field    | Value                     |
| -------- | ------------------------- |
| Email    | `demo@velo-atelier.test`  |
| Password | `Demo-Velo-Atelier-2026!` |

It holds three bikes, one completed checkup and one "Révision printemps" build
list. `npm run db:seed` is idempotent — re-running it changes no row counts.

### Environment variables

See [`.env.example`](./.env.example) for the annotated list; the table in the
French section above documents each variable.

### Commands

The command table in the French section applies verbatim.

### Architecture

- Next.js 16 (App Router) + TypeScript 5.9, Turbopack, **no `src/`** — the `@`
  alias is the repository root.
- i18n: next-intl v4 with an always-present locale prefix (`/fr/…`, `/en/…`),
  messages split per namespace under `messages/`.
- Data: **content** (decision tree, part taxonomy, compatibility rules, MDX
  guides) lives in the repository; the database holds **user data only**
  (Prisma 7 + PostgreSQL).
- 3D: React Three Fiber with **parametric geometry written in code** — no glTF
  asset pipeline.
- Auth: Auth.js v5 (password + Google) with JWT sessions.

### Licence

Code is [MIT](./LICENSE). Editorial content under `content/**` is
[CC BY-SA 4.0](./content/LICENSE). See also
[`THIRD_PARTY_NOTICES.md`](./THIRD_PARTY_NOTICES.md).
