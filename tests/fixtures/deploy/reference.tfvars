# Fixture plan variables for the synthetic reference customer (spec D5 fixture).
# Used by CI (deploy-infra.yml) and locally:
#   GOOGLE_CREDENTIALS="$(cat /tmp/fixture-creds.json)" \
#     terraform -chdir=infra/terraform plan -refresh=false \
#     -var-file=../../tests/fixtures/deploy/reference.tfvars
customer                 = "reference"
gcp_region               = "us-central1"
database_deletion_protection = false
