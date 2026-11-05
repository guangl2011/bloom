#!/usr/bin/env bash
# Boots the compose-based local equivalent of a per-customer deployment (spec D4).
#
#   infra/compose-local.sh <customer-slug>           # up --wait + smoke test
#   infra/compose-local.sh <customer-slug> --down    # tear down volumes included
#
# Uses COMPOSE_PROJECT_NAME so each customer's local stack is a separate
# compose project — the local mirror of the per-customer cloud project.

set -euo pipefail

customer="${1:-}"
action="${2:-up}"
[[ -n "$customer" ]] || { echo "usage: $0 <customer-slug> [--down]" >&2; exit 2; }

root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
export COMPOSE_PROJECT_NAME="bloom-${customer}-local"
cd "$root"

if [[ "$action" == "--down" ]]; then
  docker compose down -v
  exit 0
fi

docker compose up -d --wait --wait-timeout 240
bash tests/e2e/smoke.sh
echo "per-customer stack '${COMPOSE_PROJECT_NAME}' is up"
