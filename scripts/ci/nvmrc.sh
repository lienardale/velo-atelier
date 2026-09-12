#!/usr/bin/env bash
# Node version consistency gate.
#
# nextjs-blog once shipped a 0-byte `.nvmrc`: `nvm use` silently kept whatever
# Node the shell already had, and `actions/setup-node` with `node-version-file`
# failed with an opaque error. This step makes that class of bug loud:
#
#   1. `.nvmrc` exists and is not empty
#   2. `.nvmrc` and `package.json` `engines.node` agree on the MAJOR version
#   3. the Node actually running this script is that same major
#
# It is the cheapest job in the pipeline and the first one to look at when the
# runner behaves differently from a laptop.
source "$(dirname -- "${BASH_SOURCE[0]}")/_lib.sh"
cd "$PROJECT_ROOT"

log_step "node version consistency"

if [[ ! -s .nvmrc ]]; then
  log_err ".nvmrc is missing or empty — actions/setup-node@node-version-file needs it"
  exit 1
fi

nvmrc_raw="$(tr -d ' \t\r\n' <.nvmrc)"
nvmrc_major="${nvmrc_raw#v}"
nvmrc_major="${nvmrc_major%%.*}"

if [[ ! "$nvmrc_major" =~ ^[0-9]+$ ]]; then
  log_err ".nvmrc must name a Node version (got: '$nvmrc_raw')"
  exit 1
fi

engines_major="$(node -p "
  const e = require('./package.json').engines?.node;
  if (!e) { console.error('package.json has no engines.node'); process.exit(1); }
  const m = String(e).match(/([0-9]+)/);
  if (!m) { console.error('engines.node is not a version range: ' + e); process.exit(1); }
  m[1];
")"

running_major="$(node -p "process.versions.node.split('.')[0]")"

printf "  .nvmrc          %s\n" "$nvmrc_raw"
printf "  engines.node    %s\n" "$(node -p "require('./package.json').engines.node")"
printf "  running node    %s\n" "$(node -v)"

if [[ "$nvmrc_major" != "$engines_major" ]]; then
  log_err ".nvmrc major ($nvmrc_major) != engines.node major ($engines_major)"
  exit 1
fi

if [[ "$running_major" != "$nvmrc_major" ]]; then
  log_err "running Node major ($running_major) != .nvmrc ($nvmrc_major) — run 'nvm use'"
  exit 1
fi

log_ok "node ${nvmrc_major}.x everywhere"
