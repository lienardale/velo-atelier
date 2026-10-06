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
 *     (renovate-config.yml: `renovate.json`, the validator script and the
 *     workflow file itself), and for the same reason it must never be
 *     required.
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
/**
 * Not a PR workflow: push + workflow_dispatch. Never triggered by a pull
 * request and never a required context — which is not "it reports nothing on
 * a PR": a dispatch aimed at a PR's branch leaves a red, non-required check on
 * that branch's head commit.
 */
const MIGRATE_WORKFLOW = path.join(WORKFLOW_DIR, "migrate-preview.yml");

/** Every workflow that reports a status context on a pull request. */
const PR_WORKFLOWS = [CI_WORKFLOW, CODEQL_WORKFLOW, GUARD_WORKFLOW, RENOVATE_WORKFLOW];

interface MatrixInclude {
  [key: string]: unknown;
  optional?: boolean;
}

interface WorkflowStep {
  run?: string;
  uses?: string;
  name?: string;
  env?: Record<string, string>;
  with?: Record<string, unknown>;
}

interface WorkflowJob {
  name?: string;
  env?: Record<string, string>;
  permissions?: Record<string, string>;
  "timeout-minutes"?: number;
  steps?: WorkflowStep[];
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
  env?: Record<string, string>;
  concurrency?: unknown;
  permissions?: Record<string, string>;
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

  it("no path-filtered workflow produces a required context", () => {
    // The rule the two by-name exclusions above are instances of, held as a
    // rule. GitHub leaves the checks of a workflow skipped by path filtering
    // "Pending", and a pull request that requires one of them can never merge
    // (its documentation says so in those words). Until this test the rule was
    // only ever asserted for a NAME: swapping `nvmrc-check` and
    // `visual-baseline-guard` between the two lists above — still 20 required,
    // one of them now path-filtered — left every test in this file green
    // (measured in review, 2026-10-06), and so did `paths-ignore` on ci.yml.
    //
    // `paths` and `paths-ignore` only. A `branches:` filter is not the same
    // hazard: codeql.yml's `branches: [main]` is where protection applies.
    const required = new Set<string>(REQUIRED_CHECKS);
    const filtered = PR_WORKFLOWS.filter((file) => {
      const triggers = triggerMap(loadWorkflow(file));
      return PR_EVENTS.some((event) => {
        // eslint-disable-next-line security/detect-object-injection -- `event` is one of the two PR_EVENTS literals.
        const trigger = triggers[event];
        return (
          trigger !== null &&
          typeof trigger === "object" &&
          ("paths" in trigger || "paths-ignore" in trigger)
        );
      });
    });
    // A guard on the guard: with nothing recognised as filtered, the loop
    // below would assert nothing at all.
    expect(filtered.map((file) => path.basename(file)).sort()).toEqual([
      "renovate-config.yml",
      "visual-baseline-guard.yml",
    ]);
    for (const file of filtered) {
      const blocking = Object.entries(loadWorkflow(file).jobs)
        .flatMap(([jobId, job]) => contextsOf(jobId, job))
        .map(({ context }) => context)
        .filter((context) => required.has(context));
      expect(
        blocking,
        `${path.basename(file)} is path-filtered and reports a required context`,
      ).toEqual([]);
    }
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
 * `renovate.json` was read by Renovate and by nothing else — no ESLint rule,
 * no `tsc`, no CI job, and the `$schema` line is honoured by editors only. The
 * file's first reader was the service, which rejected it and opened no PR at
 * all (`.debug/016` §4). `renovate-config-validator` is the one reader the
 * repository can host itself, and this workflow is now the second thing that
 * reads the file. The install is the whole of Renovate — ~350 MB on a cold npx
 * cache (not timed on a runner) — so the job is path-filtered, and therefore
 * must never be a required context.
 */
describe("renovate-config.yml", () => {
  const workflow = loadWorkflow(RENOVATE_WORKFLOW);

  /**
   * The file under test, and the two files that ARE the test.
   *
   * This list was `["renovate.json"]`, and the assertion below pinned it there
   * — while `scripts/ci/renovate-config.sh` promised that Renovate's bump of
   * the pinned validator would be "validated by this very job". That bump
   * edits the script and nothing else, so under GitHub's `paths` rule (a
   * workflow runs when at least one changed path matches) the job would not
   * have started on it: the test held the hole open. The same goes for an
   * edit to the workflow file itself.
   */
  const VALIDATED_PATHS = [
    "renovate.json",
    "scripts/ci/renovate-config.sh",
    ".github/workflows/renovate-config.yml",
  ];

  it("runs on pull requests and on main, when the config or its validator changes", () => {
    expect([...Object.keys(triggerMap(workflow))].sort()).toEqual(["pull_request", "push"]);
    const pullRequest = triggerMap(workflow).pull_request as { paths?: string[] };
    const push = triggerMap(workflow).push as { branches?: string[]; paths?: string[] };
    expect(pullRequest.paths).toEqual(VALIDATED_PATHS);
    expect(push.branches).toEqual(["main"]);
    expect(push.paths).toEqual(VALIDATED_PATHS);
  });

  it("lists paths that exist, its own included", () => {
    // A `paths:` entry is free text. One that names a file since renamed
    // matches nothing and says nothing, which is the failure this list was
    // widened to remove.
    for (const entry of VALIDATED_PATHS) {
      // eslint-disable-next-line security/detect-non-literal-fs-filename -- each entry is one of the three literals above.
      expect(existsSync(path.join(process.cwd(), entry)), entry).toBe(true);
    }
    expect(VALIDATED_PATHS).toContain(path.relative(process.cwd(), RENOVATE_WORKFLOW));
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

  it("lets nothing excuse the validator: no `if`, no `continue-on-error`, on the job or on a step", () => {
    // The validator's verdict is the job's verdict only while the job and its
    // step run, and are allowed to fail. `tests/unit/ci/renovate-config.test.ts`
    // held that on the file's TEXT, with `/^\s+if:/m` — which sees `if:` on a
    // line of its own and not as the first key of a step. `- if: false` on the
    // validator step left every test in both files green (measured in review,
    // 2026-10-06): a job that is green because it validated nothing. Parsed,
    // the spelling stops mattering.
    const jobs = Object.entries(workflow.jobs);
    expect(jobs.map(([jobId]) => jobId)).toEqual(["renovate-config-validator"]);
    for (const [jobId, job] of jobs) {
      expect(Object.keys(job), jobId).not.toContain("if");
      expect(Object.keys(job), jobId).not.toContain("continue-on-error");
      const steps = job.steps ?? [];
      // A guard on the guard: with no step read, the loop asserts nothing.
      expect(steps).toHaveLength(3);
      for (const [index, step] of steps.entries()) {
        expect(Object.keys(step), `${jobId}, step ${index + 1}`).not.toContain("if");
        expect(Object.keys(step), `${jobId}, step ${index + 1}`).not.toContain("continue-on-error");
      }
    }
  });
});

/**
 * `scripts/vercel-build.sh` migrates only on `VERCEL_ENV=production`, so nothing
 * ever migrated the shared Neon `preview` branch: W5 found it with no
 * `_prisma_migrations` table, six days after it was created (`.debug/016` §3).
 * This workflow is the one writer. It runs on a push to `main` and by hand:
 * never triggered by a pull request and never a required context, so branch
 * protection never waits for it. (A dispatch aimed at a PR's branch still
 * leaves a red, non-required check on that branch's head commit.)
 */
describe("migrate-preview.yml", () => {
  const workflow = loadWorkflow(MIGRATE_WORKFLOW);

  it("runs when a migration lands on main, and on demand", () => {
    expect([...Object.keys(triggerMap(workflow))].sort()).toEqual(["push", "workflow_dispatch"]);
    const push = triggerMap(workflow).push as { branches?: string[]; paths?: string[] };
    expect(push.branches).toEqual(["main"]);
    expect(push.paths).toEqual(["prisma/migrations/**"]);
  });

  it("is never triggered by a pull request, and never a required context", () => {
    // No `pull_request` trigger, so no pull request ever waits for it. (A
    // `workflow_dispatch` aimed at a PR's branch does leave a `migrate-preview`
    // check on that branch's head commit: refused by the script, red, and — the
    // point of the last line — named like nothing branch protection requires.)
    expect(PR_WORKFLOWS).not.toContain(MIGRATE_WORKFLOW);
    expect(triggerMap(workflow)).not.toHaveProperty("pull_request");
    const contexts = allContexts().map((c) => c.context);
    expect(contexts).not.toContain("migrate-preview");
    expect(REQUIRED_CHECKS).not.toContain("migrate-preview");
  });

  it("fails loudly", () => {
    // A migration that did not apply must turn the run red. `continue-on-error`
    // anywhere in this file would make the preview branch drift silently again,
    // which is the whole failure being fixed.
    expect(readFileSync(MIGRATE_WORKFLOW, "utf8")).not.toContain("continue-on-error");
    // …and so would a job-level `if:`. The workflow's header rejects one by
    // name — a skipped run is a quiet run — and the script fails instead; with
    // `if: github.ref == 'refs/heads/main'` on the job every test here stayed
    // green (measured in review, 2026-10-06).
    expect(workflow.jobs["migrate-preview"]).not.toHaveProperty("if");
  });

  it("never cancels a migration in flight, and never runs two at once", () => {
    // Stated in the workflow, in CLAUDE.md and in a comment of this file, and
    // read by no test: `cancel-in-progress: true`, the whole block deleted and
    // a per-run group each left the suite green (measured in review,
    // 2026-10-06). The parsed value, not the text — the boolean `false`, where
    // a quoted "false" or an expression would be something else — and the
    // group as one fixed string, with no ref and no run id in it: one database,
    // one queue.
    expect(workflow.concurrency).toEqual({ group: "migrate-preview", "cancel-in-progress": false });
  });

  it("holds a read-only token, at both levels", () => {
    // The job writes to a database, never to the repository. The repository's
    // default workflow token was read-only when the review looked (`gh api
    // …/actions/permissions/workflow`, 2026-10-06), so this is the second lock
    // and not the only one — which is exactly why nothing would have noticed
    // it going: with both blocks deleted every test stayed green.
    expect(workflow.permissions).toEqual({ contents: "read" });
    expect(workflow.jobs["migrate-preview"].permissions).toEqual({ contents: "read" });
  });

  it("cannot block the preview branch's migrations for GitHub's six-hour default", () => {
    // The one job here that bounds its own runtime, because it is the one job
    // whose queue is a database's migrations. Other workflows queue their
    // `main` runs too (ci.yml, codeql.yml and renovate-config.yml all set
    // `cancel-in-progress` to false on `main`), and a hung run there delays a
    // CI result. Here `cancel-in-progress: false` keeps the group above
    // occupied for as long as this run lasts, so one that hangs — on a
    // connection, on a DDL statement — blocks the preview SCHEMA until the
    // timeout, which, unset, is six hours.
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

  const MIGRATE_STEP = "bash scripts/ci/migrate-preview.sh";
  const isMigrateStep = (step: WorkflowStep): boolean => step.run?.trim() === MIGRATE_STEP;

  it("hands the migrate step the secret, the switch and the endpoint it must match", () => {
    // Three names, and each one is a refusal the script cannot make without it.
    //
    // The secret. GitHub gives a step the empty string for one that does not
    // exist, so the script cannot tell "not set up yet" from "deleted, renamed
    // or scoped away" — and while it skips on both, a secret that disappears
    // after the bootstrap puts the job back to green-and-silent, the failure
    // shape this workflow exists to remove. The switch (a repository VARIABLE)
    // is the discriminator: with it set, an empty secret is a red run.
    //
    // The endpoint (a VARIABLE too: `.debug/016` §3 already publishes the
    // name). Production is in the same Neon project and its connection string
    // has the same shape; nothing but this tells the script which of the two
    // the secret holds.
    //
    // `toEqual`, not three `toBe`s: a FOURTH name on the step that holds the
    // connection string is a change somebody should have to make here too.
    //
    // And the WHOLE step, not its `env` alone. This compared `migrate[0].env`,
    // and "fails loudly" above looks for an `if:` on the JOB — so a step-level
    // `if:` on this very step, as its first key or its second, left every
    // test green (measured in review, 2026-10-06). That is quieter than the
    // job-level one the file already forbids: the job is GREEN, its last step
    // skipped, and nothing was migrated. Two keys, so anything else that can
    // change what this step does or whether it counts — `if`,
    // `continue-on-error`, `shell`, `working-directory` — fails here.
    const steps = workflow.jobs["migrate-preview"].steps ?? [];
    const migrate = steps.filter(isMigrateStep);
    expect(migrate).toHaveLength(1);
    expect(migrate[0]).toEqual({
      run: MIGRATE_STEP,
      env: {
        NEON_PREVIEW_DIRECT_URL: "${{ secrets.NEON_PREVIEW_DIRECT_URL }}",
        PREVIEW_MIGRATIONS_ENABLED: "${{ vars.PREVIEW_MIGRATIONS_ENABLED }}",
        NEON_PREVIEW_ENDPOINT: "${{ vars.NEON_PREVIEW_ENDPOINT }}",
      },
    });
  });

  it("keeps the secret out of every other step, the install first of all", () => {
    // This test used to REQUIRE the opposite. It read the job-level `env:` for
    // the secret, so the placement that exports a database credential to the
    // checkout and setup-node actions and to `npm ci` — every dependency's
    // install script, and this project's `postinstall` — was the only one that
    // passed, and moving it to the one step that needs it failed the suite
    // (measured in review, 2026-10-06).
    //
    // So: take the migrate step out, and nothing left in the file may mention
    // a secret at all — not the workflow's `env:`, not the job's, not another
    // step's `env:`, `with:` or `run:`. A `uses:` step handed the connection
    // string through `with:` was invisible to the old assertion too.
    const parsed = loadWorkflow(MIGRATE_WORKFLOW);
    const job = parsed.jobs["migrate-preview"];
    const before = job.steps?.length ?? 0;
    job.steps = (job.steps ?? []).filter((step) => !isMigrateStep(step));
    expect(job.steps).toHaveLength(before - 1);

    // The WORD, not one spelling of it. `not.toContain("secrets.")` matched
    // `secrets.NAME` and the literal name below, and neither of the two other
    // ways an expression reaches the store: `${{ toJSON(secrets) }}` — every
    // secret the repository has — and `${{ secrets[format('NEON_{0}', …)] }}`,
    // each on the `npm ci` step, each green (measured in review, 2026-10-06).
    // The parser has already dropped the comments, so the word can only be
    // in something that runs.
    const everythingElse = JSON.stringify(parsed);
    expect(everythingElse).not.toMatch(/\bsecrets\b/);
    expect(everythingElse).not.toContain("NEON_PREVIEW_DIRECT_URL");

    // And by name, so the two levels a tidy-up would reach for first fail with
    // a sentence rather than a diff of JSON.
    expect(parsed.env, "workflow-level env").toBeUndefined();
    expect(job.env, "job-level env").toEqual({ HUSKY: "0" });
  });

  it("does not leave the checkout token behind for the install", () => {
    // Nothing after the checkout talks to GitHub, and `npm ci` runs lifecycle
    // scripts here (the workflow says why `--ignore-scripts` was not taken).
    const checkout = (workflow.jobs["migrate-preview"].steps ?? []).filter((step) =>
      step.uses?.startsWith("actions/checkout@"),
    );
    expect(checkout).toHaveLength(1);
    expect(checkout[0].with).toEqual({ "persist-credentials": false });
  });
});
