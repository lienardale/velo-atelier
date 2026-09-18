#!/usr/bin/env bash
# Integration tier: the Vitest `integration` project against a real PostgreSQL
# whose database name ends in `_test`.
#
# Order matters:
#   1. Docker daemon guard — the single most common local failure, and the one
#      whose native error message ("Cannot connect to the Docker daemon...")
#      is buried 40 lines into a Prisma stack trace.
#   2. `migrate deploy` — apply the committed migrations, never `migrate dev`
#      (which would invent a new one from a drifted schema).
#   3. drift check — the schema and the migrations must describe the same
#      database. Flags verified against Prisma 7.10.0 (`prisma migrate diff
#      --help`): `--from-config-datasource`, `--to-schema`, `--exit-code`
#      (0 empty / 1 error / 2 non-empty).
#   4. the tests themselves, blob + raw coverage for `coverage.sh` to merge.
#
# `SKIP_DB=1` is honoured by scripts/ci.sh, not here: a step that is asked to
# run the database tier and cannot reach a database must fail.
source "$(dirname -- "${BASH_SOURCE[0]}")/_lib.sh"
cd "$PROJECT_ROOT"

docker info >/dev/null 2>&1 || {
  echo "Docker daemon not running"
  exit 1
}

if [[ ! -f vitest.config.ts ]]; then
  skip_step "vitest.config.ts does not exist yet (W0-T3b)"
fi
if [[ ! -f prisma/schema.prisma ]]; then
  skip_step "prisma/schema.prisma does not exist yet (W0-T4)"
fi
if [[ ! -d tests/integration ]]; then
  skip_step "tests/integration/ has no specs yet"
fi

# `.env.test` is the committed source of truth for the local run; a CI `env:`
# block (where the Postgres host is `postgres`, not `localhost`) wins because
# real environment variables are never overridden here.
if [[ -f .env.test ]]; then
  while IFS='=' read -r key value; do
    [[ "$key" =~ ^[[:space:]]*(#|$) ]] && continue
    [[ -n "${!key:-}" ]] && continue
    export "$key=$value"
  done <.env.test
fi

case "${POSTGRES_URL:-}" in
*_test) : ;;
*)
  log_err "POSTGRES_URL must end with _test (got: ${POSTGRES_URL:-unset})"
  exit 1
  ;;
esac

log_step "prisma migrate deploy"
npx --no-install prisma migrate deploy

log_step "schema drift check"
if ! npx --no-install prisma migrate diff \
  --exit-code \
  --from-config-datasource \
  --to-schema prisma/schema.prisma; then
  log_err "prisma/schema.prisma and the migrated database disagree — run 'npm run db:migrate'"
  exit 1
fi
npx --no-install prisma migrate status

# `prisma/seed.ts` imports `lib/content/generated/*`, which is generated and
# gitignored (CLAUDE.md). The integration tier runs the seed, so the files have
# to exist here too — this job does not run `typecheck` or `build`, which are
# the other two places that make them.
log_step "content:generate"
npx --no-install tsx scripts/content-check.ts --emit

log_step "vitest run (integration)"
npx --no-install vitest run \
  --project integration \
  --reporter=default \
  --reporter=blob \
  --outputFile.blob=.vitest-reports/integration.json \
  --coverage \
  --coverage.reporter=json

log_ok "integration tier passed"
