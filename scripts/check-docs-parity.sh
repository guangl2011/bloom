#!/usr/bin/env bash
# Docs-parity check for docs/CHARTER.md (D1).
#
# Two modes:
#   1. Live (default when the `obvious` CLI is available): fetches the published
#      charter artifact and diffs its content against docs/CHARTER.md.
#   2. CI (fallback): diffs docs/CHARTER.md against the committed export of the
#      artifact content, docs/exports/CHARTER.artifact.md. GitHub Actions has no
#      Obvious credentials, so CI always takes this path; the export is refreshed
#      whenever the artifact is updated (refresh: `scripts/export-charter-artifact.sh`).
#
# Also asserts the charter's required sections exist (content checks).
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
CHARTER="$REPO_ROOT/docs/CHARTER.md"
EXPORT="$REPO_ROOT/docs/exports/CHARTER.artifact.md"
ARTIFACT_ID="${CHARTER_ARTIFACT_ID:-art_8XdcSlUn}"

fail() { echo "FAIL: $*" >&2; exit 1; }

[ -f "$CHARTER" ] || fail "docs/CHARTER.md not found"

# --- Parity -----------------------------------------------------------------
if command -v obvious >/dev/null 2>&1 && [ "${CHARTER_PARITY_SKIP_LIVE:-0}" != "1" ]; then
  TMP="$(mktemp)"
  trap 'rm -f "$TMP" "$TMP.json" "$TMP.err"' EXIT
  obvious artifacts get --artifact-id="$ARTIFACT_ID" > "$TMP.json" 2>"$TMP.err" \
    || fail "could not fetch live artifact $ARTIFACT_ID: $(cat "$TMP.err")"
  if python3 - "$TMP.json" "$CHARTER" <<'PY'
import json, sys
raw = json.load(open(sys.argv[1]))
data = raw.get("data", raw)
content = data["content"] if isinstance(data, dict) and "content" in data else None
if content is None:
    sys.exit("artifact JSON has no content field")
disk = open(sys.argv[2], encoding="utf-8").read()
sys.exit(0 if content == disk else 1)
PY
  then
    echo "PARITY OK: docs/CHARTER.md == live artifact $ARTIFACT_ID"
  else
    fail "docs/CHARTER.md does not match live artifact $ARTIFACT_ID — update the artifact (artifacts update --stdin) or re-export"
  fi
else
  [ -f "$EXPORT" ] || fail "committed artifact export $EXPORT not found"
  diff -u "$EXPORT" "$CHARTER" || fail "docs/CHARTER.md differs from the exported artifact content ($EXPORT)"
  echo "PARITY OK: docs/CHARTER.md == committed artifact export"
fi

# --- Content checks ----------------------------------------------------------
grep -q '^## 4. Service Packages → Agent Modules' "$CHARTER" \
  || fail "missing required section: Service Packages → Agent Modules (mapping table)"
grep -q 'Intelligence Starter' "$CHARTER" || fail "mapping table missing Intelligence Starter"
grep -q 'Lead Generation Pro' "$CHARTER" || fail "mapping table missing Lead Generation Pro"
grep -q 'Revenue Intelligence + ICP' "$CHARTER" \
  || fail "mapping table must state which agents Intelligence Starter activates"
grep -q '^## 5. v1.0 / v2.0 Scope Boundary' "$CHARTER" \
  || fail "missing required section: v1.0 / v2.0 Scope Boundary"
grep -q 'Mastra upgrade behind AgentInterface' "$CHARTER" \
  || fail "v1.0/v2.0 boundary must state the Mastra-behind-AgentInterface upgrade plan"
grep -q 'supersedes the commercial sequencing' "$CHARTER" \
  || fail "charter must state it supersedes PRD v1.0 / Roadmap v2.2 sequencing"
if grep -qE '\$299|\$599|\$999' "$CHARTER"; then
  fail "charter must not present product-tier pricing as customer-facing"
fi

echo "CONTENT OK: mapping table, v1.0/v2.0 boundary, supersession, and no customer-facing pricing"
echo "ALL CHECKS PASSED"
