#include "satellite_swarm/controller.hpp"
#include "test_doubles.hpp"

#include <catch2/catch_test_macros.hpp>
#include <limits>

using namespace satellite_swarm;
using namespace satellite_swarm::test;

namespace {

ControllerConfig fastConfig() {
  ControllerConfig config;
  config.response_window_ms = 100U;
  config.retry_interval_ms = 10U;
  config.maximum_attempts = 2U;
  config.failed_missions_before_safe_disable = 2U;
  config.node_capacity = 3U;
  config.maximum_messages_per_update = 4U;
  return config;
}

MissionKey mission(NodeId origin, MissionSequence sequence, BootEpoch epoch = 1U) {
  return MissionKey(origin, epoch, sequence);
}

class LongitudeScorer : public CandidacyScorer {
public:
  uint8_t score(const SatelliteSnapshot& satellite, const Coordinate&) const override {
    return satellite.coordinate.longitude_degrees == 25.0F ? 80U : 20U;
  }
};

} // namespace

TEST_CASE("a validated satellite snapshot feeds later candidacy scoring") {
  FakeTransport transport;
  FakeHealthMonitor health;
  LongitudeScorer scorer;
  SwarmController controller(2, 1U, SatelliteSnapshot(), transport, health, scorer, fastConfig());
  SatelliteSnapshot refreshed;
  refreshed.coordinate = Coordinate(25.0F, 40.0F);

  REQUIRE(controller.updateSatelliteSnapshot(refreshed));
  CHECK(controller.satelliteSnapshot().coordinate.longitude_degrees == 25.0F);
  CHECK(controller.satelliteSnapshot().coordinate.latitude_degrees == 40.0F);

  transport.deliver(Message::missionRequest(0, mission(0, 17), Coordinate()));
  controller.update(0U);

  REQUIRE(transport.sent.size() == 1U);
  CHECK(transport.sent.front().score == 80U);
}

TEST_CASE("an invalid satellite snapshot does not replace the last valid observation") {
  FakeTransport transport;
  FakeHealthMonitor health;
  FixedScorer scorer(50U);
  SatelliteSnapshot initial;
  initial.coordinate = Coordinate(25.0F, 40.0F);
  SwarmController controller(0, 1U, initial, transport, health, scorer, fastConfig());
  SatelliteSnapshot invalid = initial;
  invalid.coordinate.latitude_degrees = 91.0F;

  CHECK_FALSE(controller.updateSatelliteSnapshot(invalid));
  CHECK(controller.satelliteSnapshot().coordinate.longitude_degrees == 25.0F);
  CHECK(controller.satelliteSnapshot().coordinate.latitude_degrees == 40.0F);
}

TEST_CASE("a leader collects scores and deterministically assigns the strongest candidate") {
  FakeTransport transport;
  FakeHealthMonitor health;
  FixedScorer scorer(40);
  SwarmController controller(0, 1U, SatelliteSnapshot(), transport, health, scorer, fastConfig());

  REQUIRE(controller.initiateMission(Coordinate(10.0F, 20.0F), 1U));
  REQUIRE(controller.state() == ControllerState::Leading);
  REQUIRE(transport.sent.size() == 1U);
  CHECK(transport.sent.front().type == MessageType::MissionRequest);

  transport.deliver(Message::candidacy(1, 0, controller.currentMissionKey(), 80));
  transport.deliver(Message::candidacy(2, 0, controller.currentMissionKey(), 80));
  controller.update(2U);
  REQUIRE(transport.sent.size() == 3U);
  CHECK(transport.sent[1].type == MessageType::Acknowledgement);
  CHECK(transport.sent[2].type == MessageType::Acknowledgement);

  controller.update(101U);
  CHECK(controller.state() == ControllerState::Idle);
  CHECK(controller.assignedNode() == 1U);
  CHECK(transport.sent.back().type == MessageType::MissionAssignment);
  CHECK(transport.sent.back().target == 1U);
}

TEST_CASE("equal top scores rotate across responders and emit allocation telemetry") {
  FakeTransport transport;
  FakeHealthMonitor health;
  FixedScorer scorer(80U);
  SwarmController controller(0U, 1U, SatelliteSnapshot(), transport, health, scorer, fastConfig());
  std::array<uint8_t, 3U> assignment_counts{};

  for (MissionSequence sequence = 1U; sequence <= 6U; ++sequence) {
    const uint32_t started_at_ms = (sequence - 1U) * 200U;
    REQUIRE(controller.initiateMission(Coordinate(), started_at_ms));
    CHECK(controller.currentMissionKey() == MissionKey(0U, 1U, sequence));

    transport.deliver(Message::candidacy(1U, 0U, controller.currentMissionKey(), 80U));
    transport.deliver(Message::candidacy(2U, 0U, controller.currentMissionKey(), 80U));
    controller.update(started_at_ms + 1U);
    controller.update(started_at_ms + fastConfig().response_window_ms);

    const NodeId assigned = controller.assignedNode();
    REQUIRE(assigned < assignment_counts.size());
    ++assignment_counts[assigned];

    bool found_assignment_telemetry = false;
    TelemetryEvent telemetry;
    while (controller.readTelemetry(telemetry)) {
      if (telemetry.type == TelemetryEventType::MissionAssigned &&
          telemetry.reason == TelemetryReason::AssignmentBroadcast) {
        CHECK(telemetry.mission_key == MissionKey(0U, 1U, sequence));
        CHECK(telemetry.related_node == assigned);
        CHECK(telemetry.value == 80U);
        found_assignment_telemetry = true;
      }
    }
    CHECK(found_assignment_telemetry);

    if (controller.state() == ControllerState::Active) {
      controller.completeMission(started_at_ms + fastConfig().response_window_ms + 1U);
    }
    CHECK(controller.state() == ControllerState::Idle);
  }

  CHECK(assignment_counts == std::array<uint8_t, 3U>{2U, 2U, 2U});
}

TEST_CASE("a higher candidacy score overrides the cyclic tie-break order") {
  FakeTransport transport;
  FakeHealthMonitor health;
  FixedScorer scorer(80U);
  SwarmController controller(0U, 1U, SatelliteSnapshot(), transport, health, scorer, fastConfig());

  REQUIRE(controller.initiateMission(Coordinate(), 0U));
  transport.deliver(Message::candidacy(1U, 0U, controller.currentMissionKey(), 79U));
  transport.deliver(Message::candidacy(2U, 0U, controller.currentMissionKey(), 81U));
  controller.update(1U);
  controller.update(fastConfig().response_window_ms);

  CHECK(controller.assignedNode() == 2U);
}

TEST_CASE("a candidate progresses from request to acknowledgement to assignment") {
  FakeTransport transport;
  FakeHealthMonitor health;
  FixedScorer scorer(73);
  SwarmController controller(2, 1U, SatelliteSnapshot(), transport, health, scorer, fastConfig());

  transport.deliver(Message::missionRequest(0, mission(0, 17), Coordinate(-20.0F, 30.0F)));
  controller.update(5U);
  REQUIRE(controller.state() == ControllerState::AwaitingAcknowledgement);
  REQUIRE(transport.sent.size() == 1U);
  CHECK(transport.sent.back().score == 73U);
  CHECK(transport.sent.back().target == 0U);

  transport.deliver(Message::acknowledgement(0, 2, mission(0, 17)));
  controller.update(6U);
  CHECK(controller.state() == ControllerState::AwaitingAssignment);

  transport.deliver(Message::assignment(0, 2, mission(0, 17)));
  controller.update(7U);
  CHECK(controller.state() == ControllerState::Active);
  CHECK(controller.assignedNode() == 2U);

  controller.completeMission(8U);
  CHECK(controller.state() == ControllerState::Idle);
}

TEST_CASE("controller telemetry identifies mission decisions with stable keys") {
  FakeTransport transport;
  FakeHealthMonitor health;
  FixedScorer scorer(73U);
  SwarmController controller(2U, 4U, SatelliteSnapshot(), transport, health, scorer, fastConfig());
  const MissionKey key = mission(0U, 17U, 9U);

  transport.deliver(Message::missionRequest(0U, key, Coordinate()));
  controller.update(5U);
  transport.deliver(Message::acknowledgement(0U, 2U, key));
  controller.update(6U);
  transport.deliver(Message::assignment(0U, 2U, key));
  controller.update(7U);
  controller.completeMission(8U);

  REQUIRE(controller.pendingTelemetryEvents() == 7U);
  TelemetryEvent telemetry;
  REQUIRE(controller.readTelemetry(telemetry));
  CHECK(telemetry.sequence == 1U);
  CHECK(telemetry.boot_epoch == 4U);
  CHECK(telemetry.type == TelemetryEventType::CandidacySent);
  CHECK(telemetry.mission_key == key);
  CHECK(telemetry.related_node == 0U);
  CHECK(telemetry.value == 73U);

  while (telemetry.type != TelemetryEventType::MissionCompleted) {
    REQUIRE(controller.readTelemetry(telemetry));
  }
  CHECK(telemetry.timestamp_ms == 8U);
  CHECK(telemetry.priority == TelemetryPriority::Critical);
  CHECK(telemetry.mission_key == key);
  CHECK(telemetry.related_node == 2U);
}

TEST_CASE("controller telemetry records health reasons and drop accounting") {
  FakeTransport transport;
  FakeHealthMonitor health;
  FixedScorer scorer(50U);
  SwarmController controller(0U, 1U, SatelliteSnapshot(), transport, health, scorer, fastConfig());

  for (uint32_t cycle = 0U; cycle < 12U; ++cycle) {
    health.current = cycle % 2U == 0U ? HealthStatus::Quiescent : HealthStatus::Nominal;
    controller.update(cycle);
  }
  CHECK(controller.pendingTelemetryEvents() == kTelemetryBufferCapacity);
  CHECK(controller.droppedTelemetryEvents() == 8U);

  health.current = HealthStatus::Fatal;
  controller.update(20U);
  CHECK(controller.state() == ControllerState::SafeDisabled);
  CHECK(controller.pendingTelemetryEvents() == kTelemetryBufferCapacity);
  CHECK(controller.droppedTelemetryEvents() == 12U);

  bool saw_fatal_transition = false;
  TelemetryEvent telemetry;
  while (controller.readTelemetry(telemetry)) {
    if (telemetry.type == TelemetryEventType::StateTransition &&
        telemetry.current_state == ControllerState::SafeDisabled) {
      CHECK(telemetry.reason == TelemetryReason::HealthFatal);
      CHECK(telemetry.priority == TelemetryPriority::Critical);
      CHECK(telemetry.dropped_before == 11U);
      saw_fatal_transition = true;
    }
  }
  CHECK(saw_fatal_transition);
}

TEST_CASE("safe-disable makes one correlated platform request and remains latched on rejection") {
  FakeTransport transport;
  FakeHealthMonitor health;
  FixedScorer scorer(50U);
  FakeSafeStateActuator actuator;
  actuator.result = SafeStateResult::Rejected;
  SwarmController controller(2U, 7U, SatelliteSnapshot(),
                             ControllerDependencies{transport, health, scorer, &actuator},
                             fastConfig());

  health.current = HealthStatus::Fatal;
  controller.update(42U);

  CHECK(controller.state() == ControllerState::SafeDisabled);
  REQUIRE(actuator.request_count == 1U);
  CHECK(actuator.last_request.id == SafeStateRequestId(2U, 7U));
  CHECK(actuator.last_request.reason == SafeStateReason::FatalHealth);
  CHECK(actuator.last_request.mission_key == MissionKey());

  controller.update(43U);
  CHECK(controller.state() == ControllerState::SafeDisabled);
  CHECK(actuator.request_count == 1U);
  CHECK(actuator.status_count == 0U);

  std::array<TelemetryEventType, 4U> event_types{};
  std::array<uint8_t, 4U> event_values{};
  TelemetryEvent telemetry;
  std::size_t event_count = 0U;
  while (controller.readTelemetry(telemetry)) {
    REQUIRE(event_count < event_types.size());
    event_types[event_count] = telemetry.type;
    event_values[event_count] = telemetry.value;
    CHECK(telemetry.reason == TelemetryReason::HealthFatal);
    ++event_count;
  }

  REQUIRE(event_count == event_types.size());
  CHECK(event_types == std::array<TelemetryEventType, 4U>{TelemetryEventType::HealthChanged,
                                                          TelemetryEventType::SafeStateRequested,
                                                          TelemetryEventType::StateTransition,
                                                          TelemetryEventType::SafeStateResult});
  CHECK(event_values.back() == static_cast<uint8_t>(SafeStateResult::Rejected));
}

TEST_CASE("an accepted safe-state request reports one terminal execution result") {
  FakeTransport transport;
  FakeHealthMonitor health;
  FixedScorer scorer(50U);
  FakeSafeStateActuator actuator;
  SwarmController controller(2U, 7U, SatelliteSnapshot(),
                             ControllerDependencies{transport, health, scorer, &actuator},
                             fastConfig());

  health.current = HealthStatus::Fatal;
  controller.update(42U);
  REQUIRE(controller.state() == ControllerState::SafeDisabled);
  CHECK(actuator.request_count == 1U);
  CHECK(actuator.status_count == 0U);

  controller.update(43U);
  CHECK(actuator.status_count == 1U);
  CHECK(actuator.last_status_request == SafeStateRequestId(2U, 7U));

  actuator.execution_status = SafeStateExecutionStatus::Succeeded;
  controller.update(44U);
  CHECK(actuator.status_count == 2U);
  controller.update(45U);
  CHECK(actuator.status_count == 2U);

  std::array<TelemetryEventType, 5U> event_types{};
  TelemetryEvent telemetry;
  std::size_t event_count = 0U;
  while (controller.readTelemetry(telemetry)) {
    REQUIRE(event_count < event_types.size());
    event_types[event_count] = telemetry.type;
    if (telemetry.type == TelemetryEventType::SafeStateExecutionResult) {
      CHECK(telemetry.value == static_cast<uint8_t>(SafeStateExecutionStatus::Succeeded));
      CHECK(telemetry.reason == TelemetryReason::HealthFatal);
      CHECK(telemetry.priority == TelemetryPriority::Critical);
      CHECK(telemetry.related_node == 2U);
    }
    ++event_count;
  }

  REQUIRE(event_count == event_types.size());
  CHECK(event_types == std::array<TelemetryEventType, 5U>{
                           TelemetryEventType::HealthChanged,
                           TelemetryEventType::SafeStateRequested,
                           TelemetryEventType::StateTransition, TelemetryEventType::SafeStateResult,
                           TelemetryEventType::SafeStateExecutionResult});
}

TEST_CASE("a failed safe-state action reports failure and stops status polling") {
  FakeTransport transport;
  FakeHealthMonitor health;
  FixedScorer scorer(50U);
  FakeSafeStateActuator actuator;
  actuator.execution_status = SafeStateExecutionStatus::Failed;
  SwarmController controller(2U, 7U, SatelliteSnapshot(),
                             ControllerDependencies{transport, health, scorer, &actuator},
                             fastConfig());

  health.current = HealthStatus::Fatal;
  controller.update(42U);
  controller.update(43U);
  controller.update(44U);

  CHECK(actuator.status_count == 1U);
  TelemetryEvent telemetry;
  bool saw_failure = false;
  while (controller.readTelemetry(telemetry)) {
    if (telemetry.type == TelemetryEventType::SafeStateExecutionResult) {
      CHECK(telemetry.value == static_cast<uint8_t>(SafeStateExecutionStatus::Failed));
      saw_failure = true;
    }
  }
  CHECK(saw_failure);
}

TEST_CASE("communication-failure safe-disable identifies the mission in its platform request") {
  FakeTransport transport;
  FakeHealthMonitor health;
  FixedScorer scorer(50U);
  FakeSafeStateActuator actuator;
  ControllerConfig config = fastConfig();
  config.failed_missions_before_safe_disable = 1U;
  SwarmController controller(2U, 7U, SatelliteSnapshot(),
                             ControllerDependencies{transport, health, scorer, &actuator}, config);
  const MissionKey key = mission(0U, 19U, 3U);

  transport.deliver(Message::missionRequest(0U, key, Coordinate()));
  controller.update(0U);
  controller.update(config.retry_interval_ms);
  controller.update(config.retry_interval_ms * 2U);

  REQUIRE(controller.state() == ControllerState::SafeDisabled);
  REQUIRE(actuator.request_count == 1U);
  CHECK(actuator.last_request.id == SafeStateRequestId(2U, 7U));
  CHECK(actuator.last_request.reason == SafeStateReason::CommunicationFailureLimit);
  CHECK(actuator.last_request.mission_key == key);

  actuator.execution_status = SafeStateExecutionStatus::Succeeded;
  controller.update(config.retry_interval_ms * 2U + 1U);
  TelemetryEvent telemetry;
  bool saw_execution_result = false;
  while (controller.readTelemetry(telemetry)) {
    if (telemetry.type == TelemetryEventType::SafeStateExecutionResult) {
      CHECK(telemetry.reason == TelemetryReason::RetryLimitReached);
      CHECK(telemetry.mission_key == key);
      saw_execution_result = true;
    }
  }
  CHECK(saw_execution_result);
}

TEST_CASE("a direct assignment completes the negotiation and clears earlier failures") {
  FakeTransport transport;
  FakeHealthMonitor health;
  FixedScorer scorer(73);
  SwarmController controller(2, 1U, SatelliteSnapshot(), transport, health, scorer, fastConfig());

  transport.deliver(Message::missionRequest(0, mission(0, 16), Coordinate()));
  controller.update(0U);
  controller.update(10U);
  controller.update(20U);
  REQUIRE(controller.state() == ControllerState::Idle);
  REQUIRE(controller.consecutiveCommunicationFailures() == 1U);

  transport.deliver(Message::missionRequest(0, mission(0, 17), Coordinate()));
  controller.update(30U);
  REQUIRE(controller.state() == ControllerState::AwaitingAcknowledgement);
  transport.deliver(Message::assignment(0, 2, mission(0, 17)));
  controller.update(31U);

  CHECK(controller.state() == ControllerState::Active);
  CHECK(controller.consecutiveCommunicationFailures() == 0U);
}

TEST_CASE("messages from an earlier leader boot cannot complete a reused sequence") {
  FakeTransport transport;
  FakeHealthMonitor health;
  FixedScorer scorer(73);
  SwarmController controller(2, 4U, SatelliteSnapshot(), transport, health, scorer, fastConfig());
  const MissionKey current(0U, 9U, 1U);
  const MissionKey stale(0U, 8U, 1U);

  transport.deliver(Message::missionRequest(0U, current, Coordinate()));
  controller.update(0U);
  REQUIRE(controller.state() == ControllerState::AwaitingAcknowledgement);

  transport.deliver(Message::acknowledgement(0U, 2U, stale));
  transport.deliver(Message::assignment(0U, 2U, stale));
  controller.update(1U);
  CHECK(controller.state() == ControllerState::AwaitingAcknowledgement);
  CHECK(controller.assignedNode() == kBroadcastNode);

  transport.deliver(Message::assignment(0U, 2U, current));
  controller.update(2U);
  CHECK(controller.state() == ControllerState::Active);
  CHECK(controller.currentMissionKey() == current);
}

TEST_CASE("custom scorer output is constrained to the wire score range") {
  SECTION("candidate score") {
    FakeTransport transport;
    FakeHealthMonitor health;
    FixedScorer scorer(255U);
    SwarmController controller(2, 1U, SatelliteSnapshot(), transport, health, scorer, fastConfig());

    transport.deliver(Message::missionRequest(0, mission(0, 17), Coordinate()));
    controller.update(0U);

    REQUIRE(transport.sent.size() == 1U);
    CHECK(transport.sent.front().score == kMaximumCandidacyScore);
  }

  SECTION("leader score") {
    FakeTransport transport;
    FakeHealthMonitor health;
    FixedScorer scorer(255U);
    SwarmController controller(0, 1U, SatelliteSnapshot(), transport, health, scorer, fastConfig());

    REQUIRE(controller.initiateMission(Coordinate(), 0U));
    transport.deliver(Message::candidacy(1, 0, controller.currentMissionKey(), 99U));
    controller.update(1U);
    controller.update(100U);

    CHECK(controller.state() == ControllerState::Active);
    CHECK(controller.assignedNode() == 0U);
  }
}

TEST_CASE("an active node does not volunteer for another mission") {
  FakeTransport transport;
  FakeHealthMonitor health;
  FixedScorer scorer(73);
  SwarmController controller(2, 1U, SatelliteSnapshot(), transport, health, scorer, fastConfig());
  transport.deliver(Message::missionRequest(0, mission(0, 17), Coordinate()));
  controller.update(0U);
  transport.deliver(Message::acknowledgement(0, 2, mission(0, 17)));
  transport.deliver(Message::assignment(0, 2, mission(0, 17)));
  controller.update(1U);
  REQUIRE(controller.state() == ControllerState::Active);
  transport.sent.clear();

  transport.deliver(Message::missionRequest(1, mission(1, 99), Coordinate()));
  controller.update(2U);
  CHECK(controller.state() == ControllerState::Active);
  CHECK(transport.sent.empty());

  CHECK_FALSE(controller.initiateMission(Coordinate(10.0F, 20.0F), 3U));
  CHECK(controller.state() == ControllerState::Active);
  CHECK(controller.currentMissionKey() == mission(0, 17));
  CHECK(transport.sent.empty());
}

TEST_CASE("repeated unacknowledged candidacy triggers a latched safe-disabled state") {
  FakeTransport transport;
  FakeHealthMonitor health;
  FixedScorer scorer(50);
  SwarmController controller(2, 1U, SatelliteSnapshot(), transport, health, scorer, fastConfig());

  transport.deliver(Message::missionRequest(0, mission(0, 1), Coordinate()));
  controller.update(0U);
  controller.update(10U);
  controller.update(20U);
  REQUIRE(controller.state() == ControllerState::Idle);
  REQUIRE(controller.consecutiveCommunicationFailures() == 1U);

  transport.deliver(Message::missionRequest(0, mission(0, 2), Coordinate()));
  controller.update(30U);
  controller.update(40U);
  controller.update(50U);
  CHECK(controller.state() == ControllerState::SafeDisabled);

  uint8_t failure_transitions = 0U;
  TelemetryEvent telemetry;
  while (controller.readTelemetry(telemetry)) {
    if (telemetry.type == TelemetryEventType::StateTransition &&
        telemetry.reason == TelemetryReason::RetryLimitReached) {
      CHECK(telemetry.priority == TelemetryPriority::Critical);
      ++failure_transitions;
    }
  }
  CHECK(failure_transitions == 2U);

  health.current = HealthStatus::Nominal;
  controller.update(1000U);
  CHECK(controller.state() == ControllerState::SafeDisabled);
}

TEST_CASE("health monitoring supports reversible quiescence and irreversible fatal disablement") {
  FakeTransport transport;
  FakeHealthMonitor health;
  FixedScorer scorer(50);
  SwarmController controller(0, 1U, SatelliteSnapshot(), transport, health, scorer, fastConfig());

  health.current = HealthStatus::Quiescent;
  controller.update(0U);
  CHECK(controller.state() == ControllerState::Quiescent);

  health.current = HealthStatus::Nominal;
  controller.update(1U);
  CHECK(controller.state() == ControllerState::Idle);

  health.current = HealthStatus::Fatal;
  controller.update(2U);
  CHECK(controller.state() == ControllerState::SafeDisabled);
  health.current = HealthStatus::Nominal;
  controller.update(3U);
  CHECK(controller.state() == ControllerState::SafeDisabled);
}

TEST_CASE("elapsed-time checks remain correct across a 32-bit clock rollover") {
  FakeTransport transport;
  FakeHealthMonitor health;
  FixedScorer scorer(50);
  SwarmController controller(0, 1U, SatelliteSnapshot(), transport, health, scorer, fastConfig());
  const uint32_t start = std::numeric_limits<uint32_t>::max() - 49U;

  REQUIRE(controller.initiateMission(Coordinate(), start));
  controller.update(60U);
  CHECK(controller.state() == ControllerState::Active);
  CHECK(controller.assignedNode() == 0U);
}

TEST_CASE("invalid missions and out-of-range node identifiers are rejected") {
  FakeTransport transport;
  FakeHealthMonitor health;
  FixedScorer scorer(50);
  SwarmController invalid_node(9, 1U, SatelliteSnapshot(), transport, health, scorer, fastConfig());
  CHECK_FALSE(invalid_node.initiateMission(Coordinate(), 0U));
  CHECK(invalid_node.state() == ControllerState::SafeDisabled);
  transport.deliver(Message::missionRequest(0, mission(0, 1), Coordinate()));
  invalid_node.update(1U);
  CHECK(transport.sent.empty());

  SwarmController invalid_epoch(0, 0U, SatelliteSnapshot(), transport, health, scorer,
                                fastConfig());
  CHECK_FALSE(invalid_epoch.initiateMission(Coordinate(), 0U));
  CHECK(invalid_epoch.state() == ControllerState::SafeDisabled);

  SwarmController controller(0, 1U, SatelliteSnapshot(), transport, health, scorer, fastConfig());
  CHECK_FALSE(controller.initiateMission(Coordinate(0.0F, 91.0F), 0U));
}

TEST_CASE("mission sequences stop instead of wrapping within one boot epoch") {
  FakeTransport transport;
  FakeHealthMonitor health;
  FixedScorer scorer(50);
  ControllerConfig config = fastConfig();
  config.response_window_ms = 0U;
  SwarmController controller(0, 7U, SatelliteSnapshot(), transport, health, scorer, config);

  for (uint32_t sequence = 1U; sequence <= UINT16_MAX; ++sequence) {
    REQUIRE(controller.initiateMission(Coordinate(), sequence));
    controller.update(sequence);
    REQUIRE(controller.state() == ControllerState::Active);
    controller.completeMission(sequence);
  }

  CHECK(controller.currentMissionKey() == MissionKey(0U, 7U, UINT16_MAX));
  CHECK_FALSE(controller.initiateMission(Coordinate(), UINT16_MAX + 1U));
  CHECK(controller.state() == ControllerState::Idle);
}

TEST_CASE("zero-valued controller limits are normalized to safe operating bounds") {
  FakeTransport transport;
  FakeHealthMonitor health;
  FixedScorer scorer(50);
  ControllerConfig config = fastConfig();
  config.node_capacity = 0U;
  config.maximum_attempts = 0U;
  config.failed_missions_before_safe_disable = 0U;
  config.maximum_messages_per_update = 0U;
  SwarmController controller(kMaximumNodes - 1U, 1U, SatelliteSnapshot(), transport, health, scorer,
                             config);

  transport.deliver(Message::missionRequest(0, mission(0, 1), Coordinate()));
  controller.update(0U);
  REQUIRE(controller.state() == ControllerState::AwaitingAcknowledgement);

  controller.update(config.retry_interval_ms);
  CHECK(controller.state() == ControllerState::SafeDisabled);
}

TEST_CASE("message processing per update is bounded") {
  FakeTransport transport;
  FakeHealthMonitor health;
  FixedScorer scorer(50);
  ControllerConfig config = fastConfig();
  config.maximum_messages_per_update = 1U;
  SwarmController controller(0, 1U, SatelliteSnapshot(), transport, health, scorer, config);

  transport.deliver(Message::missionRequest(0, mission(0, 1), Coordinate()));
  transport.deliver(Message::missionRequest(0, mission(0, 2), Coordinate()));
  controller.update(0U);
  CHECK(transport.incoming.size() == 1U);

  controller.update(1U);
  CHECK(transport.incoming.empty());
}

TEST_CASE("an assignment to an out-of-range node is ignored") {
  FakeTransport transport;
  FakeHealthMonitor health;
  FixedScorer scorer(73);
  SwarmController controller(2, 1U, SatelliteSnapshot(), transport, health, scorer, fastConfig());

  transport.deliver(Message::missionRequest(0, mission(0, 17), Coordinate()));
  controller.update(0U);
  transport.deliver(Message::acknowledgement(0, 2, mission(0, 17)));
  controller.update(1U);
  REQUIRE(controller.state() == ControllerState::AwaitingAssignment);

  transport.deliver(Message::assignment(0, 99, mission(0, 17)));
  controller.update(2U);
  CHECK(controller.state() == ControllerState::AwaitingAssignment);
  CHECK(controller.assignedNode() == kBroadcastNode);
}

TEST_CASE("transport rejection does not masquerade as protocol progress") {
  FakeTransport transport;
  FakeHealthMonitor health;
  FixedScorer scorer(73);
  SwarmController controller(0, 1U, SatelliteSnapshot(), transport, health, scorer, fastConfig());

  transport.send_succeeds = false;
  CHECK_FALSE(controller.initiateMission(Coordinate(), 0U));
  CHECK(controller.state() == ControllerState::Idle);
  CHECK_FALSE(isValid(controller.currentMissionKey()));
  TelemetryEvent telemetry;
  REQUIRE(controller.readTelemetry(telemetry));
  CHECK(telemetry.type == TelemetryEventType::TransportFailure);
  CHECK(telemetry.reason == TelemetryReason::SendFailed);
  CHECK(telemetry.mission_key == mission(0U, 1U));
  CHECK(telemetry.timestamp_ms == 0U);

  transport.deliver(Message::missionRequest(1, mission(1, 17), Coordinate()));
  controller.update(1U);
  CHECK(controller.state() == ControllerState::Idle);
  CHECK(controller.consecutiveCommunicationFailures() == 0U);
}

TEST_CASE("a failed assignment send aborts the local negotiation") {
  FakeTransport transport;
  FakeHealthMonitor health;
  FixedScorer scorer(40);
  SwarmController controller(0, 1U, SatelliteSnapshot(), transport, health, scorer, fastConfig());

  REQUIRE(controller.initiateMission(Coordinate(), 0U));
  transport.deliver(Message::candidacy(1, 0, controller.currentMissionKey(), 80));
  controller.update(1U);
  transport.send_succeeds = false;
  controller.update(100U);

  CHECK(controller.state() == ControllerState::Idle);
  CHECK(controller.assignedNode() == kBroadcastNode);

  bool saw_transport_failure = false;
  bool saw_mission_failure = false;
  TelemetryEvent telemetry;
  while (controller.readTelemetry(telemetry)) {
    if (telemetry.type == TelemetryEventType::TransportFailure) {
      saw_transport_failure = true;
    }
    if (telemetry.type == TelemetryEventType::MissionFailed) {
      CHECK(telemetry.reason == TelemetryReason::SendFailed);
      CHECK(telemetry.priority == TelemetryPriority::Critical);
      saw_mission_failure = true;
    }
  }
  CHECK(saw_transport_failure);
  CHECK(saw_mission_failure);
}

TEST_CASE("messages queued at or after a phase deadline are ignored") {
  SECTION("late candidacy") {
    FakeTransport transport;
    FakeHealthMonitor health;
    FixedScorer scorer(40);
    SwarmController controller(0, 1U, SatelliteSnapshot(), transport, health, scorer, fastConfig());

    REQUIRE(controller.initiateMission(Coordinate(), 0U));
    transport.deliver(Message::candidacy(1, 0, controller.currentMissionKey(), 80));
    controller.update(100U);

    CHECK(controller.state() == ControllerState::Active);
    CHECK(controller.assignedNode() == 0U);
  }

  SECTION("late acknowledgement") {
    FakeTransport transport;
    FakeHealthMonitor health;
    FixedScorer scorer(40);
    SwarmController controller(2, 1U, SatelliteSnapshot(), transport, health, scorer, fastConfig());

    transport.deliver(Message::missionRequest(0, mission(0, 17), Coordinate()));
    controller.update(0U);
    controller.update(10U);
    transport.deliver(Message::acknowledgement(0, 2, mission(0, 17)));
    controller.update(20U);

    CHECK(controller.state() == ControllerState::Idle);
    CHECK(controller.consecutiveCommunicationFailures() == 1U);
  }

  SECTION("late assignment") {
    FakeTransport transport;
    FakeHealthMonitor health;
    FixedScorer scorer(40);
    SwarmController controller(2, 1U, SatelliteSnapshot(), transport, health, scorer, fastConfig());

    transport.deliver(Message::missionRequest(0, mission(0, 17), Coordinate()));
    controller.update(0U);
    transport.deliver(Message::acknowledgement(0, 2, mission(0, 17)));
    controller.update(1U);
    REQUIRE(controller.state() == ControllerState::AwaitingAssignment);
    transport.deliver(Message::assignment(0, 2, mission(0, 17)));
    controller.update(101U);

    CHECK(controller.state() == ControllerState::Idle);
    CHECK(controller.assignedNode() == kBroadcastNode);
  }
}
