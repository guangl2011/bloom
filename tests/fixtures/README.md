# tests/fixtures/

Shared test fixtures. The synthetic reference customer (intake workbook → `intake.json` →
workflow config, spec deliverable D5) lands here as the fixture the recurring functional
tests run against.

## deploy/

Fixtures for the deployment layer (spec deliverable D4):

- `reference.tfvars` — plan variables for the synthetic reference customer
  (`bloom-reference-prod`); CI plans `infra/terraform` against it offline.
- `gen-fixture-credentials.sh` — generates throwaway, runtime-only service-account
  JSON so `terraform plan` runs without real GCP credentials. Never commit its output.
