#!/usr/bin/env bash
#
# Local development database — start it, migrate it, optionally seed it.
#
#   bash scripts/db/local.sh           # compose up + prisma migrate deploy + generate
#   bash scripts/db/local.sh --seed    # + prisma db seed   (npm run db:setup)
#
# This script hard-codes the docker-compose connection string and refuses to
# run against anything else. `.env.local` is not consulted at all: the whole
# point is that a stale or pasted remote URL cannot reach `prisma migrate` or
# the seed through this path. The exported variables win over any `.env` file,
# because dotenv never overrides an already-set process variable.
#
# Uses `prisma migrate deploy`, never `migrate dev`: this script must not
# invent a migration from an uncommitted schema edit. Creating a migration is
# a deliberate act — `npm run db:migrate`.

# Node: through `npm run db:setup` it is already on PATH — and npm exports
# `npm_config_prefix`, which makes `nvm use` refuse to run (exit 11). Only reach
# for nvm when the script is invoked directly from a shell without node (e.g. a
# non-login shell that never read ~/.zshrc). Done before `set -u`: nvm.sh reads
# unset variables.
if ! command -v node >/dev/null 2>&1 && [ -s "$HOME/.nvm/nvm.sh" ]; then
  # shellcheck disable=SC1091
  . "$HOME/.nvm/nvm.sh" && nvm use --silent 24
fi

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
[[ -n "$REPO_ROOT" && -f "$REPO_ROOT/prisma/schema.prisma" ]] || {
  echo "ABORT: could not locate the repository root from $0" >&2
  exit 1
}
cd "$REPO_ROOT"

docker info >/dev/null 2>&1 || {
  echo "Docker daemon not running. Start Docker Desktop, then re-run." >&2
  exit 1
}

LOCAL_DB="postgresql://velo:velo@localhost:5432/velo_atelier"
export POSTGRES_URL="$LOCAL_DB"
export POSTGRES_URL_NON_POOLING="$LOCAL_DB"

# Belt and braces: the constant above is local, and this proves it stayed local.
case "$POSTGRES_URL" in
  *@localhost:*|*@127.0.0.1:*) : ;;
  *) echo "ABORT: refusing to run against a non-local database: $POSTGRES_URL" >&2; exit 1 ;;
esac

SEED=0
for arg in "$@"; do
  case "$arg" in
    --seed) SEED=1 ;;
    *) echo "Unknown argument: $arg (expected --seed)" >&2; exit 2 ;;
  esac
done

echo "▶ starting Postgres (docker compose up -d --wait)…"
docker compose up -d --wait

echo "▶ applying migrations (prisma migrate deploy)…"
npx prisma migrate deploy

# Prisma 7's `migrate deploy` does NOT trigger generators, so the client can be
# older than the schema right after a migration lands.
echo "▶ generating the Prisma client…"
npx prisma generate

if [ "$SEED" = "1" ]; then
  echo "▶ seeding demo data (prisma db seed)…"
  npx prisma db seed
fi

echo "✓ local database ready at $LOCAL_DB"
