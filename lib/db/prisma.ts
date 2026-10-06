/**
 * The Prisma client singleton.
 *
 * Four things are going on here.
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
 * 3. **Errors are events, not stdout.** `log: [{ emit: "event", level: "error" }]`
 *    plus a listener, so the one expected miss can be dropped and everything
 *    else still printed. `lib/db/log.ts` holds the rule and says why the filter
 *    has to live in the listener at all. Dev keeps its extra `warn` level on
 *    stdout, where it has always been.
 *
 *    The consequence to keep in mind when editing that listener: with the
 *    events taken, `reportPrismaError` is the ONLY thing that prints a Prisma
 *    error anywhere in the app. It is one call rather than a body so it can be
 *    unit-tested, and `tests/integration/prisma-error-log.test.ts` asserts on
 *    THIS singleton that the call is still there — and that Prisma's own print
 *    has not come back beside it.
 *
 *    The listener belongs to the client, and the client outlives a hot reload
 *    on `globalThis` (point 2), so an edit to `lib/db/log.ts` needs a
 *    dev-server restart to take effect — shown by re-evaluating both modules
 *    (same client, same listener), not observed under `next dev` itself.
 *
 * 4. **Lazy construction.** The exported `prisma` is a proxy that builds the
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

import { type Prisma, PrismaClient } from "@/lib/generated/prisma/client";

import { getDatabaseUrls } from "./env";
import { reportPrismaError } from "./log";

const globalForPrisma = globalThis as typeof globalThis & {
  __veloAtelierPrisma?: PrismaClient;
};

function createPrismaClient(): PrismaClient {
  const { pooled } = getDatabaseUrls();

  // `Prisma.LogDefinition[]` and not a literal: the exported `prisma` and this
  // function are annotated `PrismaClient`, whose `LogOpts` generic defaults to
  // `never`, so `prisma.$on(…)` off the annotated value does not typecheck at
  // all. The listener is registered here, on the freshly constructed value,
  // where the generic is still inferred from the options.
  //
  // `error` is taken as an event and ONLY as an event. The `"error"` shorthand,
  // or a `{ emit: "stdout", level: "error" }` — instead of this entry or beside
  // it — makes Prisma print every error itself again, the limiter's expected
  // miss included: `console.log("prisma:error", message)`, which no listener
  // of ours is asked about. Beside the event entry it is the quiet mistake:
  // the listener still runs and still filters, so `tsc`, ESLint, the unit
  // tests and the "prints a real failure" test all stay green (measured), and
  // the any-channel test in `tests/integration/prisma-error-log.test.ts` is
  // what fails — on the two `prisma:error` lines a fresh key writes.
  const log: Prisma.LogDefinition[] = [{ emit: "event", level: "error" }];
  if (process.env.NODE_ENV === "development") log.push({ emit: "stdout", level: "warn" });

  const client = new PrismaClient({
    adapter: new PrismaPg({ connectionString: pooled, max: 3 }),
    log,
  });

  // The listener's whole body is `reportPrismaError` so that it can be tested;
  // this line is the WIRING, and `tests/integration/prisma-error-log.test.ts`
  // is what makes deleting or silencing it fail a gate. Called through an
  // arrow rather than passed by reference: `reportPrismaError`'s second
  // parameter is the log seam, and a future Prisma that handed its listener a
  // second argument would quietly rebind it.
  client.$on("error", (event) => reportPrismaError(event));

  return client;
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
