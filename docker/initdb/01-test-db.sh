#!/bin/sh
# Runs once, on an EMPTY volume, from the postgres:16-alpine entrypoint.
#
# The integration and e2e tiers connect to `<db>_test` and truncate it between
# files, so it has to be a separate database from the one holding the developer's
# own data — never a schema inside it. `tests/setup.integration.ts` refuses any
# POSTGRES_URL that does not end in `_test`, which only works if this database
# exists.
#
# If it is missing (an older volume created before this file), recreate it with
# `npm run db:reset` — that drops the volume and replays this script.
set -e

TEST_DB="${POSTGRES_DB}_test"

psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname "$POSTGRES_DB" <<-EOSQL
	CREATE DATABASE "${TEST_DB}" OWNER "${POSTGRES_USER}";
EOSQL

# citext backs User.email (case-insensitive unique). Prisma 7 dropped
# `postgresqlExtensions`, so migration 0001 creates it by hand in the dev
# database; the test database gets it here so a fresh `migrate deploy` finds
# the same ground.
psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname "$TEST_DB" <<-EOSQL
	CREATE EXTENSION IF NOT EXISTS citext;
EOSQL

echo "initdb: created ${TEST_DB}"
