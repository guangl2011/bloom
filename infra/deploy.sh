#!/usr/bin/env bash
# Drives the per-customer GCP deployment (spec deliverable D4).
#
#   infra/deploy.sh <customer-slug> plan     — offline plan (safe without credentials
#                                              only if no refresh is needed; use fixture)
#   infra/deploy.sh <customer-slug> apply    — real apply. REQUIRES:
#                                                GOOGLE_CREDENTIALS set (secrets flow)
#                                                BLOOM_DEPLOY_APPROVED=true
#
# Nothing here runs a real apply until both gates pass — the first deploy is
# credential-gated (open question 1 of the spec).

set -euo pipefail

usage() { echo "usage: $0 <customer-slug> <plan|apply>" >&2; exit 2; }

customer="${1:-}"
action="${2:-}"
[[ -n "$customer" && -n "$action" ]] || usage

root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
tf="$root/infra/terraform"

case "$action" in
  plan)
    echo "== plan: bloom-${customer}-prod (offline; no resources are created) =="
    terraform -chdir="$tf" init -backend=false -input=false
    terraform -chdir="$tf" plan -input=false -refresh=false \
      -var="customer=${customer}" \
      -out="/tmp/bloom-${customer}-plan.tfplan"
    echo "plan written to /tmp/bloom-${customer}-plan.tfplan"
    ;;
  apply)
    if [[ -z "${GOOGLE_CREDENTIALS:-}" ]]; then
      echo "refusing: GOOGLE_CREDENTIALS is not set — provide GCP credentials via the secrets flow" >&2
      exit 1
    fi
    if [[ "${BLOOM_DEPLOY_APPROVED:-}" != "true" ]]; then
      echo "refusing: BLOOM_DEPLOY_APPROVED=true required — deploys are human-approved" >&2
      exit 1
    fi
    echo "== apply: bloom-${customer}-prod =="
    terraform -chdir="$tf" init -input=false
    terraform -chdir="$tf" apply -input=false \
      -var="customer=${customer}" \
      -var="database_deletion_protection=true" \
      "/tmp/bloom-${customer}-plan.tfplan"
    ;;
  *)
    usage
    ;;
esac
