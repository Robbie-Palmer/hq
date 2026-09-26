output "kubeconfig" {
  description = "Tailnet-only kubeconfig for the candidate cluster"
  value       = module.candidate_cluster.kubeconfig
  sensitive   = true
}

output "control_plane_tailscale_hostnames" {
  description = "MagicDNS recovery targets for all control-plane nodes"
  value       = module.candidate_cluster.tailscale_control_plane_magicdns_hosts
}

output "agent_tailscale_hostnames" {
  description = "MagicDNS names for the two statically assigned workspace agents"
  value       = module.candidate_cluster.tailscale_agent_magicdns_hosts
}

output "workspace_inventory" {
  description = "Non-secret placement data mirrored by workspaces/inventory.json"
  value = {
    operator = {
      nodepool     = "workspace-operator"
      location     = "nbg1"
      volume_claim = "workspace-data"
      endpoint     = "operator.tailnet"
    }
    pilot = {
      nodepool     = "workspace-pilot"
      location     = "fsn1"
      volume_claim = "workspace-data"
      endpoint     = "pilot.tailnet"
    }
  }
}
