mock_provider "cloudflare" {}

run "worker_domain_configuration_must_be_complete" {
  command = plan

  module {
    source = "./modules/cloudflare-worker"
  }

  variables {
    account_id         = "dcd7cd68dd892d610267ded6b1af567b"
    name               = "invalid-worker-domain"
    content            = "export default { fetch() { return new Response('unconfigured', { status: 503 }); } };"
    compatibility_date = "2026-10-24"
    zone_id            = "023e105f4ecef8ad9ca31a8372d0c353"
  }

  expect_failures = [var.hostname]
}
