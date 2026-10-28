mock_provider "cloudflare" {}
mock_provider "neon" {}

run "cloudflare_and_neon_do_not_configure_unselected_providers" {
  command = apply

  assert {
    condition = (
      output.selected_capabilities == toset([
        "database.relational-host",
        "web-app.host",
      ]) &&
      output.resource_ownership.pages_project != null &&
      output.resource_ownership.neon.production_project != null
    )
    error_message = "A Cloudflare-and-Neon profile must plan without configuring unrelated providers."
  }
}
