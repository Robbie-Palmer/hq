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

run "worker_accepts_a_preprovisioned_hyperdrive_binding" {
  command = plan

  module {
    source = "./modules/cloudflare-worker"
  }

  variables {
    account_id         = "dcd7cd68dd892d610267ded6b1af567b"
    name               = "hyperdrive-worker"
    content            = "export default { fetch() { return new Response('unconfigured', { status: 503 }); } };"
    compatibility_date = "2026-10-24"
    hyperdrive_id      = "7c2d44d36f5c4f55b2f8a3f29f62a2f1"
  }

  assert {
    condition = (
      length(cloudflare_workers_script.worker.hyperdrive_config_binding) == 1 &&
      one(cloudflare_workers_script.worker.hyperdrive_config_binding).binding == "HYPERDRIVE" &&
      one(cloudflare_workers_script.worker.hyperdrive_config_binding).id == "7c2d44d36f5c4f55b2f8a3f29f62a2f1"
    )
    error_message = "The Worker must bind the supplied Hyperdrive configuration as HYPERDRIVE."
  }
}

run "worker_omits_an_unconfigured_hyperdrive_binding" {
  command = plan

  module {
    source = "./modules/cloudflare-worker"
  }

  variables {
    account_id         = "dcd7cd68dd892d610267ded6b1af567b"
    name               = "direct-database-worker"
    content            = "export default { fetch() { return new Response('unconfigured', { status: 503 }); } };"
    compatibility_date = "2026-10-24"
  }

  assert {
    condition     = length(cloudflare_workers_script.worker.hyperdrive_config_binding) == 0
    error_message = "The Worker must not create a Hyperdrive binding without an ID."
  }
}
