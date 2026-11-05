variable "customer" {
  description = "Customer slug (lowercase [a-z0-9-]) — names the per-customer project bloom-<customer>-prod."
  type        = string

  validation {
    condition     = can(regex("^[a-z0-9][a-z0-9-]{1,28}[a-z0-9]$", var.customer))
    error_message = "customer must be 3-30 chars of [a-z0-9-], starting and ending alphanumeric."
  }
}

variable "gcp_region" {
  description = "Deployment region for Cloud Run and Cloud SQL."
  type        = string
  default     = "us-central1"
}

variable "services" {
  description = "Bloom services to deploy on Cloud Run, with their container ports."
  type = list(object({
    name = string
    port = number
  }))
  default = [
    { name = "workflow", port = 4101 },
    { name = "approval", port = 4102 },
    { name = "agents", port = 4103 },
    { name = "web", port = 3000 },
  ]
}

variable "database_tier" {
  description = "Cloud SQL tier for the per-customer Postgres instance."
  type        = string
  default     = "db-f1-micro"
}

variable "database_deletion_protection" {
  description = "Keep true for live customer data; the fixture plan and pilot teardown set it false."
  type        = bool
  default     = false
}

variable "secrets" {
  description = "Secret Manager entries the deployment requires."
  type        = list(string)
  default = [
    "db-password",
    "llm-router-key",
    "scan-engine-key",
    "email-smtp-key",
  ]
}

locals {
  project_id  = "bloom-${var.customer}-prod"
  image_base  = "us-docker.pkg.dev/${local.project_id}/bloom"
  audit_sinks = ["workflow", "approval", "agents"]
}
