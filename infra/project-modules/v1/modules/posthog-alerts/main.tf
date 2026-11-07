terraform {
  required_providers {
    restapi = {
      source = "Mastercard/restapi"
    }
  }
}

variable "project_id" {
  type = string
}

variable "alerts" {
  type = map(object({
    name                = string
    service_names       = set(string)
    threshold_count     = number
    threshold_operator  = optional(string, "above")
    window_minutes      = optional(number, 5)
    evaluation_periods  = optional(number, 1)
    datapoints_to_alarm = optional(number, 1)
    cooldown_minutes    = optional(number, 30)
  }))
}

locals {
  collection_path = "/api/projects/${var.project_id}/logs/alerts/"
  item_path       = "${local.collection_path}{id}/"
  production_filter_group = {
    type = "AND"
    values = [{
      type = "AND"
      values = [{
        key      = "deployment.environment.name"
        type     = "log_resource_attribute"
        operator = "exact"
        value    = "production"
      }]
    }]
  }
  payloads = {
    for key, alert in var.alerts : key => {
      name    = alert.name
      enabled = true
      filters = {
        severityLevels = ["error", "fatal"]
        serviceNames   = alert.service_names
        filterGroup    = local.production_filter_group
      }
      threshold_count     = alert.threshold_count
      threshold_operator  = alert.threshold_operator
      window_minutes      = alert.window_minutes
      evaluation_periods  = alert.evaluation_periods
      datapoints_to_alarm = alert.datapoints_to_alarm
      cooldown_minutes    = alert.cooldown_minutes
    }
  }
}

resource "restapi_object" "alert" {
  for_each = local.payloads

  path                    = local.collection_path
  read_path               = local.item_path
  update_path             = local.item_path
  destroy_path            = local.item_path
  id_attribute            = "id"
  data                    = jsonencode(each.value)
  ignore_server_additions = true

  lifecycle {
    prevent_destroy = true

    precondition {
      condition = (
        length(trimspace(each.value.name)) > 0 &&
        length(each.value.filters.serviceNames) > 0 &&
        alltrue([
          for service_name in each.value.filters.serviceNames :
          length(trimspace(service_name)) > 0
        ]) &&
        each.value.threshold_count >= 0 &&
        contains(["above", "below"], each.value.threshold_operator) &&
        contains([5, 10, 15, 30, 60], each.value.window_minutes) &&
        each.value.evaluation_periods >= 1 &&
        each.value.datapoints_to_alarm >= 1 &&
        each.value.datapoints_to_alarm <= each.value.evaluation_periods &&
        each.value.cooldown_minutes >= 0
      )
      error_message = "PostHog log alerts must have valid services, thresholds, windows, evaluation periods, datapoints, and cooldowns."
    }
  }
}

output "alert_ids" {
  value = { for key, alert in restapi_object.alert : key => alert.id }
}
