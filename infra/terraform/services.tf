# Cloud Run services — one per Bloom service, single-tenant per customer project.
# Containers come from the project's Artifact Registry (built by infra/deploy.sh).
resource "google_cloud_run_v2_service" "svc" {
  for_each = { for s in var.services : s.name => s }

  name                = "bloom-${each.key}"
  location            = var.gcp_region
  deletion_protection = false # per-customer project is torn down as a unit

  template {
    containers {
      image = "${local.image_base}/bloom-${each.key}:latest"

      ports {
        container_port = each.value.port
      }

      env {
        name  = "NODE_ENV"
        value = "production"
      }

      env {
        name  = "DATABASE_URL"
        value = "postgres://bloom@/bloom?host=/cloudsql/${google_sql_database_instance.postgres.connection_name}"
      }

      # Secrets are mounted by name from Secret Manager; values are injected at
      # deploy time, never baked into images or config.
      dynamic "env" {
        for_each = { for s in var.secrets : s => s if s != "db-password" }
        iterator = secret
        content {
          name = upper(secret.key)
          value_source {
            secret_key_ref {
              secret  = google_secret_manager_secret.secrets[secret.key].secret_id
              version = "latest"
            }
          }
        }
      }
    }

    scaling {
      max_instance_count = 2
    }
  }

  depends_on = [google_project_service.apis]
}
