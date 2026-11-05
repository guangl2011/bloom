#!/usr/bin/env bash
# Generates throwaway service-account JSON for OFFLINE terraform plan validation.
#
# The google provider needs well-formed credentials at plan time even though the
# offline plan (no refresh, no data sources) never calls a GCP API. This script
# generates a real-format RSA key that is valid syntactically and worthless
# cryptographically — it is generated at runtime, never committed, and never
# used against GCP. Used by CI (deploy-infra.yml) and by local fixture plans.
#
# Usage: tests/fixtures/deploy/gen-fixture-credentials.sh /tmp/fixture-creds.json

set -euo pipefail

out="${1:?usage: gen-fixture-credentials.sh <output-path>}"

python3 - "$out" <<'PY'
import json, subprocess, sys

pem = subprocess.run(
    ["openssl", "genrsa", "2048"], capture_output=True, text=True, check=True
).stdout

creds = {
    "type": "service_account",
    "project_id": "bloom-fixture-prod",
    "private_key_id": "fixture-not-a-real-key",
    "private_key": pem,
    "client_email": "terraform-fixture@bloom-fixture-prod.iam.gserviceaccount.com",
    "client_id": "000000000000000000000",
}

with open(sys.argv[1], "w") as f:
    f.write(json.dumps(creds))
PY

echo "fixture credentials written to $out (runtime-generated, never commit this file)"
