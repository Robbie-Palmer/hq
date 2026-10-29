#ifndef SATELLITE_SWARM_RESOURCE_OBSERVER_HPP
#define SATELLITE_SWARM_RESOURCE_OBSERVER_HPP

#include "satellite_swarm/interfaces.hpp"

#include <stdint.h>

namespace satellite_swarm {

enum class ResourceMetric : uint16_t {
  EnergyRemaining = 1U << 0U,
  Temperature = 1U << 1U,
  ComputationTime = 1U << 2U,
  StorageRemaining = 1U << 3U,
  ActuatorCyclesRemaining = 1U << 4U,
  RadioDutyCycle = 1U << 5U,
  CumulativeWear = 1U << 6U,
  FlashUsed = 1U << 7U,
  StaticRamUsed = 1U << 8U,
  StackHighWater = 1U << 9U,
  TelemetryFrameSize = 1U << 10U,
  RadioCapacity = 1U << 11U
};

constexpr uint16_t kAllResourceMetrics = (1U << 12U) - 1U;

struct ResourceObservation {
  uint32_t observed_at_ms = 0U;
  uint16_t available_metrics = 0U;
  uint32_t energy_remaining_millijoules = 0U;
  int32_t temperature_millicelsius = 0;
  uint32_t computation_time_microseconds = 0U;
  uint32_t storage_remaining_bytes = 0U;
  uint32_t actuator_cycles_remaining = 0U;
  uint16_t radio_duty_cycle_permyriad = 0U;
  uint32_t cumulative_wear_units = 0U;
  uint32_t flash_used_bytes = 0U;
  uint32_t static_ram_used_bytes = 0U;
  uint32_t stack_high_water_bytes = 0U;
  uint16_t telemetry_frame_bytes = 0U;
  uint32_t radio_capacity_bits_per_second = 0U;
};

enum class ResourceEvidenceStatus : uint8_t { Fresh, Stale, Unavailable, Invalid };

struct ResourceEvidenceRecord {
  ResourceEvidenceStatus status = ResourceEvidenceStatus::Unavailable;
  uint32_t recorded_at_ms = 0U;
  ResourceObservation observation{};
};

struct ResourceEvidenceConfig {
  uint32_t maximum_age_ms = 1000U;
};

// Records platform evidence without translating it into a health state or allocation score.
// The caller owns those policy decisions and can retain the raw record that led to them.
class ResourceEvidenceRecorder {
public:
  explicit ResourceEvidenceRecorder(
      ResourceObserver& observer, const ResourceEvidenceConfig& config = ResourceEvidenceConfig());

  ResourceEvidenceStatus sample(uint32_t now_ms);

  const ResourceEvidenceRecord& latestAttempt() const { return latest_attempt_; }
  const ResourceObservation& lastValidObservation() const { return last_valid_observation_; }
  bool hasLastValidObservation() const { return has_last_valid_observation_; }
  uint32_t freshSamples() const { return fresh_samples_; }
  uint32_t staleSamples() const { return stale_samples_; }
  uint32_t unavailableSamples() const { return unavailable_samples_; }
  uint32_t invalidSamples() const { return invalid_samples_; }
  uint32_t maximumAgeMs() const { return maximum_age_ms_; }

  static bool isValid(const ResourceObservation& observation);
  static bool hasMetric(const ResourceObservation& observation, ResourceMetric metric);

private:
  ResourceObserver& observer_;
  uint32_t maximum_age_ms_;
  ResourceEvidenceRecord latest_attempt_{};
  ResourceObservation last_valid_observation_{};
  bool has_last_valid_observation_ = false;
  uint32_t fresh_samples_ = 0U;
  uint32_t stale_samples_ = 0U;
  uint32_t unavailable_samples_ = 0U;
  uint32_t invalid_samples_ = 0U;

  static void increment(uint32_t& counter);
};

} // namespace satellite_swarm

#endif
