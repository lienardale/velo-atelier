/**
 * The branch-protection contract.
 *
 * Branch protection on `main` lists status-check *names*, as free text. Rename a
 * job in a workflow and the required check silently stops existing: GitHub
 * keeps waiting for a context that will never report, or — worse, if the rule
 * was configured with "require checks that have run" — merges without it.
 *
 * So the list lives here, in code, and this test asserts that the workflows
 * produce exactly it. W5-T1 reads `REQUIRED_CHECKS` to configure the branch
 * protection rule instead of retyping twenty strings.
 *
 * Three contexts are deliberately NOT required:
 *   - `e2e (mobile-webkit)`  — Linux WebKit is not iOS Safari; it runs with
 *     continue-on-error and informs rather than blocks.
 *   - `visual-baseline-guard` — its own path-filtered workflow
 *     (visual-baseline-guard.yml); it does not run on most PRs, and a required
 *     context that never reports blocks the merge forever.
 *   - `renovate-config-validator` — path-filtered the same way
 *     (renovate-config.yml, `renovate.json` only), and for the same reason it
 *     must never be required.
 */
import { describe, expect, it } from "vitest";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { parse } from "yaml";

/** The exact contexts branch protection on `main` requires. */
export const REQUIRED_CHECKS = [
  "nvmrc-check",
  "lint",
  "typecheck",
  "content",
  "unit",
  "integration",
  "coverage (80%)",
  "build",
  "e2e (desktop-chromium)",
  "e2e (mobile-chromium)",
  "e2e (mobile-landscape)",
  "e2e (mobile-narrow)",
  "e2e (no-webgl)",
  "lighthouse",
  "perf",
  "secrets scan (gitleaks)",
  "npm audit (audit-ci)",
  "SAST (semgrep)",
  "trivy fs scan",
  "CodeQL",
] as const;

/** Contexts the workflows produce that are intentionally not blocking. */
export const NON_BLOCKING_CONTEXTS = [
  "e2e (mobile-webkit)",
  "visual-baseline-guard",
  "renovate-config-validator",
] as const;

const WORKFLOW_DIR = path.join(process.cwd(), ".github", "workflows");
const CI_WORKFLOW = path.join(WORKFLOW_DIR, "ci.yml");
const CODEQL_WORKFLOW = path.join(WORKFLOW_DIR, "codeql.yml");
const GUARD_WORKFLOW = path.join(WORKFLOW_DIR, "visual-baseline-guard.yml");
const RENOVATE_WORKFLOW = path.join(WORKFLOW_DIR, "renovate-config.yml");
/** Not a PR workflow: push + workflow_dispatch, so it reports on no pull request. */
const MIGRATE_WORKFLOW = path.join(WORKFLOW_DIR, "migrate-preview.yml");

/** Every workflow that reports a status context on a pull request. */
const PR_WORKFLOWS = [CI_WORKFLOW, CODEQL_WORKFLOW, GUARD_WORKFLOW, RENOVATE_WORKFLOW];

interface MatrixInclude {
  [key: string]: unknown;
  optional?: boolean;
}

interface WorkflowJob {
  name?: string;
  env?: Record<string, string>;
  "timeout-minutes"?: number;
  steps?: { run?: string; uses?: string; name?: string }[];
  strategy?: {
    matrix?: Record<string, unknown> & { include?: MatrixInclude[] };
  };
}

interface Workflow {
  /**
   * GitHub accepts three spellings of `on:` — a mapping
   * (`on: {pull_request: {branches: [main]}}`), a sequence (`on: [pull_request]`)
   * and a bare scalar (`on: push`) — and the YAML parser mirrors them as an
   * object, an **array** and a **string**. Typed as the union so nothing may
   * index it without narrowing: `Object.hasOwn(on, "pull_request")` answers
   * `false` on the array form, which is how a sequence-form workflow stayed
   * invisible to the one test whose job is to notice an unlisted workflow.
   */
  on?: Record<string, unknown> | string[] | string;
  jobs: Record<string, WorkflowJob>;
}

interface Context {
  context: string;
  optional: boolean;
  jobId: string;
}

function loadWorkflow(file: string): Workflow {
  // eslint-disable-next-line security/detect-non-literal-fs-filename -- every caller passes one of the module constants above, or a file listed from WORKFLOW_DIR.
  return parse(readFileSync(file, "utf8")) as Workflow;
}

/**
 * The event names a workflow's `on:` declares, whichever of the three YAML
 * spellings it used (see `Workflow.on`).
 *
 * Found by probe: a `.github/workflows/zz-probe.yml` carrying `on: [pull_request]`
 * and a brand-new job name left all 22 tests in this file green, because the
 * exhaustiveness check below reached for a property on an array.
 */
function triggerEvents(on: Workflow["on"]): string[] {
  if (typeof on === "string") return [on];
  if (Array.isArray(on)) return on.map(String);
  if (on && typeof on === "object") return Object.keys(on);
  return [];
}

/**
 * The `on:` mapping, for the per-workflow assertions below — each of which
 * pins the mapping form for its own file, so the narrowing is not a guess.
 */
function triggerMap(workflow: Workflow): Record<string, unknown> {
  const on = workflow.on;
  return on !== null && typeof on === "object" && !Array.isArray(on) ? on : {};
}

/**
 * Both events that make a workflow report a status context on a pull request.
 * `pull_request_target` runs on the BASE repository with secrets, so a job of
 * one is at least as consequential as a `pull_request` job, never less.
 */
const PR_EVENTS = ["pull_request", "pull_request_target"] as const;

/** Whether a workflow can report a status context on a pull request at all. */
function reportsOnPullRequest(workflow: Workflow): boolean {
  return triggerEvents(workflow.on).some((event) =>
    PR_EVENTS.includes(event as (typeof PR_EVENTS)[number]),
  );
}

/** Every workflow file on disk, PR-reporting or not. */
function workflowFiles(): string[] {
  return readdirSync(WORKFLOW_DIR)
    .filter((file) => /\.ya?ml$/.test(file))
    .sort()
    .map((file) => path.join(WORKFLOW_DIR, file));
}

/**
 * A job produces one status context per matrix combination. Only the single
 * `${{ matrix.<key> }}` placeholder form is supported — if a workflow ever
 * needs more, this helper (and the reader's mental model) must grow with it.
 */
function contextsOf(jobId: string, job: WorkflowJob): Context[] {
  const name = job.name ?? jobId;
  const placeholder = /\$\{\{\s*matrix\.([A-Za-z0-9_]+)\s*\}\}/.exec(name);
  const matrix = job.strategy?.matrix;

  if (!placeholder || !matrix) {
    return [{ context: name, optional: false, jobId }];
  }

  const key = placeholder[1];
  // eslint-disable-next-line security/detect-object-injection -- `key` was captured from the job's own `name:` in a committed workflow file.
  const values = matrix[key];
  if (!Array.isArray(values)) {
    return [{ context: name, optional: false, jobId }];
  }

  const optionalValues = new Set(
    (matrix.include ?? [])
      .filter((entry) => entry.optional === true)
      // eslint-disable-next-line security/detect-object-injection -- same `key`, same committed workflow file.
      .map((entry) => String(entry[key])),
  );

  return values.map((value) => ({
    context: name.replace(placeholder[0], String(value)),
    optional: optionalValues.has(String(value)),
    jobId,
  }));
}

function allContexts(): Context[] {
  return PR_WORKFLOWS.map(loadWorkflow).flatMap((workflow) =>
    Object.entries(workflow.jobs).flatMap(([jobId, job]) => contextsOf(jobId, job)),
  );
}

/** A job's `run:` steps must be `npm ci` or one `bash scripts/ci/<step>.sh`. */
function inlinedSteps(workflow: Workflow): string[] {
  const offenders: string[] = [];
  for (const [jobId, job] of Object.entries(workflow.jobs)) {
    for (const step of job.steps ?? []) {
      if (!step.run) continue;
      const isNpmCi = step.run.startsWith("npm ci");
      const isCiScript = /^bash scripts\/ci\/[a-z0-9-]+\.sh$/.test(step.run.trim());
      // The one GitHub-only line: coverage-summary.json -> the job summary.
      const isSummaryLine = step.run.startsWith("jq ") && step.run.includes("GITHUB_STEP_SUMMARY");
      if (!isNpmCi && !isCiScript && !isSummaryLine) {
        offenders.push(`${jobId}: ${step.run.split("\n")[0]}`);
      }
    }
  }
  return offenders;
}

describe("required status checks", () => {
  it("lists 20 unique contexts", () => {
    expect(new Set(REQUIRED_CHECKS).size).toBe(REQUIRED_CHECKS.length);
    expect(REQUIRED_CHECKS).toHaveLength(20);
  });

  it("every required check is produced by a workflow job", () => {
    const produced = new Set(allContexts().map((c) => c.context));
    const missing = REQUIRED_CHECKS.filter((check) => !produced.has(check));
    expect(missing, `contexts named in REQUIRED_CHECKS but produced by no job`).toEqual([]);
  });

  it("every workflow context is either required or explicitly non-blocking", () => {
    const known = new Set<string>([...REQUIRED_CHECKS, ...NON_BLOCKING_CONTEXTS]);
    const unexpected = allContexts()
      .map((c) => c.context)
      .filter((context) => !known.has(context));
    expect(
      unexpected,
      "a new job must be added to REQUIRED_CHECKS (and to branch protection) " +
        "or to NON_BLOCKING_CONTEXTS with a reason",
    ).toEqual([]);
  });

  it("no required check is allowed to fail silently", () => {
    const optional = allContexts()
      .filter((c) => c.optional)
      .map((c) => c.context);
    expect(optional).toEqual(["e2e (mobile-webkit)"]);
    for (const context of optional) {
      expect(REQUIRED_CHECKS).not.toContain(context);
    }
  });

  it("no context is reported by two jobs", () => {
    // Two jobs with one name report into ONE status context, and whichever
    // finishes last wins it: a skipped copy can overwrite a real failure.
    const seen = new Map<string, string[]>();
    for (const { context, jobId } of allContexts()) {
      seen.set(context, [...(seen.get(context) ?? []), jobId]);
    }
    const shared = [...seen].filter(([, jobs]) => jobs.length > 1);
    expect(shared, "a status context produced by more than one job").toEqual([]);
  });

  it("PR_WORKFLOWS is every workflow that can report on a pull request", () => {
    // `allContexts()` walks PR_WORKFLOWS and nothing else, so a new workflow
    // with a `pull_request:` trigger that nobody adds to that list produces a
    // status context no assertion in this file ever sees — neither "required
    // or explicitly non-blocking" nor the duplicate-context check.
    //
    // Via `triggerEvents`, not a property lookup: this check used
    // `Object.hasOwn(on, "pull_request")`, which is false for `on: [pull_request]`
    // — so the one spelling it had to catch was the one it could not see.
    const onPullRequest = workflowFiles().filter((file) =>
      reportsOnPullRequest(loadWorkflow(file)),
    );
    expect(onPullRequest.map((file) => path.basename(file)).sort()).toEqual(
      PR_WORKFLOWS.map((file) => path.basename(file)).sort(),
    );
  });

  it("notices a pull-request trigger in every spelling GitHub accepts", () => {
    // The check above is only as good as this predicate, and the predicate was
    // the bug: all six workflows here use the mapping form, so no file on disk
    // can tell a working version from a broken one. These are parsed by the same
    // parser, so they are evidence rather than a restatement.
    const reports = (yaml: string) => reportsOnPullRequest(parse(yaml) as Workflow);

    // Mapping — the form every workflow in this repository happens to use.
    expect(reports("on:\n  pull_request:\n    branches: [main]\njobs: {}")).toBe(true);
    // Sequence. `Object.hasOwn(["pull_request"], "pull_request")` is false, so
    // this answered `false` and a probe workflow written this way, with a job
    // name in neither REQUIRED_CHECKS nor NON_BLOCKING_CONTEXTS, passed all 22
    // tests in this file.
    expect(reports("on: [pull_request]\njobs: {}")).toBe(true);
    // Scalar.
    expect(reports("on: pull_request\njobs: {}")).toBe(true);
    // `pull_request_target` runs with the base repository's secrets, so it was
    // never less consequential than `pull_request` — and was equally unseen.
    expect(reports("on: [pull_request_target]\njobs: {}")).toBe(true);
    expect(reports("on:\n  pull_request_target:\n    branches: [main]\njobs: {}")).toBe(true);

    // And the negatives, so the predicate is not simply `true`.
    expect(reports("on:\n  push:\n    branches: [main]\n  workflow_dispatch:\njobs: {}")).toBe(
      false,
    );
    expect(reports("on: [push]\njobs: {}")).toBe(false);
    expect(reports("jobs: {}")).toBe(false);
  });

  it("no other workflow reports a required context", () => {
    // A workflow_dispatch run on a PR's branch reports its checks on the PR's
    // head commit, so a job named like a required context races the real one
    // and whichever finishes last decides it. perf.yml's `build` did, until the
    // W4 integration renamed it `build (nightly)`.
    const others = workflowFiles().filter((file) => !PR_WORKFLOWS.includes(file));
    expect(others.map((file) => path.basename(file))).toContain("perf.yml");
    const required = new Set<string>(REQUIRED_CHECKS);
    const clashes = others.flatMap((file) =>
      Object.entries(loadWorkflow(file).jobs)
        .flatMap(([jobId, job]) => contextsOf(jobId, job))
        .filter(({ context }) => required.has(context))
        .map(({ context }) => `${path.basename(file)}: ${context}`),
    );
    expect(clashes, "a job outside the PR workflows named like a required check").toEqual([]);
  });
});

/**
 * A workflow's `run:` is a string. Nothing type-checks it, nothing resolves it,
 * and the tests above assert only that a job runs the RIGHT literal — so
 * deleting or renaming `scripts/ci/<step>.sh` left every one of them green and
 * the failure waiting on GitHub, in a job that is often the only one that runs
 * (`visual-baseline-guard`, `renovate-config-validator`, `migrate-preview`).
 * Found by mutation: moving the two W5 scripts out of the tree changed no test
 * result.
 */
describe("every script a workflow runs exists", () => {
  /** Every `scripts/ci/<name>.sh` named by any `run:` in any workflow. */
  function referencedScripts(): { where: string; script: string }[] {
    const found: { where: string; script: string }[] = [];
    for (const file of workflowFiles()) {
      for (const [jobId, job] of Object.entries(loadWorkflow(file).jobs ?? {})) {
        for (const step of job.steps ?? []) {
          for (const script of step.run?.match(/\bscripts\/[A-Za-z0-9_./-]+\.(?:sh|ts)\b/g) ?? []) {
            found.push({ where: `${path.basename(file)} / ${jobId}`, script });
          }
        }
      }
    }
    return found;
  }

  it("finds the scripts the workflows are known to call", () => {
    // A guard on the guard: a regex that matched nothing would make the
    // assertion below vacuously true, which is the hole it is here to close.
    const scripts = new Set(referencedScripts().map((entry) => entry.script));
    expect(scripts).toContain("scripts/ci/renovate-config.sh");
    expect(scripts).toContain("scripts/ci/migrate-preview.sh");
    expect(scripts).toContain("scripts/ci/visual-label.sh");
    expect(scripts.size).toBeGreaterThan(10);
  });

  it("every one of them is a file in this repository", () => {
    const missing = referencedScripts()
      // eslint-disable-next-line security/detect-non-literal-fs-filename -- the path was matched out of a committed workflow file by the regex above.
      .filter(({ script }) => !existsSync(path.join(process.cwd(), script)))
      .map(({ where, script }) => `${where}: ${script}`);
    expect(missing, "a workflow runs a script that is not in the repository").toEqual([]);
  });
});

describe("ci.yml job bodies", () => {
  const workflow = loadWorkflow(CI_WORKFLOW);

  it("runs only `npm ci` and scripts/ci/*.sh", () => {
    expect(
      inlinedSteps(workflow),
      "inlining a command here breaks the `npm run ci:local` mirror — put it in scripts/ci/",
    ).toEqual([]);
  });

  it("pins Node through .nvmrc everywhere", () => {
    const setups = Object.values(workflow.jobs).flatMap((job) =>
      (job.steps ?? []).filter((step) => step.uses?.startsWith("actions/setup-node")),
    );
    expect(setups.length).toBeGreaterThan(0);
    for (const step of setups) {
      expect(JSON.stringify(step)).toContain(".nvmrc");
    }
  });

  it("cancels superseded runs on branches but never on main", () => {
    const raw = readFileSync(CI_WORKFLOW, "utf8");
    expect(raw).toContain("cancel-in-progress: ${{ github.ref != 'refs/heads/main' }}");
  });
});

/**
 * §7.2: a PR touching `tests/e2e/__screenshots__/**` must carry the
 * `visual-baseline` label. The LABEL is the check's input, so the check has to
 * run again whenever a label is added or removed — which ci.yml's default
 * `pull_request` types never do — and only on PRs that change a baseline.
 */
describe("visual-baseline-guard.yml", () => {
  const workflow = loadWorkflow(GUARD_WORKFLOW);

  it("runs on pull requests only, again on every label change", () => {
    expect(Object.keys(triggerMap(workflow))).toEqual(["pull_request"]);
    const trigger = triggerMap(workflow).pull_request as { types?: string[]; paths?: string[] };
    expect([...(trigger.types ?? [])].sort()).toEqual(
      ["labeled", "opened", "reopened", "synchronize", "unlabeled"].sort(),
    );
  });

  it("only on pull requests that change a baseline", () => {
    const trigger = triggerMap(workflow).pull_request as { paths?: string[] };
    expect(trigger.paths).toEqual(["tests/e2e/__screenshots__/**"]);
  });

  it("is one job whose body is the label script", () => {
    expect(allContexts().filter((c) => c.context === "visual-baseline-guard")).toEqual([
      { context: "visual-baseline-guard", optional: false, jobId: "visual-baseline-guard" },
    ]);
    const runs = Object.values(workflow.jobs).flatMap((job) =>
      (job.steps ?? []).flatMap((step) => (step.run ? [step.run.trim()] : [])),
    );
    expect(runs).toEqual(["bash scripts/ci/visual-label.sh"]);
    expect(inlinedSteps(workflow)).toEqual([]);
  });
});

/**
 * `renovate.json` is read by Renovate and by nothing else — no ESLint rule, no
 * `tsc`, no CI job, and the `$schema` line is honoured by editors only. The
 * file's first reader was the service, which rejected it and opened no PR at
 * all (`.debug/016` §4). `renovate-config-validator` is the one reader the
 * repository can host itself; the install is slow, so the job is path-filtered
 * — and therefore must never be a required context.
 */
describe("renovate-config.yml", () => {
  const workflow = loadWorkflow(RENOVATE_WORKFLOW);

  it("runs on pull requests and on main, only when renovate.json changes", () => {
    expect([...Object.keys(triggerMap(workflow))].sort()).toEqual(["pull_request", "push"]);
    const pullRequest = triggerMap(workflow).pull_request as { paths?: string[] };
    const push = triggerMap(workflow).push as { branches?: string[]; paths?: string[] };
    expect(pullRequest.paths).toEqual(["renovate.json"]);
    expect(push.branches).toEqual(["main"]);
    expect(push.paths).toEqual(["renovate.json"]);
  });

  it("is one non-blocking job whose body is the validator script", () => {
    expect(allContexts().filter((c) => c.context === "renovate-config-validator")).toEqual([
      {
        context: "renovate-config-validator",
        optional: false,
        jobId: "renovate-config-validator",
      },
    ]);
    expect(NON_BLOCKING_CONTEXTS).toContain("renovate-config-validator");
    expect(REQUIRED_CHECKS).not.toContain("renovate-config-validator");
    const runs = Object.values(workflow.jobs).flatMap((job) =>
      (job.steps ?? []).flatMap((step) => (step.run ? [step.run.trim()] : [])),
    );
    expect(runs).toEqual(["bash scripts/ci/renovate-config.sh"]);
    expect(inlinedSteps(workflow)).toEqual([]);
  });
});

/**
 * `scripts/vercel-build.sh` migrates only on `VERCEL_ENV=production`, so nothing
 * ever migrated the shared Neon `preview` branch: W5 found it with no
 * `_prisma_migrations` table, six days after it was created (`.debug/016` §3).
 * This workflow is the one writer. It runs on a push to `main` and by hand, so
 * it reports on no pull request and branch protection never waits for it.
 */
describe("migrate-preview.yml", () => {
  const workflow = loadWorkflow(MIGRATE_WORKFLOW);

  it("runs when a migration lands on main, and on demand", () => {
    expect([...Object.keys(triggerMap(workflow))].sort()).toEqual(["push", "workflow_dispatch"]);
    const push = triggerMap(workflow).push as { branches?: string[]; paths?: string[] };
    expect(push.branches).toEqual(["main"]);
    expect(push.paths).toEqual(["prisma/migrations/**"]);
  });

  it("reports no pull-request context", () => {
    expect(PR_WORKFLOWS).not.toContain(MIGRATE_WORKFLOW);
    expect(triggerMap(workflow)).not.toHaveProperty("pull_request");
    const contexts = allContexts().map((c) => c.context);
    expect(contexts).not.toContain("migrate-preview");
  });

  it("fails loudly", () => {
    // A migration that did not apply must turn the run red. `continue-on-error`
    // anywhere in this file would make the preview branch drift silently again,
    // which is the whole failure being fixed.
    expect(readFileSync(MIGRATE_WORKFLOW, "utf8")).not.toContain("continue-on-error");
  });

  it("cannot hold the migration lock for GitHub's six-hour default", () => {
    // The one job here that takes a lock, so the one job that bounds its own
    // runtime. `migrate deploy` holds Prisma's advisory migration lock and
    // `cancel-in-progress: false` queues the next push behind this run, so a
    // wedged run blocks the preview branch's migrations until the timeout —
    // which, unset, is six hours.
    const job = workflow.jobs["migrate-preview"];
    const timeout = job["timeout-minutes"];
    expect(timeout).toBeGreaterThan(0);
    expect(timeout).toBeLessThanOrEqual(30);
  });

  it("is one job: the pinned install, then the migrate script", () => {
    const runs = Object.values(workflow.jobs).flatMap((job) =>
      (job.steps ?? []).flatMap((step) => (step.run ? [step.run.trim()] : [])),
    );
    expect(runs).toEqual([
      "npm ci --no-audit --no-fund --prefer-offline",
      "bash scripts/ci/migrate-preview.sh",
    ]);
    expect(inlinedSteps(workflow)).toEqual([]);
  });

  it("hands the script the secret AND the switch that ends its grace period", () => {
    // GitHub gives a step the empty string for a secret that does not exist,
    // so the script cannot tell "not set up yet" from "deleted, renamed or
    // scoped away" — and while it skips on both, a secret that disappears
    // after the bootstrap puts the job back to green-and-silent, which is the
    // failure shape this workflow exists to remove. The repository VARIABLE is
    // the discriminator: with it set, an empty secret is a red run.
    const env = workflow.jobs["migrate-preview"]?.env ?? {};
    expect(env.NEON_PREVIEW_DIRECT_URL).toBe("${{ secrets.NEON_PREVIEW_DIRECT_URL }}");
    expect(env.PREVIEW_MIGRATIONS_ENABLED).toBe("${{ vars.PREVIEW_MIGRATIONS_ENABLED }}");
  });
});
