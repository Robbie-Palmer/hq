locals {
  common_hcloud_labels = {
    environment = "candidate"
    managed-by  = "terraform"
    project     = "remote-development"
  }
}

module "candidate_cluster" {
  source  = "kube-hetzner/kube-hetzner/hcloud"
  version = "3.1.0"

  providers = {
    hcloud = hcloud
  }

  hcloud_token    = var.hcloud_token
  ssh_public_key  = trimspace(var.ssh_public_key)
  ssh_private_key = var.ssh_private_key

  cluster_name              = "remote-development-candidate"
  kubernetes_distribution   = "k3s"
  k3s_version               = "v1.36.3+k3s1"
  enabled_architectures     = ["x86"]
  leapmicro_x86_snapshot_id = var.leapmicro_x86_snapshot_id

  automatically_upgrade_kubernetes = false
  automatically_upgrade_os         = false
  enable_secrets_encryption        = true

  network_region      = "eu-central"
  network_ipv4_cidr   = "10.80.0.0/16"
  network_subnet_mode = "per_nodepool"

  node_transport_mode = "tailscale"
  tailscale_node_transport = {
    bootstrap_mode  = "cloud_init"
    version         = "1.96.4"
    magicdns_domain = var.tailscale_magicdns_domain
    auth = {
      mode                         = "oauth_client_secret"
      advertise_tags_control_plane = ["tag:remote-dev-control-plane"]
      advertise_tags_agent         = ["tag:remote-dev-agent"]
      advertise_tags_autoscaler    = ["tag:remote-dev-agent"]
      oauth_static_nodes_ephemeral = false
      oauth_autoscaler_ephemeral   = true
      oauth_preauthorized          = true
    }
    routing = {
      advertise_node_private_routes = false
    }
    kubernetes = {
      kubeconfig_endpoint = "first_control_plane_tailnet"
    }
  }
  tailscale_oauth_client_secret = var.tailscale_oauth_client_secret

  firewall_kube_api_source = null
  firewall_ssh_source      = null
  ingress_controller       = "none"

  enable_control_plane_load_balancer = false

  control_plane_nodepools = [
    {
      name                 = "control-plane-nbg1"
      server_type          = "cx23"
      location             = "nbg1"
      labels               = ["remote-development.robbiepalmer.dev/role=control-plane"]
      taints               = []
      count                = 1
      append_random_suffix = false
      os                   = "leapmicro"
      hcloud_labels        = merge(local.common_hcloud_labels, { role = "control-plane" })
    }
  ]

  agent_nodepools = []

  autoscaler_nodepools = [
    {
      name        = "workspace-elastic"
      server_type = "cx33"
      location    = "nbg1"
      min_nodes   = 0
      max_nodes   = 2
      labels = {
        "remote-development.robbiepalmer.dev/role" = "workspace"
      }
      taints = [
        {
          key    = "remote-development.robbiepalmer.dev/role"
          value  = "workspace"
          effect = "NoSchedule"
        }
      ]
      server_labels = merge(local.common_hcloud_labels, { role = "workspace" })
      os            = "leapmicro"
      network_scope = "primary"
    },
  ]

  cluster_autoscaler_extra_args = ["--scale-down-unneeded-time=5m"]

  enable_delete_protection = {
    floating_ip   = true
    load_balancer = true
    volume        = true
  }

  etcd_s3_backup = {
    etcd-s3-endpoint            = var.etcd_s3_endpoint
    etcd-s3-access-key          = var.etcd_s3_access_key
    etcd-s3-secret-key          = var.etcd_s3_secret_key # gitleaks:allow -- variable reference, not a credential
    etcd-s3-bucket              = var.etcd_s3_bucket
    etcd-s3-region              = var.etcd_s3_region
    etcd-s3-folder              = "remote-development-candidate"
    etcd-snapshot-schedule-cron = "17 */6 * * *"
    etcd-snapshot-retention     = 14
    etcd-snapshot-compress      = true
  }
}
