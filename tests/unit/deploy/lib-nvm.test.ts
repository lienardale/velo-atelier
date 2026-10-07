/**
 * `scripts/ci/_lib.sh` and nvm — when the library reaches for it, and when it
 * must not.
 *
 * Every step script sources `_lib.sh` first, and `_lib.sh` used to source
 * `~/.nvm/nvm.sh` whenever the file existed. Under `npm run <script>` that broke the
 * step on any machine whose `~/.nvm` is a symlink: npm exports
 * `npm_config_prefix`, nvm refuses to work beside a prefix that is not
 * literally under `$NVM_DIR`, and in refusing it takes node and npx off the
 * PATH — `npx: command not found`, exit 127. Measured 2026-10-06 on
 * `npm run ci:local` and `npm run lhci` (`.debug/017`); `bash scripts/ci.sh`
 * was unaffected, which is why CI and the git hooks never showed it.
 *
 * The rule now: nvm is sourced only when the Node on PATH is missing or the
 * wrong major. Both directions are executed here, in a child bash whose HOME
 * holds a stand-in `nvm.sh`. The stand-in does what the real one did in the
 * failing case — it empties the PATH of everything but the system directories
 * — and leaves a marker, so "was it sourced" and "is node still reachable"
 * are observations, not readings of the script.
 */

import { execFileSync } from "node:child_process";
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

const root = process.cwd();
const SYSTEM_PATH = "/usr/bin:/bin";
/** The directory of the Node this test runs on: the right major by construction (`.nvmrc`). */
const NODE_DIR = dirname(process.execPath);

/* eslint-disable security/detect-non-literal-fs-filename -- every path below is built from mkdtemp */

let home: string;
let marker: string;
/**
 * A PATH that holds the one external `_lib.sh` calls while loading (`dirname`)
 * and provably no `node`: `/usr/bin` itself cannot be used for "there is no
 * Node", because some machines keep one there.
 */
let tools: string;

beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), "velo-lib-nvm-"));
  marker = join(home, "nvm-was-sourced");
  mkdirSync(join(home, ".nvm"));
  tools = join(home, "tools");
  mkdirSync(tools);
  const realDirname = execFileSync("/bin/sh", ["-c", "command -v dirname"], {
    encoding: "utf8",
    // `as unknown as`: Next augments `NodeJS.ProcessEnv` so `NODE_ENV` is required.
    env: { PATH: SYSTEM_PATH } as unknown as NodeJS.ProcessEnv,
  }).trim();
  symlinkSync(realDirname, join(tools, "dirname"));
  // What the real nvm did beside `npm_config_prefix`: node leaves the PATH.
  // The arguments it was sourced with are recorded for the `--no-use` case.
  writeFileSync(
    join(home, ".nvm", "nvm.sh"),
    [
      `printf '%s\\n' "$*" > "${marker}"`,
      `PATH="${SYSTEM_PATH}"`,
      "export PATH",
      "nvm() { return 0; }",
      "",
    ].join("\n"),
  );
});

afterEach(() => {
  rmSync(home, { recursive: true, force: true });
});

/** Source `_lib.sh` as a step script would, then report whether node is reachable. */
function sourceLib(path: string, args: readonly string[] = []): string {
  return execFileSync(
    "/bin/bash",
    [
      "-c",
      `source "${join(root, "scripts/ci/_lib.sh")}"; command -v node >/dev/null 2>&1 && echo NODE_ON_PATH || echo NODE_MISSING`,
      "step-script",
      ...args,
    ],
    {
      cwd: root,
      encoding: "utf8",
      timeout: 60_000,
      // Built from nothing: the test must not inherit a real nvm or npm state.
      env: {
        HOME: home,
        PATH: path,
        npm_config_prefix: "/somewhere/that/is/not/under/nvm",
      } as unknown as NodeJS.ProcessEnv,
    },
  ).trim();
}

describe("scripts/ci/_lib.sh and nvm", () => {
  it("leaves nvm alone when the right Node is already on PATH (an `npm run` started on it)", () => {
    expect(sourceLib(`${NODE_DIR}:${tools}`)).toBe("NODE_ON_PATH");
    expect(existsSync(marker)).toBe(false);
  });

  it("still reaches for nvm when there is no Node at all (a non-login shell)", () => {
    sourceLib(tools);
    expect(existsSync(marker)).toBe(true);
  });

  it("still reaches for nvm when the Node on PATH is another major", () => {
    const bin = join(home, "bin");
    mkdirSync(bin);
    const fakeNode = join(bin, "node");
    writeFileSync(fakeNode, "#!/bin/sh\necho 22\n");
    chmodSync(fakeNode, 0o755);

    sourceLib(`${bin}:${tools}`);
    expect(existsSync(marker)).toBe(true);
  });

  it("sources nvm with an argument of its own, never the step script's", () => {
    execFileSync(
      "/bin/bash",
      [
        "-c",
        `source "${join(root, "scripts/ci/_lib.sh")}"; test -f "${marker}"`,
        "step-script",
        "--install",
      ],
      {
        cwd: root,
        encoding: "utf8",
        timeout: 60_000,
        env: { HOME: home, PATH: tools } as unknown as NodeJS.ProcessEnv,
      },
    );
    const sourcedWith = readFileSync(marker, "utf8").trim();
    expect(sourcedWith).toBe("--no-use");
  });
});
