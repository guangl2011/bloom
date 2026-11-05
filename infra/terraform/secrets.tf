# Secret Manager — per-customer keys for external adapters (LLM router, scan
# engine, email) plus the generated database password.
resource "google_secret_manager_secret" "secrets" {
  for_each = toset(var.secrets)

  secret_id = each.value

  replication {
    auto {}
  }

  depends_on = [google_project_service.apis]
}

resource "google_secret_manager_secret_version" "db_password" {
  secret      = google_secret_manager_secret.secrets["db-password"].id
  secret_data = random_password.db_password.result
}
