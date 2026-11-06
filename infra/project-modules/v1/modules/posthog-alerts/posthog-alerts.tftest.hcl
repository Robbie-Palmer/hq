mock_provider "restapi" {}

variables {
  project_id = "12345"
  alerts = {
    api_errors = {
      name                = "Example API errors"
      service_names       = ["example-api"]
      threshold_count     = 2
      evaluation_periods  = 2
      datapoints_to_alarm = 1
      cooldown_minutes    = 30
    }
  }
}

run "production_log_alert_is_managed" {
  command = plan

  assert {
    condition = (
      length(restapi_object.alert) == 1 &&
      jsondecode(restapi_object.alert["api_errors"].data).filters.filterGroup.values[0].values[0].value == "production"
    )
    error_message = "Generated alerts must filter on the production deployment environment."
  }
}

run "invalid_alert_threshold_is_rejected" {
  command = plan

  variables {
    alerts = {
      invalid = {
        name            = "Invalid alert"
        service_names   = ["example-api"]
        threshold_count = -1
      }
    }
  }

  expect_failures = [restapi_object.alert["invalid"]]
}
