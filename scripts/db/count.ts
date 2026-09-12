/**
 * Row counts for the seeded tables — `npx tsx scripts/db/count.ts`.
 *
 * Prints one line, `users=<n> bikes=<n>`, which is what §4.8 AC1 compares
 * before and after a second `npm run db:seed` to prove the seed is idempotent.
 *
 * Read-only, so there is no local-host guard here: pointing it at a remote
 * database is a legitimate way to check what is actually deployed.
 *
 * It loads `.env.local` / `.env` itself (the same order and precedence as
 * `prisma.config.ts`) so it works as a bare `npx tsx` invocation, without a
 * wrapper script to export the URL first.
 */

import { config as loadEnvFiles } from "dotenv";

loadEnvFiles({ path: [".env.local", ".env"], quiet: true });

import { PrismaPg } from "@prisma/adapter-pg";

import { getDatabaseUrls } from "../../lib/db/env";
import { PrismaClient } from "../../lib/generated/prisma/client";

async function main(): Promise<void> {
  const { direct } = getDatabaseUrls();
  const prisma = new PrismaClient({
    adapter: new PrismaPg({ connectionString: direct, max: 1 }),
  });

  try {
    const [users, bikes] = await Promise.all([prisma.user.count(), prisma.bike.count()]);
    console.log(`users=${users} bikes=${bikes}`);
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? `✖ ${error.message}` : error);
  process.exitCode = 1;
});
