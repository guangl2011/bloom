#!/usr/bin/env bash
# Re-export the published charter artifact into docs/exports/CHARTER.artifact.md
# after updating the artifact, so the CI parity path stays current.
# Usage: CHARTER_ARTIFACT_ID=art_8XdcSlUn scripts/export-charter-artifact.sh
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ARTIFACT_ID="${CHARTER_ARTIFACT_ID:-art_8XdcSlUn}"
OUT="$REPO_ROOT/docs/exports/CHARTER.artifact.md"
TMP="$(mktemp)"
trap 'rm -f "$TMP" "$TMP.json"' EXIT

command -v obvious >/dev/null 2>&1 || { echo "obvious CLI not available" >&2; exit 1; }
obvious artifacts get --artifact-id="$ARTIFACT_ID" > "$TMP.json"
python3 - "$TMP.json" "$OUT" <<'PY'
import json, sys
raw = json.load(open(sys.argv[1]))
data = raw.get("data", raw)
content = data["content"]
open(sys.argv[2], "w", encoding="utf-8").write(content)
print(f"exported artifact ({len(content)} chars) -> {sys.argv[2]}")
PY
