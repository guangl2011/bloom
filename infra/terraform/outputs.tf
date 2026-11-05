output "project_id" {
  description = "Per-customer GCP project id."
  value       = local.project_id
}

output "cloud_run_urls" {
  description = "Public URLs of the deployed Cloud Run services."
  value       = { for name, svc in google_cloud_run_v2_service.svc : name => svc.uri }
}

output "database_instance" {
  description = "Cloud SQL instance connection name (for the Cloud SQL socket)."
  value       = google_sql_database_instance.postgres.connection_name
}

output "audit_bucket" {
  description = "Cloud Logging bucket holding the approval audit trail."
  value       = google_logging_project_bucket_config.audit.id
}
