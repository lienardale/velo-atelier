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
 * ## Nothing is written that the app could not have written
 *
 * Bikes go through `deriveBike`, the same function `createBikeAction` calls, so
 * the seeded `spec` and `parts` are the engine's own output and never a
 * hand-written copy that drifts. Every part id, guide slug, step key and reason
 * key in `seed-data.ts` is checked against `lib/domain` and the generated
 * content enums (`assertSeedReferences`) **before the first write**: a renamed
 * step makes the seed fail loudly instead of leaving a row pointing at a guide
 * that no longer exists.
 *
 * `npm run content:build` must have run (it is part of `prepare` and `build`);
 * without the generated modules this file cannot validate and says so.
 */

import { PrismaPg } from "@prisma/adapter-pg";

import { hashPassword } from "../lib/auth/password";
import { getDatabaseUrls, type DatabaseUrls } from "../lib/db/env";
import { assertLocalDatabaseUrl } from "../lib/db/guard";
import { PrismaClient } from "../lib/generated/prisma/client";
import { deriveBike } from "../lib/bike/rules";
import { buildContentManifest } from "../lib/content/check";
import { BIKE_PRESETS } from "../lib/domain/data/presets";
import { isPartId } from "../lib/domain/data/parts";
import {
  DEMO_BIKES,
  DEMO_BUILD_LIST,
  DEMO_CHECKUP,
  DEMO_PART_STATUSES,
  DEMO_USERS,
  SEED_EPOCH,
  type DemoBikeSeed,
  type SeedPartStatus,
} from "./seed-data";

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

/**
 * Every id `seed-data.ts` names must exist in the domain and in the content, or
 * the seed refuses to run. A dangling `stepKey` is invisible until someone opens
 * the demo account's build list and finds a link to nothing.
 */
function assertSeedReferences(): void {
  const problems: string[] = [];
  // Read from `content/` itself, not from `lib/content/generated/*`: that tree is
  // written by `content-check --emit` and gitignored, so it exists on a machine
  // that has built before and never in a fresh CI checkout. Importing it here
  // made `prisma db seed` — and with it every e2e, perf and unit job — fail on
  // CI while passing locally (W2 integration, 2026-09-18). The manifest is the
  // same data, computed from the same frontmatter, with nothing to generate.
  const manifest = buildContentManifest(process.cwd());
  const stepKeys = new Set<string>(manifest.stepKeys);
  const slugs = new Set<string>(manifest.slugs);
  const reasons = new Set<string>(manifest.reasonKeys);

  for (const bike of DEMO_BIKES) {
    if (!Object.hasOwn(BIKE_PRESETS, bike.preset)) {
      problems.push(`bike "${bike.name}": unknown preset ${bike.preset}`);
    }
  }
  for (const item of DEMO_CHECKUP.items) {
    if (!stepKeys.has(item.stepKey)) problems.push(`checkup: unknown step key ${item.stepKey}`);
    if (!isPartId(item.partId)) problems.push(`checkup: unknown part id ${item.partId}`);
  }
  for (const item of DEMO_BUILD_LIST.items) {
    if (!isPartId(item.partId)) problems.push(`build list: unknown part id ${item.partId}`);
    if (!reasons.has(item.reasonKey)) {
      problems.push(`build list: unknown reason key ${item.reasonKey}`);
    }
    if (!slugs.has(item.guideSlug)) problems.push(`build list: unknown guide ${item.guideSlug}`);
    if (!stepKeys.has(item.fromStepKey)) {
      problems.push(`build list: unknown step key ${item.fromStepKey}`);
    }
  }
  for (const partId of Object.keys(DEMO_PART_STATUSES)) {
    if (!isPartId(partId)) problems.push(`part status: unknown part id ${partId}`);
  }

  if (problems.length > 0) {
    throw new Error(
      `prisma/seed-data.ts references things that do not exist:\n  - ${problems.join("\n  - ")}\n` +
        `Run \`npm run content:build\` if the generated content enums are stale.`,
    );
  }
}

/**
 * Upsert one bike on `(userId, guestLocalId)`, deriving spec and parts from its
 * answers.
 *
 * `statuses` is the result of a checkup on **this** bike, so it is passed in
 * rather than read from the module: applying the gravel bike's verdicts to
 * every bike in the garage would tell the demo visitor that all three of their
 * chains are worn out.
 */
async function seedBike(
  bike: DemoBikeSeed,
  statuses: Readonly<Record<string, SeedPartStatus>> = {},
): Promise<{ id: string; partIds: string[] }> {
  const derived = deriveBike(BIKE_PRESETS[bike.preset]);
  const shared = {
    name: bike.name,
    answers: derived.answers as object,
    spec: derived.spec as object,
    parts: derived.parts as object,
    fit: bike.fit === null ? undefined : (bike.fit as object),
  };

  const row = await prisma.bike.upsert({
    where: { userId_guestLocalId: { userId: bike.userId, guestLocalId: bike.guestLocalId } },
    update: shared,
    create: {
      userId: bike.userId,
      guestLocalId: bike.guestLocalId,
      createdAt: SEED_EPOCH,
      ...shared,
    },
    select: { id: true },
  });

  const partIds = derived.parts.map((part) => part.partId);
  for (const partId of partIds) {
    // eslint-disable-next-line security/detect-object-injection -- a catalogue part id
    const status = statuses[partId] ?? "UNKNOWN";
    await prisma.bikePartState.upsert({
      where: { bikeId_partId: { bikeId: row.id, partId } },
      update: { status },
      create: {
        bikeId: row.id,
        partId,
        status,
        ...(status === "OK" ? { lastServicedAt: SEED_EPOCH } : {}),
      },
    });
  }
  // States of parts this bike no longer has (a preset changed between releases).
  await prisma.bikePartState.deleteMany({
    where: { bikeId: row.id, partId: { notIn: partIds } },
  });

  return { id: row.id, partIds };
}

/**
 * The completed checkup and the build list it produced, on the gravel bike.
 *
 * `guestKey` is what makes this idempotent: `Checkup` has no natural key, so the
 * seed gives it one and upserts on it, exactly as the guest import will
 * (§4.4 `importGuestStateAction`).
 */
async function seedCheckupAndList(bikeId: string): Promise<void> {
  const guestKey = `seed:${DEMO_CHECKUP.guestLocalId}`;

  const checkup = await prisma.checkup.upsert({
    where: { guestKey },
    update: { status: "COMPLETED", completedAt: SEED_EPOCH },
    create: {
      bikeId,
      guestKey,
      scope: DEMO_CHECKUP.scope,
      status: "COMPLETED",
      startedAt: SEED_EPOCH,
      completedAt: SEED_EPOCH,
    },
    select: { id: true },
  });

  const itemIdByStepKey = new Map<string, string>();
  for (const item of DEMO_CHECKUP.items) {
    const [guideSlug] = item.stepKey.split("#");
    const row = await prisma.checkupItem.upsert({
      where: { checkupId_stepKey: { checkupId: checkup.id, stepKey: item.stepKey } },
      update: { result: item.result, partId: item.partId, guideSlug },
      create: {
        checkupId: checkup.id,
        stepKey: item.stepKey,
        partId: item.partId,
        guideSlug,
        result: item.result,
      },
      select: { id: true },
    });
    itemIdByStepKey.set(item.stepKey, row.id);
  }

  const existingList = await prisma.buildList.findUnique({
    where: { checkupId: checkup.id },
    select: { id: true },
  });
  const list = existingList
    ? await prisma.buildList.update({
        where: { id: existingList.id },
        data: { name: DEMO_BUILD_LIST.name, status: "OPEN" },
        select: { id: true },
      })
    : await prisma.buildList.create({
        data: {
          bikeId,
          checkupId: checkup.id,
          name: DEMO_BUILD_LIST.name,
          status: "OPEN",
          createdAt: SEED_EPOCH,
        },
        select: { id: true },
      });

  for (const [index, item] of DEMO_BUILD_LIST.items.entries()) {
    const data = {
      reasonKey: item.reasonKey,
      guideSlug: item.guideSlug,
      sortOrder: index,
      checkupItemId: itemIdByStepKey.get(item.fromStepKey) ?? null,
      chosenProduct: item.chosenProduct === undefined ? undefined : (item.chosenProduct as object),
    };
    await prisma.buildListItem.upsert({
      where: {
        buildListId_partId_action: {
          buildListId: list.id,
          partId: item.partId,
          action: item.action,
        },
      },
      update: data,
      create: { buildListId: list.id, partId: item.partId, action: item.action, ...data },
    });
  }
}

async function main(): Promise<void> {
  console.log(`▶ seeding ${new URL(urls.direct).pathname.replace(/^\//, "")}`);
  assertSeedReferences();

  await seedUsers();

  const bikeIdByGuestId = new Map<string, string>();
  for (const bike of DEMO_BIKES) {
    const checked =
      bike.userId === DEMO_USERS[0].id && bike.guestLocalId === DEMO_CHECKUP.guestLocalId;
    const { id } = await seedBike(bike, checked ? DEMO_PART_STATUSES : {});
    if (bike.userId === DEMO_USERS[0].id) bikeIdByGuestId.set(bike.guestLocalId, id);
  }

  const gravelId = bikeIdByGuestId.get(DEMO_CHECKUP.guestLocalId);
  if (gravelId === undefined) {
    throw new Error(`the checkup's bike ${DEMO_CHECKUP.guestLocalId} was not seeded`);
  }
  await seedCheckupAndList(gravelId);

  const [users, bikes, checkups, lists] = await Promise.all([
    prisma.user.count(),
    prisma.bike.count(),
    prisma.checkup.count(),
    prisma.buildList.count(),
  ]);
  console.log(
    `✓ seed complete — users=${users} bikes=${bikes} checkups=${checkups} lists=${lists}`,
  );
}

main()
  .catch((error: unknown) => {
    console.error("✖ seed failed:", error);
    process.exitCode = 1;
  })
  .finally(() => {
    void prisma.$disconnect();
  });
