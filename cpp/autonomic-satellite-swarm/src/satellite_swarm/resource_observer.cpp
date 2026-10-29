#include "satellite_swarm/resource_observer.hpp"

namespace satellite_swarm {
namespace {

bool metricUnavailableWithValue(const ResourceObservation& observation, ResourceMetric metric,
                                uint32_t value) {
  return !ResourceEvidenceRecorder::hasMetric(observation, metric) && value != 0U;
}

} // namespace

ResourceEvidenceRecorder::ResourceEvidenceRecorder(ResourceObserver& observer,
                                                   const ResourceEvidenceConfig& config)
    : observer_(observer),
      maximum_age_ms_(config.maximum_age_ms == 0U ? 1U : config.maximum_age_ms) {}

ResourceEvidenceStatus ResourceEvidenceRecorder::sample(uint32_t now_ms) {
  ResourceObservation observation;
  latest_attempt_.recorded_at_ms = now_ms;
  if (!observer_.observe(observation)) {
    latest_attempt_.status = ResourceEvidenceStatus::Unavailable;
    latest_attempt_.observation = ResourceObservation();
    increment(unavailable_samples_);
    return latest_attempt_.status;
  }

  const uint32_t age_ms = now_ms - observation.observed_at_ms;
  if (!isValid(observation) || age_ms > static_cast<uint32_t>(INT32_MAX)) {
    latest_attempt_.status = ResourceEvidenceStatus::Invalid;
    latest_attempt_.observation = observation;
    increment(invalid_samples_);
    return latest_attempt_.status;
  }

  latest_attempt_.observation = observation;
  last_valid_observation_ = observation;
  has_last_valid_observation_ = true;
  if (age_ms > maximum_age_ms_) {
    latest_attempt_.status = ResourceEvidenceStatus::Stale;
    increment(stale_samples_);
  } else {
    latest_attempt_.status = ResourceEvidenceStatus::Fresh;
    increment(fresh_samples_);
  }
  return latest_attempt_.status;
}

bool ResourceEvidenceRecorder::isValid(const ResourceObservation& observation) {
  if (observation.available_metrics == 0U ||
      (observation.available_metrics & static_cast<uint16_t>(~kAllResourceMetrics)) != 0U) {
    return false;
  }
  if (hasMetric(observation, ResourceMetric::Temperature) &&
      (observation.temperature_millicelsius < -273150 ||
       observation.temperature_millicelsius > 200000)) {
    return false;
  }
  if (!hasMetric(observation, ResourceMetric::Temperature) &&
      observation.temperature_millicelsius != 0) {
    return false;
  }
  if (hasMetric(observation, ResourceMetric::RadioDutyCycle) &&
      observation.radio_duty_cycle_permyriad > 10000U) {
    return false;
  }
  if (hasMetric(observation, ResourceMetric::TelemetryFrameSize) &&
      observation.telemetry_frame_bytes == 0U) {
    return false;
  }
  if (hasMetric(observation, ResourceMetric::RadioCapacity) &&
      observation.radio_capacity_bits_per_second == 0U) {
    return false;
  }

  return !metricUnavailableWithValue(observation, ResourceMetric::EnergyRemaining,
                                     observation.energy_remaining_millijoules) &&
         !metricUnavailableWithValue(observation, ResourceMetric::ComputationTime,
                                     observation.computation_time_microseconds) &&
         !metricUnavailableWithValue(observation, ResourceMetric::StorageRemaining,
                                     observation.storage_remaining_bytes) &&
         !metricUnavailableWithValue(observation, ResourceMetric::ActuatorCyclesRemaining,
                                     observation.actuator_cycles_remaining) &&
         !metricUnavailableWithValue(observation, ResourceMetric::RadioDutyCycle,
                                     observation.radio_duty_cycle_permyriad) &&
         !metricUnavailableWithValue(observation, ResourceMetric::CumulativeWear,
                                     observation.cumulative_wear_units) &&
         !metricUnavailableWithValue(observation, ResourceMetric::FlashUsed,
                                     observation.flash_used_bytes) &&
         !metricUnavailableWithValue(observation, ResourceMetric::StaticRamUsed,
                                     observation.static_ram_used_bytes) &&
         !metricUnavailableWithValue(observation, ResourceMetric::StackHighWater,
                                     observation.stack_high_water_bytes) &&
         !metricUnavailableWithValue(observation, ResourceMetric::TelemetryFrameSize,
                                     observation.telemetry_frame_bytes) &&
         !metricUnavailableWithValue(observation, ResourceMetric::RadioCapacity,
                                     observation.radio_capacity_bits_per_second);
}

bool ResourceEvidenceRecorder::hasMetric(const ResourceObservation& observation,
                                         ResourceMetric metric) {
  return (observation.available_metrics & static_cast<uint16_t>(metric)) != 0U;
}

void ResourceEvidenceRecorder::increment(uint32_t& counter) {
  if (counter != UINT32_MAX) {
    ++counter;
  }
}

} // namespace satellite_swarm
