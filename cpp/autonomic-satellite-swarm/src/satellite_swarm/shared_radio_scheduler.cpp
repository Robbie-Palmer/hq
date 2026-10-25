#include "satellite_swarm/shared_radio_scheduler.hpp"

namespace satellite_swarm {

SharedRadioScheduler::SharedRadioScheduler(const SharedRadioBudgetConfig& config)
    : window_ms_(config.window_ms == 0U ? 1U : config.window_ms),
      maximum_bytes_per_window_(config.maximum_bytes_per_window),
      maximum_airtime_microseconds_per_window_(config.maximum_airtime_microseconds_per_window) {}

void SharedRadioScheduler::admitPriority(uint32_t now_ms, PriorityRadioTraffic traffic,
                                         const RadioTrafficCost& cost) {
  refreshWindow(now_ms);
  const bool over_budget = exceedsBudget(cost);
  consume(cost);
  if (traffic == PriorityRadioTraffic::Safety) {
    increment(safety_admissions_);
  } else {
    increment(coordination_admissions_);
  }
  if (over_budget) {
    increment(priority_budget_overruns_);
  }
}

TelemetryScheduleResult SharedRadioScheduler::admitTelemetry(uint32_t now_ms,
                                                             const RadioTrafficCost& cost,
                                                             bool priority_traffic_pending) {
  refreshWindow(now_ms);
  if (priority_traffic_pending) {
    increment(priority_deferrals_);
    return TelemetryScheduleResult::DeferredForPriorityTraffic;
  }
  if (exceedsBudget(cost)) {
    increment(budget_deferrals_);
    return TelemetryScheduleResult::DeferredForBudget;
  }

  consume(cost);
  increment(telemetry_admissions_);
  return TelemetryScheduleResult::Admitted;
}

void SharedRadioScheduler::observeTelemetryLoss(uint32_t cumulative_drops) {
  const uint32_t new_losses = cumulative_drops >= last_observed_telemetry_drops_
                                  ? cumulative_drops - last_observed_telemetry_drops_
                                  : cumulative_drops;
  addSaturating(telemetry_losses_, new_losses);
  last_observed_telemetry_drops_ = cumulative_drops;
}

void SharedRadioScheduler::refreshWindow(uint32_t now_ms) {
  if (!window_started_) {
    window_started_ = true;
    window_started_at_ms_ = now_ms;
    return;
  }
  if (now_ms - window_started_at_ms_ >= window_ms_) {
    window_started_at_ms_ = now_ms;
    used_bytes_ = 0U;
    used_airtime_microseconds_ = 0U;
  }
}

bool SharedRadioScheduler::exceedsBudget(const RadioTrafficCost& cost) const {
  const bool no_budget =
      maximum_bytes_per_window_ == 0U && maximum_airtime_microseconds_per_window_ == 0U;
  const bool missing_cost =
      (maximum_bytes_per_window_ != 0U && cost.bytes == 0U) ||
      (maximum_airtime_microseconds_per_window_ != 0U && cost.airtime_microseconds == 0U);
  const bool exceeds_bytes =
      maximum_bytes_per_window_ != 0U && (cost.bytes > maximum_bytes_per_window_ ||
                                          used_bytes_ > maximum_bytes_per_window_ - cost.bytes);
  const bool exceeds_airtime =
      maximum_airtime_microseconds_per_window_ != 0U &&
      (cost.airtime_microseconds > maximum_airtime_microseconds_per_window_ ||
       used_airtime_microseconds_ >
           maximum_airtime_microseconds_per_window_ - cost.airtime_microseconds);
  return no_budget || missing_cost || exceeds_bytes || exceeds_airtime;
}

void SharedRadioScheduler::consume(const RadioTrafficCost& cost) {
  addSaturating(used_bytes_, cost.bytes);
  addSaturating(used_airtime_microseconds_, cost.airtime_microseconds);
}

void SharedRadioScheduler::addSaturating(uint32_t& value, uint32_t increment_value) {
  if (increment_value > UINT32_MAX - value) {
    value = UINT32_MAX;
  } else {
    value += increment_value;
  }
}

void SharedRadioScheduler::increment(uint32_t& counter) { addSaturating(counter, 1U); }

} // namespace satellite_swarm
