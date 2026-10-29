#ifndef SATELLITE_SWARM_SHARED_RADIO_SCHEDULER_HPP
#define SATELLITE_SWARM_SHARED_RADIO_SCHEDULER_HPP

#include <stdint.h>

namespace satellite_swarm {

enum class PriorityRadioTraffic : uint8_t { Coordination, Safety };

struct RadioTrafficCost {
  uint32_t bytes = 0U;
  uint32_t airtime_microseconds = 0U;
};

struct SharedRadioBudgetConfig {
  uint32_t window_ms = 1000U;
  // A zero limit disables that dimension. If both limits are zero, telemetry fails closed.
  uint32_t maximum_bytes_per_window = 0U;
  uint32_t maximum_airtime_microseconds_per_window = 0U;
};

enum class TelemetryScheduleResult : uint8_t {
  Admitted,
  DeferredForPriorityTraffic,
  DeferredForBudget
};

// Priority traffic is always admitted. Telemetry uses only capacity left after the platform has
// drained coordination and safety work for the current loop.
class SharedRadioScheduler {
public:
  explicit SharedRadioScheduler(const SharedRadioBudgetConfig& config = SharedRadioBudgetConfig());

  void admitPriority(uint32_t now_ms, PriorityRadioTraffic traffic, const RadioTrafficCost& cost);
  TelemetryScheduleResult admitTelemetry(uint32_t now_ms, const RadioTrafficCost& cost,
                                         bool priority_traffic_pending);
  // The controller queue owns telemetry storage. Feed its cumulative drop counter here so the
  // scheduler exposes loss alongside its own deferral counters.
  void observeTelemetryLoss(uint32_t cumulative_drops);

  uint32_t usedBytes() const { return used_bytes_; }
  uint32_t usedAirtimeMicroseconds() const { return used_airtime_microseconds_; }
  uint32_t coordinationAdmissions() const { return coordination_admissions_; }
  uint32_t safetyAdmissions() const { return safety_admissions_; }
  uint32_t telemetryAdmissions() const { return telemetry_admissions_; }
  uint32_t priorityDeferrals() const { return priority_deferrals_; }
  uint32_t budgetDeferrals() const { return budget_deferrals_; }
  uint32_t telemetryLosses() const { return telemetry_losses_; }
  uint32_t priorityBudgetOverruns() const { return priority_budget_overruns_; }

private:
  uint32_t window_ms_;
  uint32_t maximum_bytes_per_window_;
  uint32_t maximum_airtime_microseconds_per_window_;
  uint32_t window_started_at_ms_ = 0U;
  uint32_t used_bytes_ = 0U;
  uint32_t used_airtime_microseconds_ = 0U;
  uint32_t last_observed_telemetry_drops_ = 0U;
  uint32_t coordination_admissions_ = 0U;
  uint32_t safety_admissions_ = 0U;
  uint32_t telemetry_admissions_ = 0U;
  uint32_t priority_deferrals_ = 0U;
  uint32_t budget_deferrals_ = 0U;
  uint32_t telemetry_losses_ = 0U;
  uint32_t priority_budget_overruns_ = 0U;
  bool window_started_ = false;

  void refreshWindow(uint32_t now_ms);
  bool exceedsBudget(const RadioTrafficCost& cost) const;
  void consume(const RadioTrafficCost& cost);
  static void addSaturating(uint32_t& value, uint32_t increment);
  static void increment(uint32_t& counter);
};

} // namespace satellite_swarm

#endif
