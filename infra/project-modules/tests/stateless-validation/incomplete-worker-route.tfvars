state_scope = "application"
resolved_profile = {
  schema_version = 2
  project = {
    id   = "incomplete-worker-route"
    name = "Incomplete worker route"
  }
  selections = [
    { slot = "backend-api.runtime", value = "cloudflare-workers" },
  ]
}
cloudflare_worker = {
  account_id         = "dcd7cd68dd892d610267ded6b1af567b"
  name               = "incomplete-worker-route"
  content            = "export default { fetch() { return new Response('ok'); } };"
  compatibility_date = "2026-10-24"
  hostname           = "worker.example.com"
}
