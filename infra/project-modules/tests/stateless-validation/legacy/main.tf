variable "cleanup_complete" {
  type    = bool
  default = false
}

module "project" {
  source = "./project"

  cleanup_complete = var.cleanup_complete
}
