/**
 * Vitest — five projects, one coverage gate.
 *
 * Shape copied from skipper-website: inline projects with `extends: true`
 * (they inherit `plugins`, `resolve` and the root `test` options), while
 * `coverage` and the reporters live at the root only (Vitest 4 rejects them
 * inside a project).
 *
 *   unit         node   lib/**, tests/unit/**            recording fake Prisma
 *   ui           jsdom  components/**, tests/ui/**       RTL + jest-dom, fake Prisma
 *   bike3d       jsdom  tests/bike3d/**                  R3F test renderer, WebGL stubs
 *   integration  node   tests/integration/**             real Postgres `_test` DB, one fork, serial
 *   security     node   tests/security/**                OWASP-style tier, fake Prisma
 *
 * `vitest run --coverage` exiting non-zero IS the gate (§7.1): the thresholds
 * below start at their final values and are never lowered to make a run pass.
 * CI splits the tiers into two jobs that each write a blob report and merges
 * them in `scripts/ci/coverage.sh`; see `isCoverageShard` for why the per-tier
 * blob runs do not evaluate thresholds on their half of the picture.
 *
 * Verified against the installed Vitest 4.1.11 (not assumed):
 *   - `test.server.deps.inline` is still a per-project option (ServerDepsOptions),
 *     so the plan's `deps.optimizer.web.include` fallback is not needed;
 *   - `coverage.thresholds` accepts `{ [glob]: { lines, branches, functions, statements } }`
 *     next to the global keys; a glob that matches no file yet (e.g. `lib/domain/**`
 *     in W0) resolves to an empty summary and passes;
 *   - `coverage.include` lists every matching file, loaded by a test or not
 *     (Vitest 4 removed `coverage.all`), so an untested file counts as 0 %.
 */
import { connect } from "node:net";
import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import react from "@vitejs/plugin-react";
import { parse as parseDotenv } from "dotenv";
import {
  defineConfig,
  type TestProjectInlineConfiguration,
  type ViteUserConfig,
} from "vitest/config";

const root = fileURLToPath(new URL("./", import.meta.url));

// Vite 8 bundles this file once for the root and once per inline project, and
// each time warns that ESM syntax in a `.ts` file under a package without
// `"type": "module"` will not load with its future native config loader. The
// notice is about package.json (not this file) and is informative once, not
// six times: the first load prints it, the project loads stay quiet.
process.env.VITE_CONFIG_NATIVE_IGNORE_WARNING ??= "true";

/**
 * Is this run one tier of a sharded coverage run?
 *
 * `scripts/ci/test-unit.sh` and `scripts/ci/test-integration.sh` each run a
 * subset of the projects with `--reporter=blob --coverage`, and
 * `scripts/ci/coverage.sh` merges both blobs with `--merge-reports --coverage`.
 * Vitest checks thresholds on EVERY coverage run, blob runs included (verified
 * in @vitest/coverage-v8 4.1.11: `generateReports()` → `reportThresholds()`),
 * so without this the integration job would fail the 80 % gate on the files
 * only the unit tier covers — and vice versa. A blob run is by definition a
 * partial picture; the merge is where the verdict is computed.
 *
 * Every other invocation — `npx vitest run --coverage`, `npm run test:coverage`,
 * the merge itself — enforces the full thresholds.
 */
function isCoverageShard(argv: readonly string[]): boolean {
  if (argv.some((arg) => arg.startsWith("--merge-reports"))) return false;
  return argv.some(
    (arg, i) =>
      /^--reporters?=blob$/.test(arg) || (/^--reporters?$/.test(arg) && argv[i + 1] === "blob"),
  );
}

/**
 * Whether the `integration` project is part of this run.
 *
 * It always is in CI (`CI=true`) and under `scripts/ci.sh` (which starts the
 * container and exports `VITEST_REQUIRE_DB=1`): there, a missing database is a
 * failure of the run, raised by `tests/integration/global-setup.ts`.
 *
 * It is also always part of the run when named explicitly
 * (`--project integration`), so `npm run test:integration` without Docker
 * fails with the global setup's actionable message.
 *
 * On a laptop without Docker, a plain `npm test` would otherwise die in that
 * global setup before a single unit test ran. So — and only there — the project
 * is dropped when nothing listens on the `_test` database's host:port, with a
 * warning that says so. A gate that is not running must be visible, never
 * silent.
 */
async function integrationTierEnabled(argv: readonly string[]): Promise<boolean> {
  if (process.env.VITEST_REQUIRE_DB === "1" || process.env.CI) return true;
  // Asked for by name (`--project integration`, `npm run test:integration`):
  // run it, so a missing database is reported by the global setup, not hidden.
  if (
    argv.some(
      (arg, i) =>
        arg === "--project=integration" || (arg === "--project" && argv[i + 1] === "integration"),
    )
  ) {
    return true;
  }

  // Vitest evaluates this file once for the root and once per inline project;
  // probe (and warn) once per process.
  const cache = globalThis as typeof globalThis & { __vaIntegrationTier?: Promise<boolean> };
  cache.__vaIntegrationTier ??= probeIntegrationDatabase();
  return cache.__vaIntegrationTier;
}

async function probeIntegrationDatabase(): Promise<boolean> {
  const url = testDatabaseUrl();
  if (!url) return true; // no URL at all: let the global setup explain what is missing
  let host: string;
  let port: number;
  try {
    const parsed = new URL(url);
    host = parsed.hostname;
    port = Number(parsed.port || 5432);
  } catch {
    return true; // malformed: the global setup's guard reports it precisely
  }

  if (await isPortOpen(host, port)) return true;
  console.warn(
    `\n⚠ vitest: integration tier SKIPPED — nothing is listening on ${host}:${port}.\n` +
      `  Start the database with \`npm run db:up\`, or set VITEST_REQUIRE_DB=1 to make this an error.\n`,
  );
  return false;
}

/** `POSTGRES_URL_NON_POOLING` as the integration tier will see it (shell env wins over .env.test). */
function testDatabaseUrl(): string | undefined {
  const fromShell = process.env.POSTGRES_URL_NON_POOLING ?? process.env.POSTGRES_URL;
  if (fromShell) return fromShell;
  const file = `${root}.env.test`;
  // eslint-disable-next-line security/detect-non-literal-fs-filename -- fixed path under the repo root
  if (!existsSync(file)) return undefined;
  // eslint-disable-next-line security/detect-non-literal-fs-filename -- fixed path under the repo root
  const parsed = parseDotenv(readFileSync(file));
  return parsed.POSTGRES_URL_NON_POOLING ?? parsed.POSTGRES_URL;
}

function isPortOpen(host: string, port: number, timeoutMs = 750): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = connect({ host, port });
    const done = (open: boolean) => {
      socket.destroy();
      resolve(open);
    };
    socket.setTimeout(timeoutMs, () => done(false));
    socket.once("connect", () => done(true));
    socket.once("error", () => done(false));
  });
}

export default defineConfig(async (): Promise<ViteUserConfig> => {
  const shard = isCoverageShard(process.argv);
  const withIntegration = await integrationTierEnabled(process.argv);

  return {
    plugins: [react()],
    resolve: { alias: { "@": root } },
    test: {
      globals: false,
      // No root-level `setupFiles`: with `extends: true` Vitest CONCATENATES the
      // root and project arrays (verified on 4.1.11 — a root entry made
      // tests/setup.ts appear twice in every project). Each project therefore
      // states its complete list, tests/setup.ts always first.
      unstubEnvs: true,
      unstubGlobals: true,
      projects: [
        {
          extends: true,
          test: {
            name: "unit",
            environment: "node",
            include: ["lib/**/*.test.ts", "tests/unit/**/*.test.ts"],
            setupFiles: ["./tests/setup.ts", "./tests/setup.fake-db.ts"],
          },
        },
        {
          extends: true,
          test: {
            name: "ui",
            environment: "jsdom",
            include: ["components/**/*.test.tsx", "tests/ui/**/*.test.tsx"],
            setupFiles: ["./tests/setup.ts", "./tests/setup.dom.ts", "./tests/setup.fake-db.ts"],
          },
        },
        {
          extends: true,
          test: {
            name: "bike3d",
            environment: "jsdom",
            include: ["tests/bike3d/**/*.test.tsx"],
            setupFiles: ["./tests/setup.ts", "./tests/setup.dom.ts", "./tests/setup.bike3d.ts"],
            // three and @react-three/* ship untranspiled ESM (and JSX-runtime
            // imports) that must go through Vite's pipeline, not native Node.
            server: { deps: { inline: [/@react-three/, /three/] } },
          },
        },
        ...(withIntegration
          ? [
              {
                extends: true,
                test: {
                  name: "integration",
                  environment: "node",
                  include: ["tests/integration/**/*.test.ts"],
                  setupFiles: ["./tests/setup.ts", "./tests/setup.integration.ts"],
                  globalSetup: ["./tests/integration/global-setup.ts"],
                  // One database, truncated before every file: files must not
                  // overlap. `forks` gives each file a clean process (and pool).
                  fileParallelism: false,
                  pool: "forks",
                  testTimeout: 20_000,
                  hookTimeout: 30_000,
                },
              } satisfies TestProjectInlineConfiguration,
            ]
          : []),
        {
          extends: true,
          test: {
            name: "security",
            environment: "node",
            include: ["tests/security/**/*.test.ts"],
            setupFiles: ["./tests/setup.ts", "./tests/setup.fake-db.ts"],
          },
        },
      ],

      coverage: {
        provider: "v8",
        reporter: ["text-summary", "lcov", "json-summary", "json"],
        reportsDirectory: "./coverage",
        // What the gate measures: business logic, client components, server
        // actions, route handlers, and the proxy-safe auth config.
        include: [
          "lib/**/*.{ts,tsx}",
          "components/**/*.tsx",
          "app/**/actions.ts",
          "app/api/**/*.ts",
          "auth.config.ts",
        ],
        // Every entry carries its reason (skipper-website convention). Paths
        // containing `[locale]` must be written `app/\\[locale\\]/**` — an
        // unescaped bracket is a glob character class and silently matches
        // nothing.
        exclude: [
          // Tests and type declarations are not product code.
          "**/*.test.*",
          "**/*.d.ts",
          // Generated trees: Prisma client, content-collections output and the
          // content:build artefacts. Excluded before anything is computed, so a
          // regeneration can never move the numbers.
          "lib/generated/**",
          "lib/content/generated/**",
          ".content-collections/**",
          ".next/**",
          // Data, not logic: the bundled top-10k common-password list.
          "lib/auth/common-passwords.ts",
          // Wiring with no branches of our own; booted by the CI build/health
          // job and every Playwright run (`/api/health` is the webServer URL).
          "lib/db/prisma.ts",
          "auth.ts",
          "proxy.ts",
          "app/api/auth/**",
          // Generated shadcn primitives (components.json); not edited by hand.
          "components/ui/**",
          // SVG art; one smoke test renders every illustration with role=img + <title>.
          "components/illustrations/**",
          // WebGL-only: need a real GL context; covered by Playwright e2e + perf.
          "components/bike3d/{BikeScene,CameraRig,PartLabel,QualityGovernor}.tsx",
          "components/bike3d/perf/**",
          "app/**/dev/**",
          // Barrel file: re-exports only.
          "components/mdx/index.ts",
        ],
        // A blob run is one shard of the gate (see isCoverageShard); every
        // other coverage run enforces the final thresholds.
        thresholds: shard
          ? undefined
          : {
              lines: 80,
              branches: 80,
              functions: 80,
              statements: 80,
              perFile: false,
              // The domain engine is pure and exhaustively testable.
              "lib/domain/**": { lines: 100, branches: 100, functions: 100, statements: 100 },
              // The checkup reducer decides what lands on a user's to-fix list.
              "lib/checkup/**": { statements: 100, branches: 100 },
              "lib/**": { lines: 90, branches: 85, functions: 90, statements: 90 },
              "components/**": { lines: 75, branches: 70, functions: 75, statements: 75 },
            },
      },
    },
  };
});
