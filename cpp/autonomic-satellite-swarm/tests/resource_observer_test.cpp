#include "satellite_swarm/resource_observer.hpp"

#include <catch2/catch_test_macros.hpp>
#include <limits>

using namespace satellite_swarm;

namespace {

constexpr uint16_t metric(ResourceMetric value) { return static_cast<uint16_t>(value); }

class FakeResourceObserver : public ResourceObserver {
public:
  bool observe(ResourceObservation& destination) override {
    ++calls;
    if (!available) {
      return false;
    }
    destination = observation;
    return true;
  }

  ResourceObservation observation{};
  uint32_t calls = 0U;
  bool available = true;
};

ResourceObservation completeObservation(uint32_t observed_at_ms) {
  ResourceObservation observation;
  observation.observed_at_ms = observed_at_ms;
  observation.available_metrics = kAllResourceMetrics;
  observation.energy_remaining_millijoules = 240000U;
  observation.temperature_millicelsius = 31500;
  observation.computation_time_microseconds = 87U;
  observation.storage_remaining_bytes = 4096U;
  observation.actuator_cycles_remaining = 300U;
  observation.radio_duty_cycle_permyriad = 750U;
  observation.cumulative_wear_units = 12U;
  observation.flash_used_bytes = 14656U;
  observation.static_ram_used_bytes = 1257U;
  observation.stack_high_water_bytes = 384U;
  observation.telemetry_frame_bytes = 34U;
  observation.radio_capacity_bits_per_second = 14400U;
  return observation;
}

} // namespace

TEST_CASE("resource evidence keeps a fresh platform observation separate from policy") {
  FakeResourceObserver observer;
  observer.observation = completeObservation(90U);
  ResourceEvidenceConfig config;
  config.maximum_age_ms = 20U;
  ResourceEvidenceRecorder recorder(observer, config);

  CHECK(recorder.sample(100U) == ResourceEvidenceStatus::Fresh);
  CHECK(observer.calls == 1U);
  CHECK(recorder.latestAttempt().recorded_at_ms == 100U);
  CHECK(recorder.latestAttempt().observation.temperature_millicelsius == 31500);
  CHECK(recorder.hasLastValidObservation());
  CHECK(recorder.lastValidObservation().flash_used_bytes == 14656U);
  CHECK(recorder.freshSamples() == 1U);
  CHECK(recorder.staleSamples() == 0U);
  CHECK(recorder.unavailableSamples() == 0U);
  CHECK(recorder.invalidSamples() == 0U);
  CHECK(ResourceEvidenceRecorder::hasMetric(recorder.lastValidObservation(),
                                            ResourceMetric::ActuatorCyclesRemaining));
}

TEST_CASE("resource evidence distinguishes stale, unavailable, and invalid attempts") {
  FakeResourceObserver observer;
  ResourceEvidenceConfig config;
  config.maximum_age_ms = 10U;
  ResourceEvidenceRecorder recorder(observer, config);

  observer.observation = completeObservation(5U);
  CHECK(recorder.sample(20U) == ResourceEvidenceStatus::Stale);
  CHECK(recorder.hasLastValidObservation());
  CHECK(recorder.lastValidObservation().observed_at_ms == 5U);

  observer.available = false;
  CHECK(recorder.sample(21U) == ResourceEvidenceStatus::Unavailable);
  CHECK(recorder.latestAttempt().observation.available_metrics == 0U);
  CHECK(recorder.lastValidObservation().observed_at_ms == 5U);

  observer.available = true;
  observer.observation = completeObservation(30U);
  observer.observation.radio_duty_cycle_permyriad = 10001U;
  CHECK(recorder.sample(30U) == ResourceEvidenceStatus::Invalid);
  CHECK(recorder.lastValidObservation().observed_at_ms == 5U);
  CHECK(recorder.staleSamples() == 1U);
  CHECK(recorder.unavailableSamples() == 1U);
  CHECK(recorder.invalidSamples() == 1U);
}

TEST_CASE("resource freshness supports clock rollover and rejects future timestamps") {
  FakeResourceObserver observer;
  ResourceEvidenceConfig config;
  config.maximum_age_ms = 10U;
  ResourceEvidenceRecorder recorder(observer, config);

  observer.observation = completeObservation(std::numeric_limits<uint32_t>::max() - 5U);
  CHECK(recorder.sample(4U) == ResourceEvidenceStatus::Fresh);

  observer.observation = completeObservation(100U);
  CHECK(recorder.sample(99U) == ResourceEvidenceStatus::Invalid);
}

TEST_CASE("resource validation requires honest availability metadata") {
  ResourceObservation observation;
  CHECK_FALSE(ResourceEvidenceRecorder::isValid(observation));

  observation.available_metrics = static_cast<uint16_t>(kAllResourceMetrics | (1U << 15U));
  CHECK_FALSE(ResourceEvidenceRecorder::isValid(observation));

  observation = ResourceObservation();
  observation.temperature_millicelsius = 1;
  CHECK_FALSE(ResourceEvidenceRecorder::isValid(observation));
  observation.temperature_millicelsius = 0;
  observation.available_metrics = metric(ResourceMetric::Temperature);
  observation.temperature_millicelsius = -273151;
  CHECK_FALSE(ResourceEvidenceRecorder::isValid(observation));
  observation.temperature_millicelsius = 200001;
  CHECK_FALSE(ResourceEvidenceRecorder::isValid(observation));

  observation = ResourceObservation();
  observation.available_metrics = metric(ResourceMetric::TelemetryFrameSize);
  CHECK_FALSE(ResourceEvidenceRecorder::isValid(observation));
  observation.telemetry_frame_bytes = 34U;
  CHECK(ResourceEvidenceRecorder::isValid(observation));

  observation = ResourceObservation();
  observation.available_metrics = metric(ResourceMetric::RadioCapacity);
  CHECK_FALSE(ResourceEvidenceRecorder::isValid(observation));
  observation.radio_capacity_bits_per_second = 1U;
  CHECK(ResourceEvidenceRecorder::isValid(observation));

  const ResourceMetric scalar_metrics[] = {
      ResourceMetric::EnergyRemaining,  ResourceMetric::ComputationTime,
      ResourceMetric::StorageRemaining, ResourceMetric::ActuatorCyclesRemaining,
      ResourceMetric::RadioDutyCycle,   ResourceMetric::CumulativeWear,
      ResourceMetric::FlashUsed,        ResourceMetric::StaticRamUsed,
      ResourceMetric::StackHighWater,   ResourceMetric::TelemetryFrameSize,
      ResourceMetric::RadioCapacity,
  };
  for (const ResourceMetric resource_metric : scalar_metrics) {
    observation = ResourceObservation();
    switch (resource_metric) {
    case ResourceMetric::EnergyRemaining:
      observation.energy_remaining_millijoules = 1U;
      break;
    case ResourceMetric::ComputationTime:
      observation.computation_time_microseconds = 1U;
      break;
    case ResourceMetric::StorageRemaining:
      observation.storage_remaining_bytes = 1U;
      break;
    case ResourceMetric::ActuatorCyclesRemaining:
      observation.actuator_cycles_remaining = 1U;
      break;
    case ResourceMetric::RadioDutyCycle:
      observation.radio_duty_cycle_permyriad = 1U;
      break;
    case ResourceMetric::CumulativeWear:
      observation.cumulative_wear_units = 1U;
      break;
    case ResourceMetric::FlashUsed:
      observation.flash_used_bytes = 1U;
      break;
    case ResourceMetric::StaticRamUsed:
      observation.static_ram_used_bytes = 1U;
      break;
    case ResourceMetric::StackHighWater:
      observation.stack_high_water_bytes = 1U;
      break;
    case ResourceMetric::TelemetryFrameSize:
      observation.telemetry_frame_bytes = 1U;
      break;
    case ResourceMetric::RadioCapacity:
      observation.radio_capacity_bits_per_second = 1U;
      break;
    case ResourceMetric::Temperature:
      break;
    }
    CHECK_FALSE(ResourceEvidenceRecorder::isValid(observation));
  }
}

TEST_CASE("a zero resource freshness limit is normalized") {
  FakeResourceObserver observer;
  ResourceEvidenceConfig config;
  config.maximum_age_ms = 0U;
  ResourceEvidenceRecorder recorder(observer, config);

  CHECK(recorder.maximumAgeMs() == 1U);
}
