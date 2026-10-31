state_scope = "application"
resolved_profile = {
  schema_version = 2
  project = {
    id   = "shared-preview-database"
    name = "Shared preview database"
  }
  selections = [
    { slot = "database.relational-host", value = "neon" },
    { slot = "database.preview-isolation", value = "fresh" },
  ]
}
neon = {
  org_id               = "org-example"
  project_name         = "shared-database"
  database_name        = "application"
  role_name            = "application_owner"
  region_id            = "aws-us-east-1"
  pg_version           = 17
  preview_project_name = "shared-database"
}
