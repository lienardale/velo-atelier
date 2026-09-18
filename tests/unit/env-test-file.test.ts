/**
 * `.env.test` is COMMITTED, and every worktree edits it.
 *
 * Each parallel agent/worktree points it at its own database and port so runs do
 * not collide (`velo_atelier_<task>_test`, `:310x`). That file is tracked, so a
 * `git add -A` carries those private values onto `main` — W2-T3 did exactly that
 * in `1663562`, and `main` then shipped `velo_atelier_t3_test` on `:3103`. The
 * damage is quiet and real: `npm run e2e` on a fresh clone TRUNCATES whatever
 * database the stale value names, which is somebody else's, and the canonical
 * one is never touched.
 *
 * So the committed file is pinned here. If you are isolating a worktree, change
 * it and DO NOT commit it (`git update-index --skip-worktree .env.test` if that
 * helps); if you are changing the canonical values on purpose, change them here
 * in the same commit.
 */
/* eslint-disable security/detect-non-literal-fs-filename -- one fixed path at the repo root */
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { parse } from "dotenv";
import { describe, expect, it } from "vitest";

const CANONICAL = {
  POSTGRES_URL: "postgresql://velo:velo@localhost:5432/velo_atelier_test",
  POSTGRES_URL_NON_POOLING: "postgresql://velo:velo@localhost:5432/velo_atelier_test",
  AUTH_URL: "http://localhost:3100",
  NEXT_PUBLIC_SITE_URL: "http://localhost:3100",
};

describe(".env.test (committed)", () => {
  const env = parse(readFileSync(join(process.cwd(), ".env.test"), "utf8"));

  for (const [key, value] of Object.entries(CANONICAL)) {
    it(`${key} is the canonical value, not a worktree's`, () => {
      // eslint-disable-next-line security/detect-object-injection -- `key` is a literal from CANONICAL
      expect(env[key], `.env.test ${key} looks worktree-specific`).toBe(value);
    });
  }

  it("names no per-task database", () => {
    const url = env.POSTGRES_URL ?? "";
    expect(url, "a per-worktree database name reached the committed file").not.toMatch(
      /velo_atelier_(?!test\b)\w+/,
    );
  });
});
