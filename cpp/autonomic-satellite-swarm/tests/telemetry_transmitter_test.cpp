#include "satellite_swarm/telemetry_transmitter.hpp"
#include "test_doubles.hpp"

#include <catch2/catch_test_macros.hpp>
#include <vector>

using namespace satellite_swarm;
using namespace satellite_swarm::test;

namespace {

class FakeTelemetrySink : public TelemetrySink {
public:
  bool publish(const TelemetryEvent& event) override {
    if (!accepts_records) {
      return false;
    }
    records.push_back(event);
    return true;
  }

  bool accepts_records = true;
  std::vector<TelemetryEvent> records;
};

ControllerConfig fastConfig() {
  ControllerConfig config;
  config.node_capacity = 3U;
  config.response_window_ms = 20U;
  return config;
}

} // namespace

TEST_CASE("telemetry transmission yields to coordination and enforces its interval") {
  FakeTransport transport;
  FakeHealthMonitor health;
  FixedScorer scorer(80U);
  SwarmController controller(0U, 1U, SatelliteSnapshot(), transport, health, scorer, fastConfig());
  FakeTelemetrySink sink;
  TelemetryTransmitterConfig config;
  config.minimum_interval_ms = 100U;
  TelemetryTransmitter transmitter(controller, sink, config);
  REQUIRE(controller.initiateMission(Coordinate(), 10U));
  const uint8_t initial_pending = controller.pendingTelemetryEvents();
  REQUIRE(initial_pending >= 2U);

  CHECK(transmitter.update(10U, false) == TelemetryTransmitResult::ChannelUnavailable);
  CHECK(controller.pendingTelemetryEvents() == initial_pending);
  CHECK(transmitter.attemptedRecords() == 0U);

  CHECK(transmitter.update(10U, true) == TelemetryTransmitResult::Sent);
  REQUIRE(sink.records.size() == 1U);
  CHECK(sink.records.front().sequence == 1U);
  CHECK(controller.pendingTelemetryEvents() == initial_pending - 1U);

  CHECK(transmitter.update(109U, true) == TelemetryTransmitResult::RateLimited);
  CHECK(transmitter.update(110U, true) == TelemetryTransmitResult::Sent);
  REQUIRE(sink.records.size() == 2U);
  CHECK(sink.records.back().sequence == 2U);
  CHECK(transmitter.attemptedRecords() == 2U);
  CHECK(transmitter.sentRecords() == 2U);
  CHECK(transmitter.rejectedRecords() == 0U);
}

TEST_CASE("a rejected telemetry record stays queued until a later interval") {
  FakeTransport transport;
  FakeHealthMonitor health;
  FixedScorer scorer(80U);
  SwarmController controller(0U, 1U, SatelliteSnapshot(), transport, health, scorer, fastConfig());
  FakeTelemetrySink sink;
  sink.accepts_records = false;
  TelemetryTransmitterConfig config;
  config.minimum_interval_ms = 50U;
  TelemetryTransmitter transmitter(controller, sink, config);
  REQUIRE(controller.initiateMission(Coordinate(), 0U));
  const uint8_t initial_pending = controller.pendingTelemetryEvents();

  CHECK(transmitter.update(0U, true) == TelemetryTransmitResult::SinkRejected);
  CHECK(controller.pendingTelemetryEvents() == initial_pending);
  CHECK(transmitter.update(49U, true) == TelemetryTransmitResult::RateLimited);

  sink.accepts_records = true;
  CHECK(transmitter.update(50U, true) == TelemetryTransmitResult::Sent);
  REQUIRE(sink.records.size() == 1U);
  CHECK(sink.records.front().sequence == 1U);
  CHECK(controller.pendingTelemetryEvents() == initial_pending - 1U);
  CHECK(transmitter.attemptedRecords() == 2U);
  CHECK(transmitter.sentRecords() == 1U);
  CHECK(transmitter.rejectedRecords() == 1U);
}

TEST_CASE("telemetry rate limiting remains correct across clock rollover") {
  FakeTransport transport;
  FakeHealthMonitor health;
  FixedScorer scorer(80U);
  SwarmController controller(0U, 1U, SatelliteSnapshot(), transport, health, scorer, fastConfig());
  FakeTelemetrySink sink;
  TelemetryTransmitterConfig config;
  config.minimum_interval_ms = 10U;
  TelemetryTransmitter transmitter(controller, sink, config);
  REQUIRE(controller.initiateMission(Coordinate(), UINT32_MAX - 5U));

  CHECK(transmitter.update(UINT32_MAX - 5U, true) == TelemetryTransmitResult::Sent);
  CHECK(transmitter.update(3U, true) == TelemetryTransmitResult::RateLimited);
  CHECK(transmitter.update(4U, true) == TelemetryTransmitResult::Sent);
  CHECK(sink.records.size() == 2U);
}

TEST_CASE("an empty transmitter does not consume its first transmission opportunity") {
  FakeTransport transport;
  FakeHealthMonitor health;
  FixedScorer scorer(80U);
  SwarmController controller(0U, 1U, SatelliteSnapshot(), transport, health, scorer, fastConfig());
  FakeTelemetrySink sink;
  TelemetryTransmitterConfig config;
  config.minimum_interval_ms = 0U;
  TelemetryTransmitter transmitter(controller, sink, config);

  CHECK(transmitter.minimumIntervalMs() == 1U);
  CHECK(transmitter.update(20U, true) == TelemetryTransmitResult::NoTelemetry);
  REQUIRE(controller.initiateMission(Coordinate(), 20U));
  CHECK(transmitter.update(20U, true) == TelemetryTransmitResult::Sent);
  CHECK(transmitter.update(20U, true) == TelemetryTransmitResult::RateLimited);
}
