mock_provider "hcloud" {}

variables {
  ssh_public_key = "ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIKxWk5kYSL6V6jYwB6XRmOLb3NmDdxwjcA6B3QyVAQ6M test"
}

run "active_server_is_protected" {
  command = plan

  variables {
    server_state = "active"
  }

  assert {
    condition     = length(hcloud_server.remote_development) == 1
    error_message = "Active state must declare one server."
  }

  assert {
    condition     = hcloud_server.remote_development[0].delete_protection
    error_message = "Active state must protect the server from deletion."
  }

  assert {
    condition     = length(hcloud_volume_attachment.workspace) == 1
    error_message = "Active state must attach the workspace volume."
  }

  assert {
    condition     = output.nixos_host_handoff.schema_version == 1
    error_message = "The Terraform-to-NixOS handoff must use schema version 1."
  }

  assert {
    condition = sort(keys(output.nixos_host_handoff)) == sort([
      "bootstrap_method",
      "host_key_proof",
      "host_name",
      "host_profile",
      "persistent_mounts",
      "root_disk",
      "schema_version",
      "target",
    ])
    error_message = "The handoff must expose only the reviewed non-secret fields."
  }

  assert {
    condition     = output.nixos_host_handoff.host_profile == "vm" && output.nixos_host_handoff.bootstrap_method == "nixos-anywhere"
    error_message = "The handoff must select the VM profile and nixos-anywhere installer."
  }

  assert {
    condition     = output.nixos_host_handoff.host_key_proof == "provider-console"
    error_message = "The handoff must require host-key proof through the provider console."
  }

  assert {
    condition     = output.nixos_host_handoff.persistent_mounts[0].preserve_on_replace
    error_message = "The handoff must preserve the workspace mount during host replacement."
  }
}

run "suspend_ready_server_is_unprotected" {
  command = plan

  variables {
    server_state = "suspend-ready"
  }

  assert {
    condition     = length(hcloud_server.remote_development) == 1
    error_message = "Suspend-ready state must keep the server for the protection-removal apply."
  }

  assert {
    condition     = !hcloud_server.remote_development[0].delete_protection
    error_message = "Suspend-ready state must remove server deletion protection."
  }

  assert {
    condition     = hcloud_volume.workspace.delete_protection
    error_message = "Suspend-ready state must keep volume deletion protection."
  }
}

run "suspended_state_keeps_only_the_volume" {
  command = plan

  variables {
    server_state = "suspended"
  }

  assert {
    condition     = length(hcloud_server.remote_development) == 0
    error_message = "Suspended state must remove the server."
  }

  assert {
    condition     = length(hcloud_volume_attachment.workspace) == 0
    error_message = "Suspended state must remove the volume attachment."
  }

  assert {
    condition     = hcloud_volume.workspace.delete_protection
    error_message = "Suspended state must keep volume deletion protection."
  }

  assert {
    condition     = output.nixos_host_handoff == null
    error_message = "A suspended host must not publish an installation target."
  }
}
