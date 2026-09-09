#!/usr/bin/env tsx
/**
 * Content validator — W0 stub.
 *
 * The real implementation (W1-T4 / W2-T4) parses every `content/**` MDX file,
 * validates its frontmatter against `ProcedureMeta`, checks that FR and EN
 * agree, that every `partId` exists in `lib/domain`, that every `KoConsequence`
 * points at a guide of the matching `kind`, and — with `--emit` — regenerates
 * the gitignored `lib/content/generated/*` manifests.
 *
 * Until `content/` exists this exits 0 so that `npm run build`,
 * `scripts/ci/content.sh` and the pre-commit hook all work from day 1.
 *
 * Flags (accepted now, enforced later):
 *   --strict  fail on stub guides   (W2-T4 turns this on in CI)
 *   --emit    regenerate lib/content/generated/*
 * Extra positional arguments (lint-staged passes staged file paths) are ignored.
 */
import { existsSync } from "node:fs";
import path from "node:path";

const CONTENT_DIR = path.join(process.cwd(), "content");

function main(): void {
  if (!existsSync(CONTENT_DIR)) {
    console.log("content-check: no content/ directory yet — nothing to validate (W0 stub).");
    return;
  }

  console.log(
    "content-check: content/ exists but the validator is still the W0 stub. " +
      "Implement scripts/content-check.ts (W1-T4) before relying on this gate.",
  );
}

main();
