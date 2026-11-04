output "server_id" {
  description = "Hetzner Cloud server ID, or null while suspended"
  value       = try(hcloud_server.remote_development[0].id, null)
}

output "server_ipv4_address" {
  description = "Public IPv4 address used for controlled bootstrap and outbound connectivity, or null while suspended"
  value       = try(hcloud_server.remote_development[0].ipv4_address, null)
}

output "server_ipv6_address" {
  description = "First public IPv6 address assigned to the server, or null while suspended"
  value       = try(hcloud_server.remote_development[0].ipv6_address, null)
}

output "nixos_anywhere_target" {
  description = "Temporary SSH target for nixos-anywhere while bootstrap ingress is enabled, or null while suspended"
  value       = local.server_enabled ? "root@${hcloud_server.remote_development[0].ipv4_address}" : null
}

output "data_volume_id" {
  description = "Persistent workspace volume ID"
  value       = hcloud_volume.workspace.id
}

output "data_volume_linux_device" {
  description = "Stable device path that the NixOS host mounts as workspace storage"
  value       = hcloud_volume.workspace.linux_device
}
