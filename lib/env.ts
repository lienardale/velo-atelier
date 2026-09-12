/**
 * Environment contract.
 *
 * Every variable the server depends on is declared once, here, with the rule
 * that actually matters (a secret long enough to be a secret, a URL that
 * parses, a bcrypt cost in a sane range) rather than "is a string". A typo in
 * the Vercel dashboard then fails at boot with the variable's name in the
 * message, instead of at 2 a.m. as an `undefined` deep inside Auth.js.
 *
 * Two entry points:
 *   - `parseEnv(raw)` — pure, exported for tests;
 *   - `getEnv()` — memoised, throws `EnvValidationError` on first call.
 *
 * Deliberately **not** validated at module scope: `next build` imports server
 * modules to collect route metadata, and a build should not require a running
 * database or a production secret. The first request does.
 *
 * `NEXT_PUBLIC_*` values are inlined by the bundler at build time, so they are
 * read as literal `process.env.NEXT_PUBLIC_…` members wherever the client
 * needs them — this module only checks them server-side.
 */

import * as z from "zod";

/**
 * Any environment-shaped bag.
 *
 * Not `NodeJS.ProcessEnv`: Next augments that type so `NODE_ENV` is required,
 * which turns every partial fixture in a test into a type error for no
 * benefit. `process.env` is assignable to this.
 */
export type EnvSource = Readonly<Record<string, string | undefined>>;

/** `""` in a `.env` file means "not set", never "the empty value". */
const blankToUndefined = (value: unknown) =>
  typeof value === "string" && value.trim() === "" ? undefined : value;

const optionalString = z.preprocess(blankToUndefined, z.string().min(1).optional());

/**
 * `z.url()` alone accepts `localhost:3000` — the WHATWG parser reads it as the
 * scheme `localhost:` with an opaque path. An origin must carry http(s).
 */
const httpUrl = z.url().refine((value) => /^https?:\/\//i.test(value), {
  message: "must start with http:// or https://",
});

const optionalUrl = z.preprocess(blankToUndefined, httpUrl.optional());

/** `1` / `true` / `yes` all mean on; anything else (including unset) means off. */
const flag = z.preprocess(
  (value) =>
    typeof value === "string" ? ["1", "true", "yes"].includes(value.toLowerCase()) : value,
  z.boolean().optional().default(false),
);

const postgresUrl = z
  .string()
  .min(1)
  .refine((value) => /^postgres(ql)?:\/\//.test(value), {
    message: "must be a postgresql:// connection string",
  });

const baseSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).optional().default("development"),
  /** Set by Vercel only; `undefined` locally and in CI. */
  VERCEL_ENV: z.enum(["production", "preview", "development"]).optional(),

  POSTGRES_URL: postgresUrl,
  POSTGRES_URL_NON_POOLING: postgresUrl,

  /** Auth.js JWT signing key. 32 characters is the floor, not a target. */
  AUTH_SECRET: z.string().min(32, "must be at least 32 characters (npx auth secret)"),
  AUTH_URL: optionalUrl,
  AUTH_TRUST_HOST: flag,

  AUTH_GOOGLE_ID: optionalString,
  AUTH_GOOGLE_SECRET: optionalString,

  NEXT_PUBLIC_SITE_URL: httpUrl,

  /** bcrypt work factor. 12 in dev and production; 4 in the test env. */
  BCRYPT_COST: z.preprocess(
    blankToUndefined,
    z.coerce.number().int().min(4).max(15).optional().default(12),
  ),

  /** Local/CI only — see the guards below. */
  ENABLE_TEST_PAGES: flag,
  NEXT_PUBLIC_TEST_HOOKS: flag,
  NEXT_PUBLIC_DEMO_LOGIN: flag,
  ALLOW_REMOTE_SEED: flag,
});

export type Env = z.infer<typeof baseSchema> & { isProduction: boolean };

/** True on a Vercel production deployment, or a plain `NODE_ENV=production` server. */
function computeIsProduction(parsed: z.infer<typeof baseSchema>): boolean {
  if (parsed.VERCEL_ENV) return parsed.VERCEL_ENV === "production";
  return parsed.NODE_ENV === "production";
}

const schema = baseSchema.superRefine((parsed, ctx) => {
  if (!computeIsProduction(parsed)) return;

  // Google is the only OAuth provider; production without it silently loses
  // half the sign-in surface.
  const required: readonly (readonly [string, string | undefined])[] = [
    ["AUTH_GOOGLE_ID", parsed.AUTH_GOOGLE_ID],
    ["AUTH_GOOGLE_SECRET", parsed.AUTH_GOOGLE_SECRET],
    ["AUTH_URL", parsed.AUTH_URL],
  ];
  for (const [key, value] of required) {
    if (!value) ctx.addIssue({ code: "custom", path: [key], message: "is required in production" });
  }

  // The dev pages and the Playwright hooks must never exist on a public
  // deployment. Failing the boot is the only way to make that non-negotiable.
  const forbidden: readonly (readonly [string, boolean])[] = [
    ["ENABLE_TEST_PAGES", parsed.ENABLE_TEST_PAGES],
    ["NEXT_PUBLIC_TEST_HOOKS", parsed.NEXT_PUBLIC_TEST_HOOKS],
    ["NEXT_PUBLIC_DEMO_LOGIN", parsed.NEXT_PUBLIC_DEMO_LOGIN],
  ];
  for (const [key, enabled] of forbidden) {
    if (enabled) {
      ctx.addIssue({ code: "custom", path: [key], message: "must never be set in production" });
    }
  }
});

export class EnvValidationError extends Error {
  readonly issues: readonly { path: string; message: string }[];

  constructor(issues: readonly { path: string; message: string }[]) {
    super(
      `Invalid environment:\n${issues.map((i) => `  - ${i.path} ${i.message}`).join("\n")}\n` +
        `See .env.example for the full list.`,
    );
    this.name = "EnvValidationError";
    this.issues = issues;
  }
}

/** Validate a raw environment. Pure — no `process.env` access, no caching. */
export function parseEnv(raw: EnvSource = process.env): Env {
  const result = schema.safeParse(raw);
  if (!result.success) {
    throw new EnvValidationError(
      result.error.issues.map((issue) => ({
        path: issue.path.join(".") || "(root)",
        message: issue.message,
      })),
    );
  }
  return { ...result.data, isProduction: computeIsProduction(result.data) };
}

let cached: Env | undefined;

/** Memoised, process-wide. Throws `EnvValidationError` the first time it is wrong. */
export function getEnv(): Env {
  cached ??= parseEnv(process.env);
  return cached;
}

/** Test seam: forget the memoised value. */
export function resetEnvCache(): void {
  cached = undefined;
}
