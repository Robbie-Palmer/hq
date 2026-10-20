output "managed_hcp_projects" {
  description = "HCP Terraform projects managed by the account-foundation root"
  value = {
    for key, project in local.managed_hcp_projects : key => {
      id   = project.id
      name = project.name
    }
  }
}

output "managed_hcp_workspaces" {
  description = "HCP Terraform workspaces managed from the declared root registry"
  value = {
    for key, workspace in local.managed_hcp_workspaces : key => {
      id   = workspace.id
      name = workspace.name
    }
  }
}
