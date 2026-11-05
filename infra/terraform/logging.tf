# Cloud Logging — dedicated audit bucket with 90-day retention, plus a sink that
# routes every approval-gated action's audit records there (spec invariant: every
# approval decision is audit-logged with agent, prompt version, and cost).
resource "google_logging_project_bucket_config" "audit" {
  project        = local.project_id
  location       = "global"
  bucket_id      = "bloom-audit-logs"
  retention_days = 90

  depends_on = [google_project_service.apis]
}

resource "google_logging_project_sink" "approval_audit" {
  name = "bloom-approval-audit"

  filter = "jsonPayload.audit=true AND jsonPayload.kind=\"approval_decision\""

  destination = "logging.googleapis.com/${google_logging_project_bucket_config.audit.id}"

  unique_writer_identity = true
}
