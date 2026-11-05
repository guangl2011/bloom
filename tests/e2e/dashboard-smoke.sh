#!/usr/bin/env bash
# Dashboard smoke test: every ops view must load from the running compose stack
# and render its view marker. Runs after tests/e2e/smoke.sh in CI and locally.
set -euo pipefail

BASE_URL=${BASE_URL:-http://127.0.0.1:3000}

# route -> data-view marker the page must render
declare -A VIEWS=(
  ["/"]="overview"
  ["/runs"]="runs"
  ["/approvals"]="approvals"
  ["/credits"]="credits"
  ["/leads"]="leads"
)

failed=0
for route in "/" "/runs" "/approvals" "/credits" "/leads"; do
  view=${VIEWS[$route]}
  url="${BASE_URL}${route}"
  if html=$(curl -fsS --retry 10 --retry-delay 2 --retry-connrefused "$url"); then
    if [[ "${html}" == *"data-view=\"${view}\""* ]]; then
      echo "ok ${route} (${url}): view '${view}' rendered"
    else
      echo "FAIL ${route}: view marker '${view}' missing from response" >&2
      failed=1
    fi
  else
    echo "FAIL ${route}: no response from ${url}" >&2
    failed=1
  fi
done

if [[ "${failed}" -ne 0 ]]; then
  echo "dashboard smoke test FAILED" >&2
  exit 1
fi
echo "dashboard smoke test passed: all views render"
