resource "tailscale_dns_configuration" "tailnet" {
  magic_dns          = true
  override_local_dns = false
  search_paths       = []

  nameservers {
    address            = var.private_addresses["primary_dns"]
    use_with_exit_node = false
  }
}
