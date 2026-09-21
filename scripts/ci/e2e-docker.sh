#!/usr/bin/env bash
# Playwright in the same Linux image CI uses (amd64, SwiftShader), from a macOS
# host. This is the ONLY way to reproduce a Linux-only e2e failure locally —
# see `.debug/005-touch-scroll-ci-2026-09-17.md` for the one that motivated it:
# a gesture API that scrolls on macOS and is inert on Linux, green locally and
# red on CI. It reproduces; it does not gate (CI's matrix is the gate).
#
#   bash scripts/ci/e2e-docker.sh --project=mobile-chromium tests/e2e/bike3d/touch-scroll.spec.ts
#   bash scripts/ci/e2e-docker.sh --grep @snapshot --update-snapshots
#
# Build first on the HOST (`ENABLE_TEST_PAGES=1 NEXT_PUBLIC_TEST_HOOKS=1 npm run
# build`); the container reuses `.next` as is.
#
# Three things make it work, and all three are easy to get wrong:
#
#   1. The repo is bind-mounted, so the container would otherwise inherit the
#      host's darwin-arm64 `next`/`prisma`/`tsx`/`esbuild`. Two named volumes
#      shadow the bind mount for `node_modules` and `lib/generated`, giving the
#      container its own Linux binaries while the host keeps its own. The
#      volumes are KEYED BY CONTENT — `va-e2e-nm-<hash of package-lock.json>`
#      and `va-e2e-generated-<hash of the lockfile + prisma/schema.prisma>` — so
#      a dependency or schema change gets a fresh volume instead of silently
#      running yesterday's install, and two worktrees on different lockfiles
#      never share one. The first run for a new hash installs into it (slow
#      under emulation — ~9 min); later runs reuse it. This script CREATES
#      volumes and never deletes one: an older volume may be another worktree's.
#      A `.va-e2e-ready` marker inside each volume is what "installed" means
#      (not the volume's existence), so a killed install is redone, and a lock
#      in the `va-e2e-locks` volume keeps two first runs from installing into
#      the same volume at once. `E2E_DOCKER_NM_VOLUME` / `E2E_DOCKER_GEN_VOLUME`
#      still name a volume explicitly.
#   2. The container joins the network the Postgres container is already on, so
#      the database answers to the alias `db`. `assertTestDatabaseUrl` accepts
#      `db` (TEST_DB_HOSTS) but NOT `host.docker.internal`.
#   3. The database NAME comes from the shell's `POSTGRES_URL` when it is set,
#      and from `.env.test` otherwise; the HOST is always `db`. A worktree points
#      `POSTGRES_URL` at its own `*_test` database, exactly as it does for the
#      host runs and the vitest tiers — the global setup migrates, truncates and
#      seeds whatever it is given, so falling back to the shared
#      `velo_atelier_test` from a worktree would wipe the main checkout's data.
set -euo pipefail

cd "$(dirname -- "${BASH_SOURCE[0]}")/../.."

PG_CONTAINER="${E2E_DOCKER_PG_CONTAINER:-velo-atelier-postgres}"
PORT="${PLAYWRIGHT_PORT:-3100}"
LOCK_VOLUME="va-e2e-locks"

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
  echo "e2e-docker: container '$PG_CONTAINER' is not running — start it with 'npm run db:up'" >&2
  echo "            from the main checkout (never from a worktree)." >&2
  exit 1
fi

# Only the NAME is taken from the URL: inside the container the host is `db`.
DB_NAME="$(node -e "
  const { parse } = require('dotenv');
  const { readFileSync } = require('node:fs');
  const url = process.env.POSTGRES_URL || parse(readFileSync('.env.test')).POSTGRES_URL || '';
  process.stdout.write(url ? decodeURIComponent(new URL(url).pathname.replace(/^\//, '')) : '');
")"
# Refused here rather than by the global setup, which would only say so after a
# first-run install: the name goes into a URL, and the suite truncates it.
if [[ ! "$DB_NAME" =~ ^[A-Za-z0-9_]+_test$ ]]; then
  echo "e2e-docker: database '${DB_NAME}' is not a plain *_test name (POSTGRES_URL / .env.test)." >&2
  exit 1
fi
DB_URL="postgresql://velo:velo@db:5432/${DB_NAME}"

# Content hashes, computed with node so the script runs unchanged on macOS and Linux.
content_hash() {
  node -e "
    const hash = require('node:crypto').createHash('sha256');
    for (const file of process.argv.slice(1)) hash.update(require('node:fs').readFileSync(file));
    process.stdout.write(hash.digest('hex').slice(0, 12));
  " "$@"
}
NM_VOLUME="${E2E_DOCKER_NM_VOLUME:-va-e2e-nm-$(content_hash package-lock.json)}"
GEN_VOLUME="${E2E_DOCKER_GEN_VOLUME:-va-e2e-generated-$(content_hash package-lock.json prisma/schema.prisma)}"

# Install into the volumes unless their marker says it is done — cheap when it
# is. `flock` (util-linux, in the image) is released by the kernel when the
# install dies, so a killed first run never leaves the next one waiting forever.
echo ":: volumes ${NM_VOLUME} + ${GEN_VOLUME}"
docker run --rm --platform linux/amd64 \
  -v "$PWD":/work -w /work \
  -v "${NM_VOLUME}":/work/node_modules -v "${GEN_VOLUME}":/work/lib/generated \
  -v "${LOCK_VOLUME}":/locks \
  -e npm_config_cache=/tmp/npmcache -e HUSKY=0 \
  "$IMAGE" flock "/locks/${NM_VOLUME}.lock" sh -ec '
    if [ ! -f node_modules/.va-e2e-ready ]; then
      echo ":: first use — npm ci into the node_modules volume (slow under emulation)"
      npm ci --no-audit --no-fund
      touch node_modules/.va-e2e-ready
    fi
    if [ ! -f lib/generated/.va-e2e-ready ]; then
      echo ":: first use — prisma generate into the lib/generated volume"
      npx --no-install prisma generate
      touch lib/generated/.va-e2e-ready
    fi
  '

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
