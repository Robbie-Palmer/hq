#include "satellite_swarm/browser_simulation.hpp"
#include "satellite_swarm/fair_allocation_simulation.hpp"
#include "satellite_swarm/simulation.hpp"

#include <array>
#include <catch2/catch_test_macros.hpp>
#include <cstdint>
#include <limits>
#include <stdexcept>
#include <string>
#include <vector>

using namespace satellite_swarm;
using namespace satellite_swarm::simulation;

namespace {

SatelliteSnapshot satelliteAt(float longitude, float latitude) {
  SatelliteSnapshot satellite;
  satellite.coordinate = Coordinate(longitude, latitude);
  return satellite;
}

SimulationTrace demonstrationTrace() {
  SimulationTrace trace;
  trace.controller.response_window_ms = 100U;
  trace.nodes = {
      {0U, satelliteAt(3.0F, 90.0F)},
      {1U, satelliteAt(0.0F, 90.0F)},
      {2U, satelliteAt(1.0F, 90.0F)},
  };
  for (uint32_t now_ms = 0U; now_ms <= 100U; now_ms += 10U) {
    SimulationFrame frame;
    frame.now_ms = now_ms;
    if (now_ms == 0U) {
      frame.mission_commands.push_back({0U, Coordinate(0.0F, -90.0F)});
    }
    trace.frames.push_back(frame);
  }
  return trace;
}

} // namespace

TEST_CASE("a versioned trace reproduces the three-node mission in an ordered event log") {
  const SimulationResult result = runSimulationTrace(demonstrationTrace());

  REQUIRE(result.frames.size() == 11U);
  const FrameObservation& final_frame = result.frames.back();
  REQUIRE(final_frame.nodes.size() == 3U);
  CHECK(final_frame.nodes[0].assigned_node == 1U);
  CHECK(final_frame.nodes[0].state == ControllerState::Idle);
  CHECK(final_frame.nodes[1].state == ControllerState::Active);
  CHECK(final_frame.nodes[2].state == ControllerState::Idle);

  std::vector<MessageType> sent_messages;
  for (const SimulationEvent& event : result.events) {
    if (event.type == SimulationEventType::MessageSent) {
      sent_messages.push_back(event.message.type);
    }
  }
  REQUIRE(sent_messages.size() == 6U);
  CHECK(sent_messages[0] == MessageType::MissionRequest);
  CHECK(sent_messages[1] == MessageType::Candidacy);
  CHECK(sent_messages[2] == MessageType::Candidacy);
  CHECK(sent_messages[3] == MessageType::Acknowledgement);
  CHECK(sent_messages[4] == MessageType::Acknowledgement);
  CHECK(sent_messages[5] == MessageType::MissionAssignment);

  std::array<uint32_t, 3U> previous_sequences{};
  std::size_t telemetry_events = 0U;
  for (const SimulationEvent& event : result.events) {
    if (event.type != SimulationEventType::ControllerTelemetry) {
      continue;
    }
    const std::size_t node = static_cast<std::size_t>(event.node_id);
    CHECK(event.telemetry.sequence == previous_sequences[node] + 1U);
    CHECK(event.telemetry.node_id == event.node_id);
    CHECK(event.telemetry.boot_epoch == 1U);
    CHECK(event.telemetry.dropped_before == 0U);
    previous_sequences[node] = event.telemetry.sequence;
    ++telemetry_events;
  }
  CHECK(telemetry_events > 0U);
  CHECK(final_frame.nodes[0].telemetry_drops == 0U);
  CHECK(final_frame.nodes[1].telemetry_drops == 0U);
  CHECK(final_frame.nodes[2].telemetry_drops == 0U);
}

TEST_CASE("a trace replays accepted safe-state work through one terminal result") {
  SimulationTrace trace;
  trace.nodes = {{0U, SatelliteSnapshot(), 9U, SafeStateResult::Accepted}};
  SimulationFrame request_frame;
  request_frame.now_ms = 0U;
  request_frame.health_updates.push_back({0U, HealthStatus::Fatal});
  trace.frames.push_back(request_frame);
  SimulationFrame pending_frame;
  pending_frame.now_ms = 10U;
  trace.frames.push_back(pending_frame);
  SimulationFrame success_frame;
  success_frame.now_ms = 20U;
  success_frame.safe_state_status_updates.push_back({0U, SafeStateExecutionStatus::Succeeded});
  trace.frames.push_back(success_frame);
  SimulationFrame later_frame;
  later_frame.now_ms = 30U;
  trace.frames.push_back(later_frame);

  const SimulationResult result = runSimulationTrace(trace);
  std::size_t terminal_results = 0U;
  for (const SimulationEvent& event : result.events) {
    if (event.type == SimulationEventType::ControllerTelemetry &&
        event.telemetry.type == TelemetryEventType::SafeStateExecutionResult) {
      CHECK(event.now_ms == 20U);
      CHECK(event.telemetry.value == static_cast<uint8_t>(SafeStateExecutionStatus::Succeeded));
      ++terminal_results;
    }
  }

  CHECK(terminal_results == 1U);
  CHECK(result.frames.back().nodes[0].state == ControllerState::SafeDisabled);
}

TEST_CASE("browser serialization names every telemetry event, reason, priority, and state") {
  const BrowserSimulation simulation =
      makeBrowserDemonstration(Coordinate(0.0F, -90.0F), BrowserScenario::Nominal);
  SimulationResult result = runSimulationTrace(simulation.trace);
  result.events.clear();

  constexpr std::array<TelemetryEventType, 12> kEventTypes = {
      TelemetryEventType::StateTransition,  TelemetryEventType::MissionProposed,
      TelemetryEventType::CandidacySent,    TelemetryEventType::CandidacyAccepted,
      TelemetryEventType::MissionAssigned,  TelemetryEventType::MissionCompleted,
      TelemetryEventType::MissionFailed,    TelemetryEventType::HealthChanged,
      TelemetryEventType::TransportFailure, TelemetryEventType::SafeStateRequested,
      TelemetryEventType::SafeStateResult,  TelemetryEventType::SafeStateExecutionResult};
  constexpr std::array<const char*, 12> kEventNames = {
      "state-transition",     "mission-proposed",  "candidacy-sent",
      "candidacy-accepted",   "mission-assigned",  "mission-completed",
      "mission-failed",       "health-changed",    "transport-failure",
      "safe-state-requested", "safe-state-result", "safe-state-execution-result"};
  constexpr std::array<TelemetryReason, 14> kReasons = {TelemetryReason::None,
                                                        TelemetryReason::MissionInitiated,
                                                        TelemetryReason::MissionRequestAccepted,
                                                        TelemetryReason::AcknowledgementReceived,
                                                        TelemetryReason::AssignmentReceived,
                                                        TelemetryReason::AssignmentBroadcast,
                                                        TelemetryReason::AssignmentWindowExpired,
                                                        TelemetryReason::RetryLimitReached,
                                                        TelemetryReason::MissionCompleted,
                                                        TelemetryReason::HealthQuiescent,
                                                        TelemetryReason::HealthRecovered,
                                                        TelemetryReason::HealthFatal,
                                                        TelemetryReason::SendFailed,
                                                        TelemetryReason::InvalidConfiguration};
  constexpr std::array<const char*, 14> kReasonNames = {"none",
                                                        "mission-initiated",
                                                        "mission-request-accepted",
                                                        "acknowledgement-received",
                                                        "assignment-received",
                                                        "assignment-broadcast",
                                                        "assignment-window-expired",
                                                        "retry-limit-reached",
                                                        "mission-completed",
                                                        "health-quiescent",
                                                        "health-recovered",
                                                        "health-fatal",
                                                        "send-failed",
                                                        "invalid-configuration"};
  constexpr std::array<TelemetryPriority, 3> kPriorities = {
      TelemetryPriority::Routine, TelemetryPriority::Operational, TelemetryPriority::Critical};
  constexpr std::array<const char*, 3> kPriorityNames = {"routine", "operational", "critical"};
  constexpr std::array<ControllerState, 7> kStates = {ControllerState::Idle,
                                                      ControllerState::Leading,
                                                      ControllerState::AwaitingAcknowledgement,
                                                      ControllerState::AwaitingAssignment,
                                                      ControllerState::Active,
                                                      ControllerState::Quiescent,
                                                      ControllerState::SafeDisabled};

  for (std::size_t index = 0U; index < kReasons.size(); ++index) {
    SimulationEvent event;
    event.type = SimulationEventType::ControllerTelemetry;
    event.now_ms = static_cast<uint32_t>(index);
    event.node_id = 1U;
    event.telemetry.sequence = static_cast<uint32_t>(index + 1U);
    event.telemetry.boot_epoch = 2U;
    event.telemetry.node_id = 1U;
    event.telemetry.related_node = index == 0U ? kBroadcastNode : 2U;
    event.telemetry.type = kEventTypes[index % kEventTypes.size()];
    event.telemetry.reason = kReasons[index];
    event.telemetry.priority = kPriorities[index % kPriorities.size()];
    event.telemetry.previous_state = kStates[index % kStates.size()];
    event.telemetry.current_state = kStates[(index + 1U) % kStates.size()];
    if (index != 0U) {
      event.telemetry.mission_key = MissionKey(0U, 1U, 1U);
    }
    result.events.push_back(event);
  }

  const std::string json = serializeBrowserSimulation(simulation, result);
  for (const char* name : kEventNames) {
    CHECK(json.find(std::string(R"("event":")") + name + '"') != std::string::npos);
  }
  for (const char* name : kReasonNames) {
    CHECK(json.find(std::string(R"("reason":")") + name + '"') != std::string::npos);
  }
  for (const char* name : kPriorityNames) {
    CHECK(json.find(std::string(R"("priority":")") + name + '"') != std::string::npos);
  }
  CHECK(json.find(R"("relatedNode":null)") != std::string::npos);
  CHECK(json.find(R"("missionKey":null)") != std::string::npos);
  CHECK(json.find(R"("previousState":"quiescent")") != std::string::npos);
  CHECK(json.find(R"("currentState":"safe-disabled")") != std::string::npos);
}

TEST_CASE("a frame snapshot feeds both candidacy scoring and node observation") {
  SimulationTrace trace = demonstrationTrace();
  trace.nodes[1].satellite = satelliteAt(3.0F, 90.0F);
  trace.frames[0].satellite_updates.push_back({1U, satelliteAt(0.0F, 90.0F)});

  const SimulationResult result = runSimulationTrace(trace);

  REQUIRE(result.frames.front().nodes.size() == 3U);
  CHECK(result.frames.front().nodes[1].satellite.coordinate.longitude_degrees == 0.0F);

  bool found_score = false;
  for (const SimulationEvent& event : result.events) {
    if (event.type == SimulationEventType::MessageSent &&
        event.message.type == MessageType::Candidacy && event.node_id == 1U) {
      CHECK(event.message.score == 50U);
      found_score = true;
    }
  }
  CHECK(found_score);
}

TEST_CASE("malformed simulation traces fail before a controller runs") {
  SECTION("unsupported version") {
    SimulationTrace trace = demonstrationTrace();
    trace.version = 1U;
    CHECK_THROWS_AS(runSimulationTrace(trace), std::invalid_argument);
  }

  SECTION("repeated frame time") {
    SimulationTrace trace = demonstrationTrace();
    trace.frames[1].now_ms = trace.frames[0].now_ms;
    CHECK_THROWS_AS(runSimulationTrace(trace), std::invalid_argument);
  }

  SECTION("backward frame time") {
    SimulationTrace trace = demonstrationTrace();
    trace.frames[2].now_ms = 5U;
    CHECK_THROWS_AS(runSimulationTrace(trace), std::invalid_argument);
  }

  SECTION("unknown node") {
    SimulationTrace trace = demonstrationTrace();
    trace.frames[0].health_updates.push_back({9U, HealthStatus::Fatal});
    CHECK_THROWS_AS(runSimulationTrace(trace), std::invalid_argument);
  }

  SECTION("no configured nodes") {
    SimulationTrace trace = demonstrationTrace();
    trace.nodes.clear();
    CHECK_THROWS_AS(runSimulationTrace(trace), std::invalid_argument);
  }

  SECTION("too many configured nodes") {
    SimulationTrace trace = demonstrationTrace();
    trace.nodes.resize(kMaximumNodes + 1U);
    CHECK_THROWS_AS(runSimulationTrace(trace), std::invalid_argument);
  }

  SECTION("noncontiguous node IDs") {
    SimulationTrace trace = demonstrationTrace();
    trace.nodes[1].node_id = 2U;
    CHECK_THROWS_AS(runSimulationTrace(trace), std::invalid_argument);
  }

  SECTION("invalid initial satellite") {
    SimulationTrace trace = demonstrationTrace();
    trace.nodes[1].satellite.mass_kilograms = 0.0F;
    CHECK_THROWS_AS(runSimulationTrace(trace), std::invalid_argument);
  }

  SECTION("zero boot epoch") {
    SimulationTrace trace = demonstrationTrace();
    trace.nodes[1].boot_epoch = 0U;
    CHECK_THROWS_AS(runSimulationTrace(trace), std::invalid_argument);
  }

  SECTION("invalid safe-state request result") {
    SimulationTrace trace = demonstrationTrace();
    trace.nodes[1].safe_state_request_result = static_cast<SafeStateResult>(2U);
    CHECK_THROWS_AS(runSimulationTrace(trace), std::invalid_argument);
  }

  SECTION("boot epoch exhausted by reset") {
    SimulationTrace trace = demonstrationTrace();
    trace.nodes[1].boot_epoch = std::numeric_limits<BootEpoch>::max();
    trace.frames[0].node_resets.push_back({1U});
    CHECK_THROWS_AS(runSimulationTrace(trace), std::invalid_argument);
  }

  SECTION("invalid satellite update") {
    SimulationTrace trace = demonstrationTrace();
    SatelliteSnapshot invalid = satelliteAt(0.0F, 0.0F);
    invalid.coordinate.latitude_degrees = 91.0F;
    trace.frames[0].satellite_updates.push_back({1U, invalid});
    CHECK_THROWS_AS(runSimulationTrace(trace), std::invalid_argument);
  }

  SECTION("invalid health state") {
    SimulationTrace trace = demonstrationTrace();
    trace.frames[0].health_updates.push_back({1U, static_cast<HealthStatus>(3U)});
    CHECK_THROWS_AS(runSimulationTrace(trace), std::invalid_argument);
  }

  SECTION("invalid safe-state status") {
    SimulationTrace trace = demonstrationTrace();
    trace.frames[0].safe_state_status_updates.push_back(
        {1U, static_cast<SafeStateExecutionStatus>(3U)});
    CHECK_THROWS_AS(runSimulationTrace(trace), std::invalid_argument);
  }

  SECTION("unknown safe-state status node") {
    SimulationTrace trace = demonstrationTrace();
    trace.frames[0].safe_state_status_updates.push_back({9U, SafeStateExecutionStatus::Succeeded});
    CHECK_THROWS_AS(runSimulationTrace(trace), std::invalid_argument);
  }

  SECTION("unknown mission leader") {
    SimulationTrace trace = demonstrationTrace();
    trace.frames[0].mission_commands.push_back({9U, Coordinate()});
    CHECK_THROWS_AS(runSimulationTrace(trace), std::invalid_argument);
  }

  SECTION("invalid mission objective") {
    SimulationTrace trace = demonstrationTrace();
    trace.frames[0].mission_commands.push_back({1U, Coordinate(181.0F, 0.0F)});
    CHECK_THROWS_AS(runSimulationTrace(trace), std::invalid_argument);
  }

  SECTION("unknown mission completion node") {
    SimulationTrace trace = demonstrationTrace();
    trace.frames[0].mission_completions.push_back({9U});
    CHECK_THROWS_AS(runSimulationTrace(trace), std::invalid_argument);
  }
}

TEST_CASE("trace frames record health changes and rejected mission commands") {
  SimulationTrace trace = demonstrationTrace();
  trace.frames[0].health_updates.push_back({2U, HealthStatus::Quiescent});
  trace.frames[0].mission_commands.push_back({0U, Coordinate(10.0F, 20.0F)});
  trace.frames[1].health_updates.push_back({2U, HealthStatus::Fatal});

  const SimulationResult result = runSimulationTrace(trace);

  CHECK(result.frames[0].nodes[2].state == ControllerState::Quiescent);
  CHECK(result.frames[1].nodes[2].state == ControllerState::SafeDisabled);

  std::size_t accepted_commands = 0U;
  std::size_t rejected_commands = 0U;
  for (const SimulationEvent& event : result.events) {
    if (event.type == SimulationEventType::MissionCommand) {
      event.accepted ? ++accepted_commands : ++rejected_commands;
    }
  }
  CHECK(accepted_commands == 1U);
  CHECK(rejected_commands == 1U);
}

TEST_CASE("trace frames complete active missions before accepting new commands") {
  SimulationTrace trace = demonstrationTrace();
  trace.frames.resize(12U);
  SimulationFrame& final_frame = trace.frames.back();
  final_frame.now_ms = 110U;
  final_frame.mission_completions.push_back({1U});
  final_frame.mission_commands.push_back({1U, Coordinate(10.0F, 20.0F)});

  const SimulationResult result = runSimulationTrace(trace);

  CHECK(result.frames.back().nodes[1].state == ControllerState::Leading);
  std::size_t completion_index = result.events.size();
  std::size_t command_index = result.events.size();
  for (std::size_t index = 0U; index < result.events.size(); ++index) {
    const SimulationEvent& event = result.events[index];
    if (event.type == SimulationEventType::MissionCompletion && event.node_id == 1U) {
      CHECK(event.accepted);
      completion_index = index;
    }
    if (event.type == SimulationEventType::MissionCommand && event.node_id == 1U &&
        event.now_ms == 110U) {
      CHECK(event.accepted);
      command_index = index;
    }
  }
  CHECK(completion_index < command_index);
}

TEST_CASE("fair-allocation evidence is derived from six equal-score mission telemetry records") {
  const SimulationTrace trace = makeFairAllocationTrace();
  const SimulationResult result = runSimulationTrace(trace);
  std::array<uint8_t, 3U> assignment_counts{};
  std::vector<NodeId> assignments;

  for (const SimulationEvent& event : result.events) {
    if (event.type == SimulationEventType::ControllerTelemetry && event.node_id == 0U &&
        event.telemetry.type == TelemetryEventType::MissionAssigned &&
        event.telemetry.reason == TelemetryReason::AssignmentBroadcast) {
      REQUIRE(event.telemetry.related_node < assignment_counts.size());
      CHECK(event.telemetry.value == 100U);
      CHECK(event.telemetry.dropped_before == 0U);
      ++assignment_counts[event.telemetry.related_node];
      assignments.push_back(event.telemetry.related_node);
    }
  }

  CHECK(assignments == std::vector<NodeId>{0U, 1U, 2U, 0U, 1U, 2U});
  CHECK(assignment_counts == std::array<uint8_t, 3U>{2U, 2U, 2U});
  const std::string json = serializeFairAllocationEvidence(result);
  CHECK(json.find(R"("schemaVersion": 1)") != std::string::npos);
  CHECK(json.find(R"("traceVersion": 5)") != std::string::npos);
}

TEST_CASE("trace time supports one unsigned clock rollover") {
  SimulationTrace trace = demonstrationTrace();
  trace.frames.clear();
  SimulationFrame before_rollover;
  before_rollover.now_ms = std::numeric_limits<uint32_t>::max();
  trace.frames.push_back(before_rollover);
  SimulationFrame after_rollover;
  after_rollover.now_ms = 0U;
  trace.frames.push_back(after_rollover);

  const SimulationResult result = runSimulationTrace(trace);
  REQUIRE(result.frames.size() == 2U);
  CHECK(result.frames[0].now_ms == std::numeric_limits<uint32_t>::max());
  CHECK(result.frames[1].now_ms == 0U);
}

TEST_CASE("the browser demonstration accepts a caller-provided objective") {
  const Coordinate objective(18.25F, -34.5F);
  const BrowserSimulation simulation = makeBrowserDemonstration(objective);
  const SimulationTrace& trace = simulation.trace;

  REQUIRE_FALSE(trace.frames.empty());
  REQUIRE(trace.frames.front().mission_commands.size() == 1U);
  CHECK(trace.frames.front().mission_commands.front().objective.longitude_degrees == 18.25F);
  CHECK(trace.frames.front().mission_commands.front().objective.latitude_degrees == -34.5F);

  const std::string json = serializeBrowserSimulation(simulation, runSimulationTrace(trace));
  CHECK(json.find(R"("scenario": "three-node-objective-pass")") != std::string::npos);
  CHECK(json.find(R"("longitudeDegrees":18.25,"latitudeDegrees":-34.5)") != std::string::npos);
}

TEST_CASE("browser serialization rejects incomplete traces and results") {
  BrowserSimulation simulation = makeBrowserDemonstration(Coordinate(0.0F, -90.0F));
  SimulationTrace& trace = simulation.trace;
  const SimulationResult complete_result = runSimulationTrace(trace);

  SECTION("missing command") {
    trace.frames.front().mission_commands.clear();
    CHECK_THROWS_AS(serializeBrowserSimulation(simulation, complete_result), std::invalid_argument);
  }

  SECTION("missing sampled frame") {
    SimulationResult incomplete_result = complete_result;
    incomplete_result.frames.resize(12U);
    CHECK_THROWS_AS(serializeBrowserSimulation(simulation, incomplete_result),
                    std::invalid_argument);
  }
}

TEST_CASE("the browser demonstration rejects an invalid objective") {
  CHECK_THROWS_AS(makeBrowserDemonstration(Coordinate(0.0F, 91.0F)), std::invalid_argument);
}

TEST_CASE("a scripted assignment loss preserves each node's conflicting knowledge") {
  SimulationTrace trace = demonstrationTrace();
  trace.frames[10].delivery_faults.push_back(
      {0U, 1U, MessageType::MissionAssignment, DeliveryFaultType::Drop, 0U});

  const SimulationResult result = runSimulationTrace(trace);

  const FrameObservation& final_frame = result.frames.back();
  CHECK(final_frame.nodes[0].assigned_node == 1U);
  CHECK(final_frame.nodes[0].state == ControllerState::Idle);
  CHECK(final_frame.nodes[1].assigned_node == kBroadcastNode);
  CHECK(final_frame.nodes[1].state == ControllerState::AwaitingAssignment);
  CHECK(final_frame.nodes[2].assigned_node == 1U);

  bool found_drop = false;
  for (const SimulationEvent& event : result.events) {
    if (event.type == SimulationEventType::MessageDropped && event.node_id == 0U &&
        event.recipient_node == 1U && event.message.type == MessageType::MissionAssignment) {
      CHECK(event.drop_reason == MessageDropReason::Scripted);
      found_drop = true;
    }
  }
  CHECK(found_drop);
}

TEST_CASE("delayed messages are released on a later frame in replay order") {
  SimulationTrace trace = demonstrationTrace();
  trace.frames[0].delivery_faults.push_back(
      {1U, 0U, MessageType::Candidacy, DeliveryFaultType::Delay, 50U});

  const SimulationResult result = runSimulationTrace(trace);

  std::size_t delayed_index = result.events.size();
  std::size_t delivered_index = result.events.size();
  for (std::size_t index = 0; index < result.events.size(); ++index) {
    const SimulationEvent& event = result.events[index];
    if (event.node_id != 1U || event.recipient_node != 0U) {
      continue;
    }
    if (event.type == SimulationEventType::MessageDelayed) {
      delayed_index = index;
      CHECK(event.now_ms == 0U);
      CHECK(event.deliver_at_ms == 50U);
    } else if (event.type == SimulationEventType::DelayedMessageDelivered) {
      delivered_index = index;
      CHECK(event.now_ms == 50U);
    }
  }
  CHECK(delayed_index < delivered_index);
  CHECK(result.frames.back().nodes[1].state == ControllerState::Active);
}

TEST_CASE("a delayed message waits for its scheduled tick across clock rollover") {
  SimulationTrace trace = demonstrationTrace();
  trace.frames.clear();

  SimulationFrame schedule;
  schedule.now_ms = std::numeric_limits<uint32_t>::max() - 5U;
  schedule.mission_commands.push_back({0U, Coordinate(0.0F, -90.0F)});
  schedule.delivery_faults.push_back(
      {0U, 1U, MessageType::MissionRequest, DeliveryFaultType::Delay, 10U});
  trace.frames.push_back(schedule);
  for (const uint32_t now_ms : {std::numeric_limits<uint32_t>::max(), 0U, 4U}) {
    SimulationFrame frame;
    frame.now_ms = now_ms;
    trace.frames.push_back(frame);
  }

  const SimulationResult result = runSimulationTrace(trace);

  CHECK(result.frames[2].nodes[1].state == ControllerState::Idle);
  CHECK(result.frames[3].nodes[1].state == ControllerState::AwaitingAcknowledgement);
  std::size_t delayed_events = 0U;
  std::size_t delivered_events = 0U;
  for (const SimulationEvent& event : result.events) {
    if (event.node_id != 0U || event.recipient_node != 1U ||
        event.message.type != MessageType::MissionRequest) {
      continue;
    }
    if (event.type == SimulationEventType::MessageDelayed) {
      CHECK(event.now_ms == std::numeric_limits<uint32_t>::max() - 5U);
      CHECK(event.deliver_at_ms == 4U);
      ++delayed_events;
    }
    if (event.type == SimulationEventType::DelayedMessageDelivered) {
      CHECK(event.now_ms == 4U);
      ++delivered_events;
    }
  }
  CHECK(delayed_events == 1U);
  CHECK(delivered_events == 1U);
}

TEST_CASE("a reset completes before a due delayed message reaches the replacement controller") {
  SimulationTrace trace = demonstrationTrace();
  trace.frames[0].delivery_faults.push_back(
      {0U, 1U, MessageType::MissionRequest, DeliveryFaultType::Delay, 10U});
  trace.frames[1].node_resets.push_back({1U});

  const SimulationResult result = runSimulationTrace(trace);

  CHECK(result.frames[1].nodes[1].state == ControllerState::AwaitingAcknowledgement);
  std::size_t reset_index = result.events.size();
  std::size_t delivery_index = result.events.size();
  for (std::size_t index = 0U; index < result.events.size(); ++index) {
    const SimulationEvent& event = result.events[index];
    if (event.now_ms == 10U && event.type == SimulationEventType::NodeReset &&
        event.node_id == 1U) {
      reset_index = index;
    }
    if (event.now_ms == 10U && event.type == SimulationEventType::DelayedMessageDelivered &&
        event.node_id == 0U && event.recipient_node == 1U) {
      delivery_index = index;
    }
  }
  CHECK(reset_index < delivery_index);
}

TEST_CASE("a duplicated delivery is replayable without duplicating the send") {
  SimulationTrace trace = demonstrationTrace();
  trace.frames[0].delivery_faults.push_back(
      {1U, 0U, MessageType::Candidacy, DeliveryFaultType::Duplicate, 0U});

  const SimulationResult result = runSimulationTrace(trace);

  std::size_t candidate_sends = 0U;
  std::size_t acknowledgements_to_node_one = 0U;
  std::size_t duplicate_events = 0U;
  for (const SimulationEvent& event : result.events) {
    if (event.type == SimulationEventType::MessageSent && event.node_id == 1U &&
        event.message.type == MessageType::Candidacy) {
      ++candidate_sends;
    }
    if (event.type == SimulationEventType::MessageSent && event.node_id == 0U &&
        event.message.type == MessageType::Acknowledgement && event.message.target == 1U) {
      ++acknowledgements_to_node_one;
    }
    if (event.type == SimulationEventType::MessageDuplicated && event.node_id == 1U &&
        event.recipient_node == 0U) {
      ++duplicate_events;
    }
  }
  CHECK(candidate_sends == 1U);
  CHECK(acknowledgements_to_node_one == 2U);
  CHECK(duplicate_events == 1U);
}

TEST_CASE("directed link changes model an asymmetric partition") {
  SimulationTrace trace = demonstrationTrace();
  trace.frames[0].link_updates.push_back({0U, 1U, false});

  const SimulationResult result = runSimulationTrace(trace);

  CHECK(result.frames.back().nodes[0].assigned_node == 2U);
  CHECK_FALSE(isValid(result.frames.back().nodes[1].mission_key));
  CHECK(result.frames.back().nodes[2].state == ControllerState::Active);

  bool found_link_drop = false;
  for (const SimulationEvent& event : result.events) {
    if (event.type == SimulationEventType::MessageDropped && event.node_id == 0U &&
        event.recipient_node == 1U) {
      CHECK(event.drop_reason == MessageDropReason::LinkUnavailable);
      found_link_drop = true;
    }
  }
  CHECK(found_link_drop);
}

TEST_CASE("link loss takes precedence while consuming a matching delivery fault") {
  SimulationTrace trace = demonstrationTrace();
  trace.frames[0].link_updates.push_back({0U, 1U, false});
  trace.frames[0].delivery_faults.push_back(
      {0U, 1U, MessageType::MissionRequest, DeliveryFaultType::Duplicate, 0U});

  const SimulationResult result = runSimulationTrace(trace);

  std::size_t link_drops = 0U;
  std::size_t duplicates = 0U;
  for (const SimulationEvent& event : result.events) {
    if (event.node_id != 0U || event.recipient_node != 1U ||
        event.message.type != MessageType::MissionRequest) {
      continue;
    }
    if (event.type == SimulationEventType::MessageDropped &&
        event.drop_reason == MessageDropReason::LinkUnavailable) {
      ++link_drops;
    }
    if (event.type == SimulationEventType::MessageDuplicated) {
      ++duplicates;
    }
  }
  CHECK(link_drops == 1U);
  CHECK(duplicates == 0U);
}

TEST_CASE("node reset records the current protocol's loss of latched state") {
  SimulationTrace trace = demonstrationTrace();
  trace.frames[0].health_updates.push_back({1U, HealthStatus::Fatal});
  trace.frames[1].health_updates.push_back({1U, HealthStatus::Nominal});
  trace.frames[1].node_resets.push_back({1U});

  const SimulationResult result = runSimulationTrace(trace);

  CHECK(result.frames[0].nodes[1].state == ControllerState::SafeDisabled);
  CHECK(result.frames[1].nodes[1].state == ControllerState::Idle);
  bool found_reset = false;
  for (const SimulationEvent& event : result.events) {
    if (event.type == SimulationEventType::NodeReset && event.node_id == 1U) {
      CHECK(event.previous_state == ControllerState::SafeDisabled);
      CHECK(event.current_state == ControllerState::Idle);
      found_reset = true;
    }
  }
  CHECK(found_reset);
}

TEST_CASE("invalid network fault inputs fail deterministically") {
  SECTION("self-directed link update") {
    SimulationTrace trace = demonstrationTrace();
    trace.frames[0].link_updates.push_back({1U, 1U, false});
    CHECK_THROWS_AS(runSimulationTrace(trace), std::invalid_argument);
  }

  SECTION("zero-length delay") {
    SimulationTrace trace = demonstrationTrace();
    trace.frames[0].delivery_faults.push_back(
        {1U, 0U, MessageType::Candidacy, DeliveryFaultType::Delay, 0U});
    CHECK_THROWS_AS(runSimulationTrace(trace), std::invalid_argument);
  }

  SECTION("self-directed delivery fault") {
    SimulationTrace trace = demonstrationTrace();
    trace.frames[0].delivery_faults.push_back(
        {1U, 1U, MessageType::Candidacy, DeliveryFaultType::Drop, 0U});
    CHECK_THROWS_AS(runSimulationTrace(trace), std::invalid_argument);
  }

  SECTION("unmatched delivery fault") {
    SimulationTrace trace = demonstrationTrace();
    trace.frames[0].delivery_faults.push_back(
        {2U, 1U, MessageType::MissionAssignment, DeliveryFaultType::Drop, 0U});
    CHECK_THROWS_AS(runSimulationTrace(trace), std::invalid_argument);
  }
}

TEST_CASE("browser serialization preserves every network fault event") {
  BrowserSimulation simulation = makeBrowserDemonstration(Coordinate(0.0F, -90.0F));
  SimulationTrace& trace = simulation.trace;
  trace.frames[0].delivery_faults = {
      {0U, 2U, MessageType::MissionRequest, DeliveryFaultType::Duplicate, 0U},
      {1U, 0U, MessageType::Candidacy, DeliveryFaultType::Delay, 20U},
      {2U, 0U, MessageType::Candidacy, DeliveryFaultType::Delay, 30U},
  };
  trace.frames[2].link_updates.push_back({1U, 0U, false});
  trace.frames[3].link_updates.push_back({1U, 0U, true});
  trace.frames[12].node_resets.push_back({1U});

  const std::string json = serializeBrowserSimulation(simulation, runSimulationTrace(trace));

  CHECK(json.find(R"("type":"message-delayed")") != std::string::npos);
  CHECK(json.find(R"("deliverAtMs":20)") != std::string::npos);
  CHECK(json.find(R"("type":"message-duplicated")") != std::string::npos);
  CHECK(json.find(R"("type":"delayed-message-delivered")") != std::string::npos);
  CHECK(json.find(R"("reason":"link-unavailable")") != std::string::npos);
  CHECK(json.find(R"("type":"link-changed")") != std::string::npos);
  CHECK(json.find(R"("connected":false)") != std::string::npos);
  CHECK(json.find(R"("connected":true)") != std::string::npos);
  CHECK(json.find(R"("type":"node-reset")") != std::string::npos);
}

TEST_CASE("the browser assignment-loss scenario records the dropped delivery") {
  const BrowserSimulation simulation =
      makeBrowserDemonstration(Coordinate(0.0F, -90.0F), BrowserScenario::LostAssignment);
  const SimulationResult result = runSimulationTrace(simulation.trace);
  const std::string json = serializeBrowserSimulation(simulation, result);

  CHECK(simulation.scenario == BrowserScenario::LostAssignment);
  CHECK(json.find(R"("scenario": "three-node-assignment-loss")") != std::string::npos);
  CHECK(json.find(R"("type":"message-dropped")") != std::string::npos);
  REQUIRE(simulation.trace.frames[10].delivery_faults.size() == 1U);
  const DeliveryFault& fault = simulation.trace.frames[10].delivery_faults.front();
  CHECK(fault.sender != fault.recipient);
  CHECK(result.frames[10].nodes[fault.sender].assigned_node == fault.recipient);
  CHECK(result.frames.back().nodes[fault.recipient].state == ControllerState::Idle);

  bool found_winner_drop = false;
  for (const SimulationEvent& event : result.events) {
    if (event.type == SimulationEventType::MessageDropped && event.node_id == fault.sender &&
        event.recipient_node == fault.recipient && event.message.target == fault.recipient &&
        event.message.type == MessageType::MissionAssignment) {
      found_winner_drop = true;
    }
  }
  CHECK(found_winner_drop);
}

TEST_CASE("the browser safe-state scenario records successful execution") {
  const BrowserSimulation simulation =
      makeBrowserDemonstration(Coordinate(0.0F, -90.0F), BrowserScenario::SafeStateSuccess);
  const SimulationResult result = runSimulationTrace(simulation.trace);
  const std::string json = serializeBrowserSimulation(simulation, result);

  CHECK(simulation.scenario == BrowserScenario::SafeStateSuccess);
  CHECK(json.find(R"("scenario": "three-node-safe-state-success")") != std::string::npos);
  CHECK(json.find(R"("event":"safe-state-execution-result")") != std::string::npos);
  CHECK(json.find(R"("event":"safe-state-execution-result","reason":"health-fatal",)"
                  R"("priority":"critical","missionKey":{"originNode":0,"bootEpoch":1,)"
                  R"("sequence":1},"relatedNode":1,"value":1)") != std::string::npos);
  CHECK(result.frames.back().nodes[1].state == ControllerState::SafeDisabled);
}
