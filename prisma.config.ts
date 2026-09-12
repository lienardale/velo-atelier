/**
 * Prisma 7 CLI configuration.
 *
 * In Prisma 7 the datasource URL no longer lives in `schema.prisma` and the
 * CLI no longer loads `.env` on its own, so this file is where `migrate`,
 * `db seed`, `migrate diff` and friends get both.
 *
 * Two details that are easy to get wrong:
 *
 * - **The direct (unpooled) URL, not the pooled one.** DDL and Prisma's
 *   advisory migration lock do not survive a transaction pooler.
 *   `readDatabaseUrls()` is the same resolution the runtime uses
 *   (lib/db/env.ts), so the CLI and the app can never disagree about which
 *   variable wins.
 *
 * - **`?? ''` rather than a throw.** `prisma generate` runs as a `postinstall`
 *   hook — on a clean clone, in CI, and on Vercel — where there is no `.env`
 *   at all. Generation needs no database, so it must not require a URL;
 *   the commands that do need one fail loudly on the empty string instead.
 */

import { config as loadEnvFiles } from "dotenv";

loadEnvFiles({ path: [".env.local", ".env"], quiet: true });

import { defineConfig } from "prisma/config";

import { readDatabaseUrls } from "./lib/db/env";

export default defineConfig({
  schema: "prisma/schema.prisma",
  migrations: {
    path: "prisma/migrations",
    seed: "tsx prisma/seed.ts",
  },
  datasource: {
    url: readDatabaseUrls().direct ?? "",
  },
});
