#include "satellite_swarm/controller.hpp"
#include "satellite_swarm/shared_radio_scheduler.hpp"
#include "satellite_swarm/telemetry_transmitter.hpp"
#include "test_doubles.hpp"

#include <catch2/catch_test_macros.hpp>
#include <limits>

using namespace satellite_swarm;
using namespace satellite_swarm::test;

namespace {

SharedRadioBudgetConfig testBudget() {
  SharedRadioBudgetConfig config;
  config.window_ms = 100U;
  config.maximum_bytes_per_window = 52U;
  config.maximum_airtime_microseconds_per_window = 30000U;
  return config;
}

class CountingHealthMonitor : public HealthMonitor {
public:
  HealthStatus poll() override {
    ++polls;
    return current;
  }

  uint32_t polls = 0U;
  HealthStatus current = HealthStatus::Nominal;
};

class CountingTelemetrySink : public TelemetrySink {
public:
  bool publish(const TelemetryEvent&) override {
    ++publications;
    return true;
  }

  uint32_t publications = 0U;
};

} // namespace

TEST_CASE("priority radio traffic is admitted before telemetry and may overrun its budget") {
  SharedRadioScheduler scheduler(testBudget());
  const RadioTrafficCost control_packet{18U, 10000U};
  const RadioTrafficCost telemetry_frame{34U, 18889U};

  scheduler.admitPriority(0U, PriorityRadioTraffic::Safety, control_packet);
  scheduler.admitPriority(0U, PriorityRadioTraffic::Coordination, control_packet);
  CHECK(scheduler.safetyAdmissions() == 1U);
  CHECK(scheduler.coordinationAdmissions() == 1U);
  CHECK(scheduler.usedBytes() == 36U);

  CHECK(scheduler.admitTelemetry(0U, telemetry_frame, true) ==
        TelemetryScheduleResult::DeferredForPriorityTraffic);
  CHECK(scheduler.admitTelemetry(0U, telemetry_frame, false) ==
        TelemetryScheduleResult::DeferredForBudget);
  CHECK(scheduler.priorityDeferrals() == 1U);
  CHECK(scheduler.budgetDeferrals() == 1U);
  CHECK(scheduler.telemetryAdmissions() == 0U);

  scheduler.admitPriority(0U, PriorityRadioTraffic::Safety, telemetry_frame);
  CHECK(scheduler.priorityBudgetOverruns() == 1U);
  CHECK(scheduler.usedBytes() == 70U);
}

TEST_CASE("a new budget window admits telemetry across clock rollover") {
  SharedRadioScheduler scheduler(testBudget());
  const RadioTrafficCost telemetry_frame{34U, 18889U};
  const uint32_t near_rollover = std::numeric_limits<uint32_t>::max() - 49U;

  CHECK(scheduler.admitTelemetry(near_rollover, telemetry_frame, false) ==
        TelemetryScheduleResult::Admitted);
  CHECK(scheduler.admitTelemetry(near_rollover, telemetry_frame, false) ==
        TelemetryScheduleResult::DeferredForBudget);
  CHECK(scheduler.admitTelemetry(50U, telemetry_frame, false) == TelemetryScheduleResult::Admitted);
  CHECK(scheduler.telemetryAdmissions() == 2U);
  CHECK(scheduler.usedBytes() == 34U);
}

TEST_CASE("a missing budget fails telemetry closed while priority work continues") {
  SharedRadioBudgetConfig config;
  config.window_ms = 0U;
  SharedRadioScheduler scheduler(config);

  CHECK(scheduler.admitTelemetry(0U, {1U, 1U}, false) ==
        TelemetryScheduleResult::DeferredForBudget);
  scheduler.admitPriority(0U, PriorityRadioTraffic::Coordination, {1U, 1U});
  CHECK(scheduler.coordinationAdmissions() == 1U);
}

TEST_CASE("a missing cost for an enforced budget dimension fails telemetry closed") {
  SharedRadioScheduler scheduler(testBudget());

  CHECK(scheduler.admitTelemetry(0U, {34U, 0U}, false) ==
        TelemetryScheduleResult::DeferredForBudget);
  CHECK(scheduler.admitTelemetry(0U, {0U, 18889U}, false) ==
        TelemetryScheduleResult::DeferredForBudget);
}

TEST_CASE("the scheduler converts cumulative queue drops into visible telemetry loss") {
  SharedRadioScheduler scheduler(testBudget());

  scheduler.observeTelemetryLoss(3U);
  scheduler.observeTelemetryLoss(5U);
  CHECK(scheduler.telemetryLosses() == 5U);

  // A lower cumulative value represents a replacement controller or counter reset.
  scheduler.observeTelemetryLoss(2U);
  CHECK(scheduler.telemetryLosses() == 7U);
}

TEST_CASE("event-storm telemetry never blocks local health polling") {
  FakeTransport transport;
  CountingHealthMonitor health;
  FixedScorer scorer(80U);
  ControllerConfig controller_config;
  controller_config.maximum_messages_per_update = 1U;
  SwarmController controller(0U, 1U, SatelliteSnapshot(), transport, health, scorer,
                             controller_config);
  SharedRadioScheduler scheduler(testBudget());
  CountingTelemetrySink sink;
  TelemetryTransmitter transmitter(controller, sink);

  REQUIRE(controller.initiateMission(Coordinate(), 0U));
  for (uint32_t now_ms = 0U; now_ms < 64U; ++now_ms) {
    health.current = now_ms % 2U == 0U ? HealthStatus::Quiescent : HealthStatus::Nominal;
    controller.update(now_ms);
    scheduler.observeTelemetryLoss(controller.droppedTelemetryEvents());
    const bool channel_available =
        scheduler.admitTelemetry(now_ms, {34U, 18889U}, true) == TelemetryScheduleResult::Admitted;
    CHECK(transmitter.update(now_ms, channel_available) ==
          TelemetryTransmitResult::ChannelUnavailable);
  }

  CHECK(health.polls == 64U);
  CHECK(sink.publications == 0U);
  CHECK(transmitter.attemptedRecords() == 0U);
  CHECK(scheduler.telemetryAdmissions() == 0U);
  CHECK(scheduler.priorityDeferrals() == 64U);
  CHECK(scheduler.telemetryLosses() == controller.droppedTelemetryEvents());
  CHECK(scheduler.telemetryLosses() > 0U);
  CHECK(controller.pendingTelemetryEvents() <= kTelemetryBufferCapacity);
}

TEST_CASE("radio accounting saturates instead of wrapping") {
  SharedRadioBudgetConfig config;
  config.maximum_bytes_per_window = std::numeric_limits<uint32_t>::max();
  config.maximum_airtime_microseconds_per_window = std::numeric_limits<uint32_t>::max();
  SharedRadioScheduler scheduler(config);

  scheduler.admitPriority(
      0U, PriorityRadioTraffic::Safety,
      {std::numeric_limits<uint32_t>::max(), std::numeric_limits<uint32_t>::max()});
  scheduler.admitPriority(0U, PriorityRadioTraffic::Safety, {1U, 1U});
  CHECK(scheduler.usedBytes() == std::numeric_limits<uint32_t>::max());
  CHECK(scheduler.usedAirtimeMicroseconds() == std::numeric_limits<uint32_t>::max());
  CHECK(scheduler.priorityBudgetOverruns() == 1U);
}
