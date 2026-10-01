output "kubeconfig" {
  description = "Tailnet-only kubeconfig for the candidate cluster"
  value       = module.candidate_cluster.kubeconfig
  sensitive   = true
}

output "control_plane_tailscale_hostnames" {
  description = "MagicDNS recovery targets for all control-plane nodes"
  value       = module.candidate_cluster.tailscale_control_plane_magicdns_hosts
}

output "workspace_inventory" {
  description = "Non-secret placement data mirrored by workspaces/inventory.json"
  value = {
    operator = {
      nodepool     = "workspace-elastic"
      location     = "nbg1"
      volume_claim = "workspace-data"
      local_port   = 3773
    }
    pilot = {
      nodepool     = "workspace-elastic"
      location     = "nbg1"
      volume_claim = "workspace-data"
      local_port   = 3774
    }
  }
}
