#!/usr/bin/env bash
# Filesystem vulnerability scan with Trivy: npm dependencies, embedded secrets
# and the compose/Dockerfile configuration.
#
# `--ignore-unfixed` on purpose — an advisory with no released fix is not
# something a PR can act on, and a permanently red gate is a gate everybody
# learns to ignore.
#
# The vulnerability DB (~100 MB compressed) is updated in its own phase, before
# the scan, so that a download problem is reported as a download problem:
#   * in CI a failed update FAILS the step — scanning against a stale DB there
#     would be a gate that quietly stops seeing new CVEs;
#   * locally (slow or offline connection) a failed update falls back to the
#     cached DB with a loud WARNING naming its age. The scan still runs; the CI
#     job, on a fresh DB, remains the authority.
TRIVY_VERSION="0.71.0"

source "$(dirname -- "${BASH_SOURCE[0]}")/_lib.sh"
cd "$PROJECT_ROOT"

if ! command -v trivy >/dev/null 2>&1; then
  if [[ "${CI:-}" == "true" ]]; then
    arch="64bit"
    case "$(uname -m)" in
    aarch64 | arm64) arch="ARM64" ;;
    esac
    os="Linux"
    [[ "$(uname -s)" == "Darwin" ]] && os="macOS"
    install_pinned_tool trivy "$TRIVY_VERSION" \
      "https://github.com/aquasecurity/trivy/releases/download/v${TRIVY_VERSION}/trivy_${TRIVY_VERSION}_${os}-${arch}.tar.gz" \
      trivy
  else
    require_cmd trivy "brew install trivy  # https://trivy.dev/latest/getting-started/installation/"
  fi
fi

# A fresh DB download is ~100 MB. CI has the bandwidth and the time; a laptop on
# a bad connection should not wait 15 minutes to learn it is offline.
if [[ "${CI:-}" == "true" ]]; then
  db_timeout="15m"
else
  db_timeout="${TRIVY_DB_TIMEOUT:-3m}"
fi

# Once the DB phase has succeeded (or fallen back), the scans never touch the
# network again.
log_step "trivy vulnerability DB update (timeout $db_timeout)"
if trivy fs --download-db-only --timeout "$db_timeout" --quiet; then
  :
elif [[ "${CI:-}" == "true" ]]; then
  log_err "could not download the Trivy vulnerability DB — refusing to scan with a stale one in CI"
  exit 1
else
  cache_dir="${TRIVY_CACHE_DIR:-}"
  [[ -z "$cache_dir" ]] && cache_dir="$(trivy fs --help 2>/dev/null | sed -n 's/.*--cache-dir.*default "\(.*\)").*/\1/p' | head -1)"
  metadata="${cache_dir:-$HOME/.cache/trivy}/db/metadata.json"
  if [[ ! -f "$metadata" ]]; then
    log_err "DB download failed and there is no cached DB at ${metadata%/metadata.json} — cannot scan"
    exit 1
  fi
  updated_at="$(sed -n 's/.*"UpdatedAt":"\([^"]*\)".*/\1/p' "$metadata")"
  log_warn "DB download failed (network?) — scanning with the CACHED DB from ${updated_at:-unknown date}."
  log_warn "Advisories published since then are NOT checked locally. CI always uses a fresh DB."
fi

scan_flags=(
  --skip-db-update
  --timeout 10m
  --severity HIGH,CRITICAL
  --ignore-unfixed
  --skip-dirs node_modules/.cache
  --skip-dirs .next
  --skip-dirs coverage
  --skip-dirs lib/generated
  --scanners vuln,misconfig,secret
  --quiet
)

# ONE list of accepted advisories: `audit-ci.json`, each entry justified in
# `audit-ci-allowlist.md`. Trivy reports many npm advisories under their CVE id
# and only matches an ignore file against that primary id, so the GHSA ids in
# the allowlist are translated through each finding's `VendorIDs` (verified on
# trivy 0.71.0: GHSA-ggr8-5vv4-36mx surfaces as CVE-2026-40345). A second,
# hand-maintained `.trivyignore` would drift from the audit allowlist within a
# month.
report="$(mktemp "${TMPDIR:-/tmp}/velo-trivy.XXXXXX")"
ignorefile="$(mktemp "${TMPDIR:-/tmp}/velo-trivyignore.XXXXXX")"
trap 'rm -f "$report" "$ignorefile"' EXIT

log_step "trivy fs — collecting findings"
trivy fs "${scan_flags[@]}" --format json --output "$report" --exit-code 0 .

node -e '
  const fs = require("node:fs");
  const [reportFile, allowFile] = process.argv.slice(1);
  const allowed = new Set(JSON.parse(fs.readFileSync(allowFile, "utf8")).allowlist ?? []);
  const ids = new Set(allowed);
  const report = JSON.parse(fs.readFileSync(reportFile, "utf8"));
  for (const result of report.Results ?? []) {
    for (const v of result.Vulnerabilities ?? []) {
      const aliases = [v.VulnerabilityID, ...(v.VendorIDs ?? [])];
      if (aliases.some((id) => allowed.has(id))) {
        ids.add(v.VulnerabilityID);
        console.error(`  accepted (audit-ci.json): ${v.PkgName} ${v.VulnerabilityID} = ${aliases.join(" / ")}`);
      }
    }
  }
  process.stdout.write([...ids].join("\n") + "\n");
' "$report" "$PROJECT_ROOT/audit-ci.json" >"$ignorefile"

log_step "trivy fs (HIGH, CRITICAL) — gate"
trivy fs "${scan_flags[@]}" --ignorefile "$ignorefile" --exit-code 1 .

log_ok "trivy clean"
