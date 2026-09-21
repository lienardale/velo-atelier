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
 *   - `detect changes`       — plumbing for the other jobs' `if:`.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
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
  "detect changes",
  "e2e (mobile-webkit)",
  "visual-baseline-guard",
] as const;

const WORKFLOW_DIR = path.join(process.cwd(), ".github", "workflows");
const CI_WORKFLOW = path.join(WORKFLOW_DIR, "ci.yml");
const CODEQL_WORKFLOW = path.join(WORKFLOW_DIR, "codeql.yml");
const GUARD_WORKFLOW = path.join(WORKFLOW_DIR, "visual-baseline-guard.yml");

/** Every workflow that reports a status context on a pull request. */
const PR_WORKFLOWS = [CI_WORKFLOW, CODEQL_WORKFLOW, GUARD_WORKFLOW];

interface MatrixInclude {
  [key: string]: unknown;
  optional?: boolean;
}

interface WorkflowJob {
  name?: string;
  steps?: { run?: string; uses?: string; name?: string }[];
  strategy?: {
    matrix?: Record<string, unknown> & { include?: MatrixInclude[] };
  };
}

interface Workflow {
  on?: Record<string, unknown>;
  jobs: Record<string, WorkflowJob>;
}

interface Context {
  context: string;
  optional: boolean;
  jobId: string;
}

function loadWorkflow(file: string): Workflow {
  // eslint-disable-next-line security/detect-non-literal-fs-filename -- every caller passes one of the module constants above.
  return parse(readFileSync(file, "utf8")) as Workflow;
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
    expect(Object.keys(workflow.on ?? {})).toEqual(["pull_request"]);
    const trigger = workflow.on?.pull_request as { types?: string[]; paths?: string[] };
    expect([...(trigger.types ?? [])].sort()).toEqual(
      ["labeled", "opened", "reopened", "synchronize", "unlabeled"].sort(),
    );
  });

  it("only on pull requests that change a baseline", () => {
    const trigger = workflow.on?.pull_request as { paths?: string[] };
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
