# Per-customer Postgres instance. pgvector is enabled at the database level with
# CREATE EXTENSION vector (Cloud SQL for PostgreSQL ships the extension).
resource "google_sql_database_instance" "postgres" {
  name                = "bloom-${var.customer}"
  database_version    = "POSTGRES_15"
  region              = var.gcp_region
  deletion_protection = var.database_deletion_protection

  settings {
    tier = var.database_tier

    ip_configuration {
      # v1.0 pilots connect through the Cloud SQL socket from co-located Cloud Run
      # services; public IP stays on only for the CSM psql escape hatch until v2.0.
      ipv4_enabled = true
    }
  }

  depends_on = [google_project_service.apis]
}

resource "google_sql_database" "bloom" {
  name     = "bloom"
  instance = google_sql_database_instance.postgres.name
}

resource "random_password" "db_password" {
  length  = 24
  special = false
}

resource "google_sql_user" "bloom" {
  name     = "bloom"
  instance = google_sql_database_instance.postgres.name
  password = random_password.db_password.result
}
