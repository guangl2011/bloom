#!/usr/bin/env bash
# Spec changelog lint: a PR that modifies docs/spec/ files must include a
# CHANGELOG entry (spec-version discipline, D7 of docs/spec/SPEC.md §9.13).
# Usage: check-spec-changelog.sh [base_ref]
set -euo pipefail

BASE=${1:-HEAD}
SPEC_DIR="docs/spec"
CHANGELOG="docs/spec/CHANGELOG.md"

changed=$(git diff --name-only "$BASE"...HEAD -- "$SPEC_DIR" || git diff --name-only "$BASE" -- "$SPEC_DIR")
if [ -z "$changed" ]; then
  echo "spec-changelog: no changes under $SPEC_DIR — OK"
  exit 0
fi

echo "spec-changelog: changed spec files:"
printf '  %s\n' $changed

# CHANGELOG.md itself was touched, or a new version heading was added.
if printf '%s\n' $changed | grep -qx "$CHANGELOG"; then
  echo "spec-changelog: CHANGELOG updated — OK"
  exit 0
fi

# Tolerate a PR that updates existing spec files in non-semantic ways but
# already contains a new version heading in the changelog since the base.
if ! git diff --quiet "$BASE"...HEAD -- "$CHANGELOG" 2>/dev/null; then
  echo "spec-changelog: CHANGELOG updated on this branch — OK"
  exit 0
fi

echo "spec-changelog: ERROR — files under $SPEC_DIR changed but $CHANGELOG was not updated."
echo "  Add an explicit version entry to $CHANGELOG (never a silent edit)."
exit 1
