import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";
import security from "eslint-plugin-security";
import prettier from "eslint-config-prettier/flat";

/**
 * Import restrictions that apply to EVERY TypeScript file in the repo.
 *
 * - `@prisma/client`: the Prisma 7 `prisma-client` generator emits into
 *   `lib/generated/prisma`. A single import path everywhere keeps the bundler,
 *   `serverExternalPackages` and the coverage excludes in agreement. Type-only
 *   imports stay legal because `auth.ts` needs `import type { PrismaClient }`
 *   for the `PrismaAdapter` cast.
 * - `three-stdlib` / `three/examples/jsm/*`: duplicated, unversioned copies of
 *   three.js internals. Everything we need is in `three` or `@react-three/drei`
 *   (drei's barrel import is deliberately allowed).
 */
const basePaths = [
  {
    name: "@prisma/client",
    message:
      "Import the generated client from '@/lib/generated/prisma/client' (Prisma 7 `prisma-client` generator output).",
    allowTypeImports: true,
  },
  {
    name: "three-stdlib",
    message: "Do not use three-stdlib. Use `three` directly or a `@react-three/drei` helper.",
  },
];

const basePatterns = [
  {
    group: ["three/examples/jsm/*", "three/examples/jsm/**"],
    message:
      "Do not deep-import three examples. Use `three` directly or a `@react-three/drei` helper.",
  },
  {
    group: ["@prisma/client/*", "@prisma/client/**"],
    message: "Import the generated client from '@/lib/generated/prisma/client'.",
  },
];

/** Classic `zod` pulls the full parser into the client bundle. */
const zodPath = {
  name: "zod",
  message:
    "Bundled code must use `import * as z from 'zod/mini'` (or a hand-written guard). Classic `zod` is server- and test-side only.",
};

/** Server-only modules that must never reach a client component. */
const serverOnlyPaths = [
  {
    name: "content-collections",
    message:
      "MDX is compiled at build time and rendered only in RSC. Pass pre-rendered nodes down as props.",
  },
  {
    name: "@content-collections/mdx/react",
    message:
      "MDX is rendered only in RSC (components/mdx/**). Pass pre-rendered nodes down as props.",
  },
  {
    name: "next-intl/server",
    message: "Client components use `useTranslations()` from 'next-intl', not 'next-intl/server'.",
  },
];

const restrict = (paths, patterns = basePatterns) => [
  "error",
  { paths: [...basePaths, ...paths], patterns },
];

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  security.configs.recommended,
  // Disable stylistic rules that conflict with Prettier.
  prettier,

  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
    // Generated or derived trees — linting them computes nothing.
    "lib/generated/**",
    "lib/content/generated/**",
    ".content-collections/**",
    "coverage/**",
    ".vitest-reports/**",
    ".lighthouseci/**",
    ".perf/**",
    "playwright-report/**",
    "test-results/**",
    "prisma/migrations/**",
    // Test fakes need flexible types and dynamic property access by design.
    "tests/_fakes/**",
    "tests/_mocks/**",
  ]),

  {
    name: "velo-atelier/imports-everywhere",
    files: ["**/*.ts", "**/*.tsx", "**/*.mts"],
    rules: {
      "@typescript-eslint/no-restricted-imports": restrict([]),
    },
  },

  {
    // Everything under `components/**` is bundled for the browser (RSC output
    // included), and `lib/checkup/**` is imported by the wizard.
    name: "velo-atelier/client-bundle",
    files: [
      "components/**/*.ts",
      "components/**/*.tsx",
      "lib/checkup/**/*.ts",
      "lib/hooks/**/*.ts",
    ],
    rules: {
      "@typescript-eslint/no-restricted-imports": restrict([zodPath, ...serverOnlyPaths]),
    },
  },

  {
    // `components/mdx/**` IS the RSC boundary that renders compiled MDX, so it
    // is the one place allowed to touch the content-collections output.
    name: "velo-atelier/mdx-rsc-boundary",
    files: ["components/mdx/**/*.ts", "components/mdx/**/*.tsx"],
    rules: {
      "@typescript-eslint/no-restricted-imports": restrict([zodPath]),
    },
  },

  {
    // `auth.config.ts` is loaded by `proxy.ts`. Anything Node-only pulled in
    // here inflates (or breaks) the proxy bundle.
    name: "velo-atelier/proxy-safe",
    files: ["auth.config.ts", "proxy.ts"],
    rules: {
      "@typescript-eslint/no-restricted-imports": restrict(
        [
          {
            name: "@prisma/adapter-pg",
            message:
              "auth.config.ts and proxy.ts must stay Prisma-free. Adapter wiring is auth.ts.",
          },
          {
            name: "bcryptjs",
            message: "auth.config.ts and proxy.ts must stay bcrypt-free. Hashing lives in auth.ts.",
          },
        ],
        [
          ...basePatterns,
          {
            group: ["@/lib/db/*", "@/lib/db/**", "@/lib/generated/*", "@/lib/generated/**"],
            message: "auth.config.ts and proxy.ts must stay database-free.",
          },
        ],
      ),
    },
  },

  {
    // `components/bike3d/parts/**` are declarative meshes only: every decision
    // (which parts exist, where they sit, which variant to draw) belongs in
    // `lib/bike3d/**`, where it is unit-testable without a WebGL context.
    name: "velo-atelier/bike3d-parts-are-declarative",
    files: ["components/bike3d/parts/**/*.ts", "components/bike3d/parts/**/*.tsx"],
    rules: {
      "no-restricted-syntax": [
        "error",
        {
          selector: "IfStatement",
          message: "No logic in components/bike3d/parts/**. Move the branch into lib/bike3d/**.",
        },
        {
          selector: "SwitchStatement",
          message: "No logic in components/bike3d/parts/**. Move the branch into lib/bike3d/**.",
        },
        {
          selector: "ConditionalExpression",
          message: "No logic in components/bike3d/parts/**. Move the branch into lib/bike3d/**.",
        },
        {
          selector: "LogicalExpression",
          message:
            "No conditional rendering in components/bike3d/parts/**. Decide in lib/bike3d/** and pass a prop.",
        },
        {
          selector:
            "ForStatement, ForOfStatement, ForInStatement, WhileStatement, DoWhileStatement",
          message: "No loops in components/bike3d/parts/**. Build the list in lib/bike3d/**.",
        },
      ],
    },
  },
]);

export default eslintConfig;
