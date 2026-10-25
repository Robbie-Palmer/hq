locals {
  operator_group   = "group:operator"
  restricted_group = "group:restricted"

  development_tags = [
    "tag:remote-development",
    "tag:vector-development",
  ]

  tailnet_policy = {
    groups = {
      (local.operator_group)   = [var.user_logins["operator"]]
      (local.restricted_group) = [var.user_logins["restricted"]]
    }

    hosts = {
      "lab-dns"  = var.private_addresses["primary_dns"]
      "lab-host" = var.private_addresses["lab_host"]
    }

    tagOwners = {
      for tag in local.development_tags : tag => [local.operator_group]
    }

    grants = [
      {
        src = ["*"]
        dst = ["*"]
        ip  = ["*"]
      },
      {
        src = [local.operator_group]
        dst = local.development_tags
        ip = [
          "tcp:22",
          "tcp:443",
          "tcp:6443",
        ]
      },
    ]

    ssh = [
      {
        action = "check"
        src    = ["autogroup:member"]
        dst    = ["autogroup:self"]
        users  = ["root"]
      },
      {
        action = "accept"
        src    = [local.operator_group]
        dst    = ["autogroup:self"]
        users = [
          "pi",
          "robbie",
        ]
      },
      {
        action = "check"
        src    = [local.operator_group]
        dst    = local.development_tags
        users  = ["root"]
      },
    ]

    autoApprovers = {
      routes   = {}
      exitNode = []
    }

    tests = [
      {
        src = local.operator_group
        accept = [
          "tag:remote-development:22",
          "tag:remote-development:443",
          "tag:remote-development:6443",
          "tag:vector-development:22",
          "lab-dns:53",
          "lab-host:3001",
        ]
        deny = ["192.0.2.1:443"]
      },
      {
        src = local.restricted_group
        accept = [
          "lab-dns:53",
          "lab-host:3001",
        ]
        deny = ["192.0.2.1:443"]
      },
    ]

    sshTests = [
      {
        src    = local.operator_group
        dst    = ["autogroup:self"]
        accept = ["pi", "robbie"]
        check  = ["root"]
        deny   = ["ubuntu"]
      },
      {
        src   = local.operator_group
        dst   = local.development_tags
        check = ["root"]
        deny  = ["pi", "robbie"]
      },
      {
        src  = local.restricted_group
        dst  = local.development_tags
        deny = ["pi", "robbie", "root"]
      },
    ]
  }
}

resource "tailscale_acl" "tailnet" {
  acl = jsonencode(local.tailnet_policy)
}
