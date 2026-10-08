#include "satellite_swarm/telemetry.hpp"

#include <catch2/catch_test_macros.hpp>

using namespace satellite_swarm;

namespace {

TelemetryEvent event(TelemetryPriority priority, uint32_t timestamp_ms = 0U) {
  TelemetryEvent value;
  value.priority = priority;
  value.timestamp_ms = timestamp_ms;
  return value;
}

} // namespace

TEST_CASE("telemetry records have ordered sequence numbers and bounded storage") {
  BoundedTelemetryBuffer telemetry;

  for (uint8_t index = 0U; index < kTelemetryBufferCapacity; ++index) {
    REQUIRE(telemetry.record(event(TelemetryPriority::Routine, index)));
  }
  CHECK(telemetry.size() == kTelemetryBufferCapacity);
  CHECK_FALSE(telemetry.record(event(TelemetryPriority::Routine, 99U)));
  CHECK(telemetry.droppedEvents() == 1U);

  for (uint32_t sequence = 1U; sequence <= kTelemetryBufferCapacity; ++sequence) {
    TelemetryEvent recorded;
    REQUIRE(telemetry.read(recorded));
    CHECK(recorded.sequence == sequence);
    CHECK(recorded.timestamp_ms == sequence - 1U);
  }
  TelemetryEvent empty;
  CHECK_FALSE(telemetry.read(empty));

  REQUIRE(telemetry.record(event(TelemetryPriority::Routine, 100U)));
  TelemetryEvent after_drop;
  REQUIRE(telemetry.read(after_drop));
  CHECK(after_drop.sequence == kTelemetryBufferCapacity + 2U);
  CHECK(after_drop.dropped_before == 1U);
}

TEST_CASE("critical telemetry displaces the oldest lower-priority record") {
  BoundedTelemetryBuffer telemetry;
  for (uint8_t index = 0U; index < kTelemetryBufferCapacity; ++index) {
    REQUIRE(telemetry.record(event(TelemetryPriority::Routine, index)));
  }

  TelemetryEvent critical = event(TelemetryPriority::Critical, 100U);
  critical.type = TelemetryEventType::MissionFailed;
  REQUIRE(telemetry.record(critical));
  CHECK(telemetry.size() == kTelemetryBufferCapacity);
  CHECK(telemetry.droppedEvents() == 1U);

  TelemetryEvent first;
  REQUIRE(telemetry.read(first));
  CHECK(first.sequence == 2U);
  TelemetryEvent last;
  while (telemetry.read(last)) {
  }
  CHECK(last.sequence == kTelemetryBufferCapacity + 1U);
  CHECK(last.type == TelemetryEventType::MissionFailed);
  CHECK(last.dropped_before == 1U);
}

TEST_CASE("operational telemetry cannot evict critical evidence") {
  BoundedTelemetryBuffer telemetry;
  for (uint8_t index = 0U; index < kTelemetryBufferCapacity; ++index) {
    REQUIRE(telemetry.record(event(TelemetryPriority::Critical, index)));
  }

  CHECK_FALSE(telemetry.record(event(TelemetryPriority::Operational, 100U)));
  CHECK(telemetry.droppedEvents() == 1U);
  TelemetryEvent first;
  REQUIRE(telemetry.read(first));
  CHECK(first.sequence == 1U);
}
