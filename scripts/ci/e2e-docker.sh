#!/usr/bin/env bash
# Playwright in the same Linux image CI uses (amd64, SwiftShader), from a macOS
# host. This is the ONLY way to reproduce a Linux-only e2e failure locally —
# see `.debug/005-touch-scroll-ci-2026-09-17.md` for the one that motivated it:
# a gesture API that scrolls on macOS and is inert on Linux, green locally and
# red on CI.
#
#   bash scripts/ci/e2e-docker.sh --project=mobile-chromium tests/e2e/bike3d/touch-scroll.spec.ts
#   bash scripts/ci/e2e-docker.sh --grep @snapshot --update-snapshots
#
# Build first on the HOST (`ENABLE_TEST_PAGES=1 NEXT_PUBLIC_TEST_HOOKS=1 npm run
# build`); the container reuses `.next` as is.
#
# Two things make it work, and both are easy to get wrong:
#
#   1. The repo is bind-mounted, so the container would otherwise inherit the
#      host's darwin-arm64 `next`/`prisma`/`tsx`/`esbuild`. Two named volumes
#      shadow the bind mount for `node_modules` and `lib/generated`, giving the
#      container its own Linux binaries while the host keeps its own. The first
#      run installs into that volume (slow under emulation — ~9 min); later runs
#      reuse it.
#   2. The container joins the network the Postgres container is already on, so
#      the database answers to the alias `db`. `assertTestDatabaseUrl` accepts
#      `db` (TEST_DB_HOSTS) but NOT `host.docker.internal`.
set -euo pipefail

cd "$(dirname -- "${BASH_SOURCE[0]}")/../.."

NM_VOLUME="${E2E_DOCKER_NM_VOLUME:-va-e2e-nm}"
GEN_VOLUME="${E2E_DOCKER_GEN_VOLUME:-va-e2e-generated}"
PG_CONTAINER="${E2E_DOCKER_PG_CONTAINER:-velo-atelier-postgres}"
PORT="${PLAYWRIGHT_PORT:-3100}"

if ! docker info >/dev/null 2>&1; then
  echo "e2e-docker: Docker is not running." >&2
  exit 1
fi

# The image must match the installed @playwright/test exactly, or the browsers
# baked into it disagree with the client driving them.
PW_VERSION="$(node -p "require('./node_modules/@playwright/test/package.json').version")"
IMAGE="mcr.microsoft.com/playwright:v${PW_VERSION}-noble"

# The compose project is named after the directory, which differs in a worktree,
# so ask the running container which network it is on instead of guessing.
NETWORK="$(docker inspect "$PG_CONTAINER" \
  --format '{{range $k, $v := .NetworkSettings.Networks}}{{$k}}{{"\n"}}{{end}}' 2>/dev/null |
  head -1 || true)"
if [[ -z "$NETWORK" ]]; then
  echo "e2e-docker: container '$PG_CONTAINER' is not running — start it with 'npm run db:up'." >&2
  exit 1
fi

# Same database as a host run, reached over the compose network as `db`.
DB_NAME="$(node -e "
  const { parse } = require('dotenv');
  const { readFileSync } = require('node:fs');
  const url = parse(readFileSync('.env.test')).POSTGRES_URL ?? '';
  process.stdout.write(new URL(url).pathname.replace(/^\//, '') || 'velo_atelier_test');
")"
DB_URL="postgresql://velo:velo@db:5432/${DB_NAME}"

if [[ -z "$(docker volume ls -q -f "name=^${NM_VOLUME}$")" ]]; then
  echo ":: first run — installing Linux node_modules into volume '${NM_VOLUME}' (slow under emulation)"
  docker run --rm --platform linux/amd64 \
    -v "$PWD":/work -w /work \
    -v "${NM_VOLUME}":/work/node_modules -v "${GEN_VOLUME}":/work/lib/generated \
    -e npm_config_cache=/tmp/npmcache -e HUSKY=0 \
    "$IMAGE" npm ci --no-audit --no-fund
fi

echo ":: playwright in $IMAGE (network $NETWORK, db $DB_NAME, port $PORT)"
exec docker run --rm --platform linux/amd64 --ipc=host \
  --network "$NETWORK" \
  -v "$PWD":/work -w /work \
  -v "${NM_VOLUME}":/work/node_modules -v "${GEN_VOLUME}":/work/lib/generated \
  -e CI=1 -e HUSKY=0 \
  -e PLAYWRIGHT_PORT="$PORT" \
  -e POSTGRES_URL="$DB_URL" \
  -e POSTGRES_URL_NON_POOLING="$DB_URL" \
  "$IMAGE" \
  npx playwright test "$@"
