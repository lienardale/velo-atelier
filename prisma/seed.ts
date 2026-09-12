/**
 * Database seed — `npm run db:seed` (`prisma db seed` → `tsx prisma/seed.ts`).
 *
 * Safety first, literally: the very first thing this file does, before a
 * `PrismaClient` exists and therefore before a socket is opened, is prove that
 * the target is a local database and that this is not a production deploy.
 * A seed is a destructive operation pointed at whatever `POSTGRES_URL` happens
 * to hold, and "whatever happens to hold" is how production data dies.
 *
 * Everything below is an **upsert on a fixed id**, so running it twice leaves
 * every row count unchanged (§4.8 AC1).
 *
 * Connection: the **direct** URL. A seed is a burst of writes in one process;
 * routing it through a transaction pooler buys nothing and breaks session
 * state.
 *
 * Plain Node only — no `server-only` anywhere in this import graph
 * (`tests/unit/no-server-only-in-scripts.test.ts` walks it).
 *
 * Scope today: **users only.** Bikes, part states, checkups and build lists
 * arrive with W2-T3, once `lib/domain` can turn `Answers` into a `BikeSpec`;
 * that task also adds the partId / guideSlug / stepKey validation this file
 * will run before writing.
 */

import { PrismaPg } from "@prisma/adapter-pg";

import { hashPassword } from "../lib/auth/password";
import { getDatabaseUrls, type DatabaseUrls } from "../lib/db/env";
import { assertLocalDatabaseUrl } from "../lib/db/guard";
import { PrismaClient } from "../lib/generated/prisma/client";
import { DEMO_USERS, SEED_EPOCH } from "./seed-data";

/** Guard — runs before anything can connect. */
function resolveSafeTarget(): DatabaseUrls {
  if (process.env.VERCEL_ENV === "production") {
    throw new Error("Refusing to seed a production deployment (VERCEL_ENV=production).");
  }
  const urls = getDatabaseUrls();
  // Both, not just the one we are about to use: a mismatched pair means the
  // environment is not what the operator thinks it is.
  assertLocalDatabaseUrl(urls.pooled, "POSTGRES_URL");
  assertLocalDatabaseUrl(urls.direct, "POSTGRES_URL_NON_POOLING");
  return urls;
}

let urls: DatabaseUrls;
try {
  urls = resolveSafeTarget();
} catch (error) {
  console.error(`✖ seed aborted: ${(error as Error).message}`);
  process.exit(1);
}

const prisma = new PrismaClient({
  adapter: new PrismaPg({ connectionString: urls.direct, max: 1 }),
});

async function seedUsers(): Promise<void> {
  for (const user of DEMO_USERS) {
    // Hashed with the repo's own helper so the seeded hash is exactly what a
    // real sign-up produces — including the `BCRYPT_COST` of this environment.
    const passwordHash = await hashPassword(user.password);

    await prisma.user.upsert({
      where: { email: user.email },
      update: {
        name: user.name,
        locale: user.locale,
        passwordHash,
      },
      create: {
        id: user.id,
        email: user.email,
        name: user.name,
        locale: user.locale,
        passwordHash,
        // Demo accounts are "verified": they exist to be signed into, and the
        // e-mail flow is out of MVP scope.
        emailVerified: SEED_EPOCH,
      },
    });
  }
}

async function main(): Promise<void> {
  console.log(`▶ seeding ${new URL(urls.direct).pathname.replace(/^\//, "")}`);

  await seedUsers();

  const [users, bikes] = await Promise.all([prisma.user.count(), prisma.bike.count()]);
  console.log(`✓ seed complete — users=${users} bikes=${bikes}`);
}

main()
  .catch((error: unknown) => {
    console.error("✖ seed failed:", error);
    process.exitCode = 1;
  })
  .finally(() => {
    void prisma.$disconnect();
  });
