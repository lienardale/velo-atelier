/**
 * The Prisma client singleton.
 *
 * Three things are going on here.
 *
 * 1. **Driver adapter.** Prisma 7 talks to Postgres through `@prisma/adapter-pg`
 *    (node-postgres), which is what lets the same client work on Vercel's
 *    Node runtime and against Neon's pooler. `max: 3` keeps a serverless
 *    instance from opening a fan of connections it will never reuse.
 *
 * 2. **`globalThis` singleton.** In dev, every hot reload re-evaluates this
 *    module; without the global, each reload would leak a pool until Postgres
 *    refuses new connections.
 *
 * 3. **Lazy construction.** The exported `prisma` is a proxy that builds the
 *    real client on first property access. `next build` imports every route
 *    module (including `app/api/health/route.ts`) to collect its metadata, so
 *    a client constructed at import time would make a build fail on a machine
 *    that simply has no database configured — a confusing error a long way
 *    from its cause. Resolving the URL on first *query* instead means the
 *    missing-variable error surfaces where it can be acted on.
 *
 * Import path: `@/lib/db/prisma`. The generated client itself is only ever
 * imported as `@/lib/generated/prisma/client` (ESLint `no-restricted-imports`).
 */

import { PrismaPg } from "@prisma/adapter-pg";

import { PrismaClient } from "@/lib/generated/prisma/client";

import { getDatabaseUrls } from "./env";

const globalForPrisma = globalThis as typeof globalThis & {
  __veloAtelierPrisma?: PrismaClient;
};

function createPrismaClient(): PrismaClient {
  const { pooled } = getDatabaseUrls();
  return new PrismaClient({
    adapter: new PrismaPg({ connectionString: pooled, max: 3 }),
    log: process.env.NODE_ENV === "development" ? ["warn", "error"] : ["error"],
  });
}

function resolveClient(): PrismaClient {
  const existing = globalForPrisma.__veloAtelierPrisma;
  if (existing) return existing;

  const client = createPrismaClient();
  // Production runs one long-lived module instance per lambda, so caching on
  // the global there too costs nothing and protects against double-evaluation
  // through differing module graphs (RSC vs route handler).
  globalForPrisma.__veloAtelierPrisma = client;
  return client;
}

export const prisma: PrismaClient = new Proxy({} as PrismaClient, {
  get(_target, property) {
    const client = resolveClient();
    const value = Reflect.get(client, property) as unknown;
    return typeof value === "function" ? value.bind(client) : value;
  },
  has(_target, property) {
    return Reflect.has(resolveClient(), property);
  },
  getPrototypeOf() {
    return Reflect.getPrototypeOf(resolveClient());
  },
});

/**
 * Closes the pool. Only scripts and integration teardown need this — the app
 * itself never disconnects (the pool is the point).
 */
export async function disconnectPrisma(): Promise<void> {
  const client = globalForPrisma.__veloAtelierPrisma;
  if (!client) return;
  globalForPrisma.__veloAtelierPrisma = undefined;
  await client.$disconnect();
}
