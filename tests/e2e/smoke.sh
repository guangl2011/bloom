#!/usr/bin/env bash
# Compose smoke test: every Bloom service must answer /health with its identity.
# Runs in CI (compose-smoke job) and locally after `docker compose up -d --wait`.
set -euo pipefail

declare -A SERVICES=(
  [3000]=web
  [4101]=workflow
  [4102]=approval
  [4103]=agents
)

failed=0
for port in 3000 4101 4102 4103; do
  name=${SERVICES[$port]}
  url="http://127.0.0.1:${port}/health"
  if response=$(curl -fsS --retry 10 --retry-delay 2 --retry-connrefused "$url"); then
    echo "ok ${name} (${url}): ${response}"
    if [[ "${response}" != *"\"service\":\"${name}\""* ]]; then
      echo "FAIL ${name}: unexpected health payload" >&2
      failed=1
    fi
  else
    echo "FAIL ${name}: no response from ${url}" >&2
    failed=1
  fi
done

if [[ "${failed}" -ne 0 ]]; then
  echo "smoke test FAILED" >&2
  exit 1
fi
echo "smoke test passed: all services healthy"
