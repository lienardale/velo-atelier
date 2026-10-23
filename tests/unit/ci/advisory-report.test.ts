/**
 * `scripts/ci/advisory-report.sh` is the only step of advisories.yml that holds
 * a write token, and the only way a red scheduled run of `audit` or `trivy`
 * reaches a person. Per GitHub's documentation a failed scheduled run emails
 * only the user who last changed the cron line, so without this the workflow
 * would repeat the 41 silent hours of 2026-10-07 with a red run nobody opens
 * (`.debug/017` §2.7).
 *
 * What it must do, each held by a case below:
 *   - write ONE issue on `main`'s first red run, and comment on it after that;
 *   - treat anything but `success` as red — `cancelled`, `skipped`, and an
 *     EMPTY result, which is how a job renamed without its `needs:` arrives;
 *   - write nothing on a green run, nothing for another ref, and nothing
 *     outside GitHub Actions, where it would post with the shell's own `gh`;
 *   - go red itself when the message cannot be delivered;
 *   - never close an issue: one green run is not a verdict on a day an
 *     advisory lands (`.debug/017` §2.6).
 *
 * The script is EXECUTED, every time through one sandbox: a stand-in `gh`
 * (a Node script, by absolute path to this Node) that records each call's
 * arguments as JSON and answers what the case says. `HOME` is an empty
 * directory and `PATH` the stand-in's directory and the system's two, for the
 * reason renovate-config.test.ts gives — `_lib.sh` sources nvm when it finds
 * one, and nvm puts its own `bin` first. `GH_TOKEN` is a dummy, so a real `gh`
 * reached by mistake (`/usr/bin/gh` on a runner) could authenticate nothing.
 */

import { spawnSync } from "node:child_process";
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

const root = process.cwd();
const SCRIPT_PATH = "scripts/ci/advisory-report.sh";
const ISSUE_TITLE = "Scheduled advisory check: main is red";
const REPOSITORY = "lienardale/velo-atelier";
const RUN_URL = `https://github.com/${REPOSITORY}/actions/runs/4242`;
const SHA = "0123456789abcdef0123456789abcdef01234567";

/** Far above a run's cost (no network, no nvm); Vitest cannot interrupt a `spawnSync`. */
const SPAWN_TIMEOUT_MS = 60_000;

/**
 * The stand-in. `issue list` prints `STUB_GH_LIST`, the way the real one
 * prints its `--jq` output; the subcommand named in `STUB_GH_FAIL` exits 1.
 */
const STAND_IN = `#!${process.execPath}
const fs = require("node:fs");
const args = process.argv.slice(2);
fs.appendFileSync(process.env.STUB_GH_LOG, JSON.stringify(args) + "\\n");
const command = args.slice(0, 2).join(" ");
if (process.env.STUB_GH_FAIL === command) {
  process.stderr.write("stand-in gh: " + command + " failed\\n");
  process.exit(1);
}
if (command === "issue list") process.stdout.write(process.env.STUB_GH_LIST ?? "");
if (command === "issue create") process.stdout.write("https://github.com/${REPOSITORY}/issues/99\\n");
`;

let sandbox: string;

/* eslint-disable security/detect-non-literal-fs-filename -- every path below is built from mkdtemp */
beforeEach(() => {
  sandbox = mkdtempSync(join(tmpdir(), "velo-advisory-report-"));
  mkdirSync(join(sandbox, "bin"));
  mkdirSync(join(sandbox, "home"));
  const stub = join(sandbox, "bin", "gh");
  writeFileSync(stub, STAND_IN);
  chmodSync(stub, 0o755);
});

afterEach(() => {
  rmSync(sandbox, { recursive: true, force: true });
});

/** What Actions sets for a scheduled run on `main`, before the case's changes. */
const SCHEDULED_ON_MAIN = {
  GITHUB_ACTIONS: "true",
  GITHUB_REF: "refs/heads/main",
  GITHUB_REPOSITORY: REPOSITORY,
  GITHUB_SERVER_URL: "https://github.com",
  GITHUB_RUN_ID: "4242",
  GITHUB_SHA: SHA,
  AUDIT_RESULT: "success",
  TRIVY_RESULT: "success",
};

interface Run {
  status: number;
  output: string;
  /** Every `gh` call, as its argument vector. */
  calls: string[][];
}

/**
 * Run the script, the ONLY way this file does. `undefined` removes a variable
 * from the scheduled-run environment above.
 */
function report(
  changes: Record<string, string | undefined>,
  stand: { list?: string; fail?: string } = {},
): Run {
  const log = join(sandbox, "gh-calls.jsonl");
  const github: Record<string, string> = {};
  for (const [key, value] of Object.entries({ ...SCHEDULED_ON_MAIN, ...changes })) {
    // eslint-disable-next-line security/detect-object-injection -- keys come from the literal above and the cases below.
    if (value !== undefined) github[key] = value;
  }
  const result = spawnSync("bash", [join(root, SCRIPT_PATH)], {
    cwd: root,
    encoding: "utf8",
    timeout: SPAWN_TIMEOUT_MS,
    env: {
      PATH: [join(sandbox, "bin"), "/usr/bin", "/bin"].join(":"),
      HOME: join(sandbox, "home"),
      // Spelled out because Next augments `NodeJS.ProcessEnv` to require it.
      NODE_ENV: process.env.NODE_ENV ?? "test",
      GH_TOKEN: "stand-in-token-that-authenticates-nothing",
      STUB_GH_LOG: log,
      ...(stand.list === undefined ? {} : { STUB_GH_LIST: stand.list }),
      ...(stand.fail === undefined ? {} : { STUB_GH_FAIL: stand.fail }),
      ...github,
    },
  });
  if (result.error) throw result.error;
  const calls = existsSync(log)
    ? readFileSync(log, "utf8")
        .split("\n")
        .filter(Boolean)
        .map((line) => JSON.parse(line) as string[])
    : [];
  return {
    status: result.status ?? -1,
    output: `${result.stdout ?? ""}${result.stderr ?? ""}`,
    calls,
  };
}
/* eslint-enable security/detect-non-literal-fs-filename */

/** The value that follows `flag` in one call. */
function flag(call: string[], name: string): string | undefined {
  const index = call.indexOf(name);
  return index === -1 ? undefined : call[index + 1];
}

describe("advisory-report.sh on a green run", () => {
  it("writes nothing, and asks GitHub nothing", () => {
    const run = report({});
    expect(run.status).toBe(0);
    expect(run.calls).toEqual([]);
    expect(run.output).toContain("nothing to report");
  });

  it("leaves an open issue open: it never asks for the list it would close from", () => {
    // Not even the listing: a green run that looked the issue up would be one
    // line away from closing it, and §2.6 is why it must not.
    const run = report({}, { list: `12\t${ISSUE_TITLE}\n` });
    expect(run.calls).toEqual([]);
  });
});

describe("advisory-report.sh on a red run on main", () => {
  it("opens the issue when none is open", () => {
    const run = report({ AUDIT_RESULT: "failure" }, { list: "" });
    expect(run.status).toBe(0);
    expect(run.calls.map((call) => call.slice(0, 2).join(" "))).toEqual([
      "issue list",
      "issue create",
    ]);
    const [list, create] = run.calls;
    expect(flag(list, "--repo")).toBe(REPOSITORY);
    expect(flag(list, "--state")).toBe("open");
    // A listing, never `--search`: the search index can lag a just-opened
    // issue, and a lag here is a second issue.
    expect(list).not.toContain("--search");
    // The stand-in prints `STUB_GH_LIST` whatever filter it is handed, so the
    // filter is pinned here: one `<number><TAB><title>` line per issue is what
    // the script's loop reads.
    expect(flag(list, "--json")).toBe("number,title");
    expect(flag(list, "--jq")).toBe('.[] | "\\(.number)\\t\\(.title)"');
    expect(flag(create, "--repo")).toBe(REPOSITORY);
    expect(flag(create, "--title")).toBe(ISSUE_TITLE);
    const body = flag(create, "--body") ?? "";
    expect(body).toContain(RUN_URL);
    expect(body).toContain(SHA);
    expect(body).toContain("| `npm audit (scheduled)` | `scripts/ci/audit.sh` | failure |");
    expect(body).toContain("| `trivy fs scan (scheduled)` | `scripts/ci/trivy.sh` | success |");
  });

  it("comments on the open issue instead of opening a second one", () => {
    const run = report(
      { TRIVY_RESULT: "failure" },
      { list: `7\tSomething else entirely\n12\t${ISSUE_TITLE}\n` },
    );
    expect(run.status).toBe(0);
    expect(run.calls.map((call) => call.slice(0, 3).join(" "))).toEqual([
      expect.stringMatching(/^issue list /),
      "issue comment 12",
    ]);
    const body = flag(run.calls[1], "--body") ?? "";
    expect(body).toContain(RUN_URL);
    expect(body).toContain("| `trivy fs scan (scheduled)` | `scripts/ci/trivy.sh` | failure |");
  });

  it("matches the title exactly, not a title that starts with it", () => {
    const run = report(
      { AUDIT_RESULT: "failure" },
      { list: `3\t${ISSUE_TITLE} (2026-10-07)\n4\tRe: ${ISSUE_TITLE}\n` },
    );
    expect(run.calls.map((call) => call.slice(0, 2).join(" "))).toEqual([
      "issue list",
      "issue create",
    ]);
  });

  it.each([
    ["cancelled", "cancelled"],
    ["skipped", "skipped"],
    // How `needs.<job>.result` arrives when a job was renamed and `needs:`
    // was not: the report must fail closed, not read silence as green.
    ["", "(empty)"],
    // Not one of GitHub's words: shown as what it is not, never pasted in.
    ["Success <img src=x>", "(unexpected value)"],
  ])("treats an audit result of %j as red, and shows it as %s", (result, shown) => {
    const run = report({ AUDIT_RESULT: result }, { list: "" });
    expect(run.status).toBe(0);
    const create = run.calls.find((call) => call[1] === "create");
    expect(create, "an issue must be opened").toBeDefined();
    expect(flag(create ?? [], "--body")).toContain(
      `| \`npm audit (scheduled)\` | \`scripts/ci/audit.sh\` | ${shown} |`,
    );
  });

  it("treats an UNSET result as red too", () => {
    const run = report({ TRIVY_RESULT: undefined }, { list: "" });
    expect(run.calls.map((call) => call.slice(0, 2).join(" "))).toEqual([
      "issue list",
      "issue create",
    ]);
  });
});

describe("advisory-report.sh writes nothing where it has no business to", () => {
  it("on a red run of another ref: the run's own red is in front of whoever dispatched it", () => {
    const run = report({ GITHUB_REF: "refs/heads/feature", AUDIT_RESULT: "failure" });
    expect(run.status).toBe(0);
    expect(run.calls).toEqual([]);
    expect(run.output).toContain("not refs/heads/main: no issue written");
  });

  it("outside GitHub Actions, where it would post with the shell's own credentials", () => {
    const run = report({ GITHUB_ACTIONS: undefined, AUDIT_RESULT: "failure" });
    expect(run.status).toBe(1);
    expect(run.calls).toEqual([]);
    expect(run.output).toContain("GitHub Actions only");
  });

  it("when it cannot name the run it would report", () => {
    const run = report({ GITHUB_RUN_ID: "", AUDIT_RESULT: "failure" });
    expect(run.status).toBe(1);
    expect(run.calls).toEqual([]);
    expect(run.output).toContain("GITHUB_RUN_ID is empty");
  });
});

describe("advisory-report.sh goes red when the message is not delivered", () => {
  it.each(["issue list", "issue create"])("when `gh %s` fails", (failing) => {
    const run = report({ AUDIT_RESULT: "failure" }, { list: "", fail: failing });
    expect(run.status).not.toBe(0);
    expect(run.calls.at(-1)?.slice(0, 2).join(" ")).toBe(failing);
  });

  it("when `gh issue comment` fails", () => {
    const run = report(
      { AUDIT_RESULT: "failure" },
      { list: `12\t${ISSUE_TITLE}\n`, fail: "issue comment" },
    );
    expect(run.status).not.toBe(0);
    expect(run.calls.map((call) => call.slice(0, 2).join(" "))).toEqual([
      "issue list",
      "issue comment",
    ]);
  });
});

describe("advisory-report.sh's vocabulary", () => {
  it("lists, comments and opens — never closes, reopens, edits or deletes", () => {
    // The cases above can only show what the script did on THEIR inputs. This
    // reads every `gh` command it can run: a close on some branch none of them
    // reaches would still fail here.
    const code = readFileSync(join(root, SCRIPT_PATH), "utf8")
      .split("\n")
      .filter((line) => !/^\s*#/.test(line))
      .join("\n");
    const commands = new Set(
      [...code.matchAll(/\bgh\s+([a-z-]+)\s+([a-z-]+)/g)].map((m) => `${m[1]} ${m[2]}`),
    );
    expect([...commands].sort()).toEqual(["issue comment", "issue create", "issue list"]);
  });
});
