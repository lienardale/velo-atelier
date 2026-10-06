#!/usr/bin/env tsx
/**
 * Build-time preflight: the environment contract, evaluated before anything
 * ships. `scripts/vercel-build.sh` is its one caller.
 *
 * `instrumentation.ts` runs `getEnv()` when a server STARTS, and Next does not
 * run `register()` during a build (`NEXT_PHASE=phase-production-build`, see
 * that file). Left alone, that makes the first evaluation of a scope's VALUES
 * the first request to the deployed server — after the build went green, and
 * on production after `prisma migrate deploy` has already run. A refusal there
 * is not a failed deploy: it is a live deployment whose pages answer 500 (the
 * 500s measured under `next start`; on Vercel expected, not observed — see
 * docs/deploy.md). And a pull request's preview only ever evaluates the
 * Preview scope, so Production's values would be met for the first time by
 * production itself.
 *
 * So the same `parseEnv`, unweakened, runs here first. The Vercel build is
 * handed the scope's variables (it is how `prisma migrate deploy` gets its
 * database URL), so a violation exits 1 and fails the BUILD, before anything
 * has been migrated. Vercel's documentation says the production domains move
 * only to a deployment that succeeded; that half was not observed here — this
 * script had never run on Vercel when it was written. `instrumentation.ts`
 * stays as the runtime lock.
 *
 * NOT part of `npm run build`, and not called by `scripts/ci/build.sh`: CI
 * builds without a production secret, which is the property `lib/env.ts`'s
 * header promises. Only the Vercel entry point has a scope to check
 * (`tests/unit/deploy/migrate-on-deploy.test.ts` keeps it that way).
 *
 * Plain Node on purpose — a relative import of `lib/env.ts`, which imports
 * nothing but zod — so `tsx` needs no path alias and no Next to run it.
 * `tests/unit/deploy/vercel-build-guard.test.ts` executes this file for real.
 */
import { EnvValidationError, parseEnv } from "../lib/env";

/**
 * How zod words the issues that stop it before the cross-field rules
 * (`superRefine` in `lib/env.ts`). In an environment that is three things: a
 * variable that is missing, a `BCRYPT_COST` that is not a number — both
 * "Invalid input…" — or a `NODE_ENV` outside its enum, "Invalid option…".
 * (`VERCEL_ENV` is an enum too and is worded the same way; step 1 of
 * `scripts/vercel-build.sh` refuses an unknown one before this file runs.)
 *
 * Measured 2026-10-06 with a forbidden flag set in every case: beside a
 * too-short `AUTH_SECRET`, a scheme-less URL or an out-of-range cost, the flag
 * is listed too; beside a MISSING `NEXT_PUBLIC_SITE_URL` or `AUTH_SECRET`, a
 * `BCRYPT_COST=abc` or a `NODE_ENV=staging`, it is not. The pattern first
 * read "Invalid input" alone, so the `NODE_ENV` case hid the flag and printed
 * no hint (found in review; `vercel-build-guard.test.ts` runs it).
 */
const TYPE_LEVEL = /^Invalid (input|option)\b/;

function main(): void {
  const scope = process.env.VERCEL_ENV ?? "unset";

  try {
    const env = parseEnv(process.env);
    console.log(
      `check-env: environment contract satisfied (VERCEL_ENV=${scope}, isProduction=${env.isProduction}).`,
    );
  } catch (error) {
    if (!(error instanceof EnvValidationError)) throw error;
    // The message lists variable NAMES and rules, never a value: it is built
    // from zod's issue paths and messages, and a build log is widely read.
    console.error(error.message);
    console.error(
      `check-env: refused for VERCEL_ENV=${scope}. Fix the variable(s) named above in THAT scope —` +
        ` Vercel → Settings → Environment Variables — then redeploy.`,
    );
    // Say when the list above may be the first layer of two, or the second
    // failed build reads like a new bug.
    if (error.issues.some((issue) => TYPE_LEVEL.test(issue.message))) {
      console.error(
        "check-env: a variable above is missing (or of the wrong type), so the cross-field rules have not run yet" +
          " (the three test flags; AUTH_URL and the Google pair in production) — the next build may name more.",
      );
    }
    process.exit(1);
  }
}

main();
