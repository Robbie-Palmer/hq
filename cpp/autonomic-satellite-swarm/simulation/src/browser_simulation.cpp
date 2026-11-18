#include "satellite_swarm/browser_simulation.hpp"

#include <algorithm>
#include <array>
#include <cmath>
#include <cstddef>
#include <cstdint>
#include <optional>
#include <sstream>
#include <stdexcept>
#include <string>
#include <string_view>
#include <utility>

namespace satellite_swarm::simulation {
namespace {

constexpr uint32_t kOrbitSampleIntervalMilliseconds = 60'000U;
constexpr uint32_t kOrbitReplayDurationMilliseconds = 8'040'000U;
constexpr uint32_t kDepartureTimeMilliseconds = 600'000U;
constexpr uint32_t kArrivalTimeMilliseconds = 4'200'000U;
constexpr double kNegotiationPlaybackMultiplier = 0.01;
constexpr double kQuietPlaybackMultiplier = 100.0;

constexpr std::array<std::array<std::string_view, 2>, 3> kScenarioElements = {{
    {{"1 00005U 58002B   00179.78495062  .00000023  00000-0  28098-4 0  4753",
      "2 00005  34.2682 348.7242 1859667 331.7664  19.3264 10.82419157413667"}},
    {{"1 00006U 58002C   00179.78495062  .00000023  00000-0  28098-4 0  4754",
      "2 00006  34.2682 348.7242 1859667 331.7664 139.3264 10.82419157413661"}},
    {{"1 00007U 58002D   00179.78495062  .00000023  00000-0  28098-4 0  4755",
      "2 00007  34.2682 348.7242 1859667 331.7664 259.3264 10.82419157413665"}},
}};

class BrowserScenarioError final : public std::logic_error {
public:
  using std::logic_error::logic_error;
};

struct AssignmentOutcome {
  NodeId selected_node = kBroadcastNode;
  std::optional<uint32_t> authorization_time_ms;
  bool executable = false;
};

Sgp4Orbit makeScenarioOrbit(std::size_t index) {
  return Sgp4Orbit(
      {std::string(kScenarioElements.at(index)[0]), std::string(kScenarioElements.at(index)[1])});
}

const char* stateName(ControllerState state) {
  switch (state) {
  case ControllerState::Idle:
    return "idle";
  case ControllerState::Leading:
    return "leading";
  case ControllerState::AwaitingAcknowledgement:
    return "awaiting acknowledgement";
  case ControllerState::AwaitingAssignment:
    return "awaiting assignment";
  case ControllerState::Active:
    return "active";
  case ControllerState::Quiescent:
    return "quiescent";
  case ControllerState::SafeDisabled:
    return "safe-disabled";
  }
  return "unknown";
}

const char* eventName(SimulationEventType type) {
  switch (type) {
  case SimulationEventType::MissionCommand:
    return "mission-command";
  case SimulationEventType::MissionCompletion:
    return "mission-completion";
  case SimulationEventType::MessageSent:
    return "message-sent";
  case SimulationEventType::MessageDropped:
    return "message-dropped";
  case SimulationEventType::MessageDelayed:
    return "message-delayed";
  case SimulationEventType::MessageDuplicated:
    return "message-duplicated";
  case SimulationEventType::MessageDelivered:
    return "message-delivered";
  case SimulationEventType::DeliveryDecision:
    return "delivery-decision";
  case SimulationEventType::PacketQueued:
    return "packet-queued";
  case SimulationEventType::TransmissionStarted:
    return "transmission-started";
  case SimulationEventType::TransmissionCompleted:
    return "transmission-completed";
  case SimulationEventType::PacketForwarded:
    return "packet-forwarded";
  case SimulationEventType::DelayedMessageDelivered:
    return "delayed-message-delivered";
  case SimulationEventType::LinkChanged:
    return "link-changed";
  case SimulationEventType::ContactObserved:
    return "contact-observed";
  case SimulationEventType::StoragePressureChanged:
    return "storage-pressure-changed";
  case SimulationEventType::NodeCrashed:
    return "node-crashed";
  case SimulationEventType::NodeReset:
    return "node-reset";
  case SimulationEventType::ResourceSample:
    return "resource-sample";
  case SimulationEventType::StateChanged:
    return "state-changed";
  case SimulationEventType::ControllerTelemetry:
    return "controller-telemetry";
  }
  return "unknown";
}

const char* telemetryEventName(TelemetryEventType type) {
  switch (type) {
  case TelemetryEventType::StateTransition:
    return "state-transition";
  case TelemetryEventType::MissionProposed:
    return "mission-proposed";
  case TelemetryEventType::CandidacySent:
    return "candidacy-sent";
  case TelemetryEventType::CandidacyAccepted:
    return "candidacy-accepted";
  case TelemetryEventType::MissionAssigned:
    return "mission-assigned";
  case TelemetryEventType::MissionCompleted:
    return "mission-completed";
  case TelemetryEventType::MissionFailed:
    return "mission-failed";
  case TelemetryEventType::HealthChanged:
    return "health-changed";
  case TelemetryEventType::TransportFailure:
    return "transport-failure";
  case TelemetryEventType::SafeStateRequested:
    return "safe-state-requested";
  case TelemetryEventType::SafeStateResult:
    return "safe-state-result";
  case TelemetryEventType::SafeStateExecutionResult:
    return "safe-state-execution-result";
  }
  return "unknown";
}

const char* telemetryReasonName(TelemetryReason reason) {
  switch (reason) {
  case TelemetryReason::None:
    return "none";
  case TelemetryReason::MissionInitiated:
    return "mission-initiated";
  case TelemetryReason::MissionRequestAccepted:
    return "mission-request-accepted";
  case TelemetryReason::AcknowledgementReceived:
    return "acknowledgement-received";
  case TelemetryReason::AssignmentReceived:
    return "assignment-received";
  case TelemetryReason::AssignmentBroadcast:
    return "assignment-broadcast";
  case TelemetryReason::AssignmentWindowExpired:
    return "assignment-window-expired";
  case TelemetryReason::RetryLimitReached:
    return "retry-limit-reached";
  case TelemetryReason::MissionCompleted:
    return "mission-completed";
  case TelemetryReason::HealthQuiescent:
    return "health-quiescent";
  case TelemetryReason::HealthRecovered:
    return "health-recovered";
  case TelemetryReason::HealthFatal:
    return "health-fatal";
  case TelemetryReason::SendFailed:
    return "send-failed";
  case TelemetryReason::InvalidConfiguration:
    return "invalid-configuration";
  }
  return "unknown";
}

const char* telemetryPriorityName(TelemetryPriority priority) {
  switch (priority) {
  case TelemetryPriority::Routine:
    return "routine";
  case TelemetryPriority::Operational:
    return "operational";
  case TelemetryPriority::Critical:
    return "critical";
  }
  return "unknown";
}

const char* messageName(MessageType type) {
  switch (type) {
  case MessageType::MissionRequest:
    return "mission-request";
  case MessageType::Candidacy:
    return "candidacy";
  case MessageType::Acknowledgement:
    return "acknowledgement";
  case MessageType::MissionAssignment:
    return "mission-assignment";
  }
  return "unknown";
}

const char* scenarioName(BrowserScenario scenario) {
  switch (scenario) {
  case BrowserScenario::Nominal:
    return "three-node-objective-pass";
  case BrowserScenario::LostAssignment:
    return "three-node-assignment-loss";
  case BrowserScenario::SafeStateSuccess:
    return "three-node-safe-state-success";
  }
  return "unknown";
}

const char* trajectoryRoleName(TrajectoryRole role) {
  switch (role) {
  case TrajectoryRole::CurrentCoast:
    return "current-orbit";
  case TrajectoryRole::Transfer:
    return "transfer-trajectory";
  case TrajectoryRole::TargetOrbit:
    return "target-orbit";
  }
  return "unknown";
}

const char* maneuverEventRoleName(ManeuverEventRole role) {
  switch (role) {
  case ManeuverEventRole::DepartureBurn:
    return "departure-burn";
  case ManeuverEventRole::ArrivalBurn:
    return "arrival-burn";
  }
  return "unknown";
}

void writeCartesianMetres(std::ostream& output, const CartesianVector& vector) {
  output << R"({"x":)" << std::llround(vector.x) << R"(,"y":)" << std::llround(vector.y)
         << R"(,"z":)" << std::llround(vector.z) << '}';
}

void writeCartesianMillimetresPerSecond(std::ostream& output, const CartesianVector& vector) {
  output << R"({"x":)" << std::llround(vector.x * 1'000.0) << R"(,"y":)"
         << std::llround(vector.y * 1'000.0) << R"(,"z":)" << std::llround(vector.z * 1'000.0)
         << '}';
}

void writeTrajectory(std::ostream& output, const std::vector<TrajectorySample>& samples,
                     TrajectoryRole role) {
  output
      << R"({"role":")" << trajectoryRoleName(role)
      << R"(","frame":"GCRF","epochScale":"UTC","positionUnit":"metre","velocityUnit":"millimetre-per-second","samples":[)";
  for (std::size_t index = 0U; index < samples.size(); ++index) {
    const TrajectorySample& sample = samples[index];
    if (sample.role != role || sample.state.frame != OrbitalCoordinateFrame::Gcrf) {
      throw std::invalid_argument("maneuver trajectory contains an invalid role or frame");
    }
    output << R"({"epochUnixMilliseconds":)" << sample.state.epoch_unix_milliseconds
           << R"(,"positionMetres":)";
    writeCartesianMetres(output, sample.state.position_metres);
    output << R"(,"velocityMillimetresPerSecond":)";
    writeCartesianMillimetresPerSecond(output, sample.state.velocity_metres_per_second);
    output << '}';
    if (index + 1U != samples.size()) {
      output << ',';
    }
  }
  output << "]}";
}

void writeManeuverEvent(std::ostream& output, const ManeuverEvent& event) {
  if (event.frame != OrbitalCoordinateFrame::Gcrf) {
    throw std::invalid_argument("maneuver event is not in GCRF");
  }
  output << R"({"role":")" << maneuverEventRoleName(event.role)
         << R"(","frame":"GCRF","epochScale":"UTC","epochUnixMilliseconds":)"
         << event.epoch_unix_milliseconds << R"(,"positionUnit":"metre","positionMetres":)";
  writeCartesianMetres(output, event.position_metres);
  output << R"(,"deltaVelocityUnit":"millimetre-per-second","deltaVelocityMillimetresPerSecond":)";
  writeCartesianMillimetresPerSecond(output, event.delta_velocity_metres_per_second);
  output << '}';
}

std::vector<TrajectorySample> currentCoast(const Sgp4Orbit& orbit,
                                           const ManeuverScenario& scenario) {
  std::vector<TrajectorySample> samples;
  int64_t epoch = orbit.epochUnixMilliseconds();
  while (true) {
    samples.push_back({TrajectoryRole::CurrentCoast,
                       temeToGcrf(orbit.propagate(epoch).teme, scenario.earth_orientation)});
    if (epoch == scenario.departure_epoch_unix_milliseconds) {
      break;
    }
    const int64_t remaining = scenario.departure_epoch_unix_milliseconds - epoch;
    epoch +=
        std::min<int64_t>(remaining, static_cast<int64_t>(scenario.sample_interval_milliseconds));
  }
  return samples;
}

AssignmentOutcome assignmentOutcome(const SimulationResult& result) {
  AssignmentOutcome outcome;
  MissionKey assigned_mission;
  for (const SimulationEvent& event : result.events) {
    if (event.type == SimulationEventType::ControllerTelemetry &&
        event.telemetry.type == TelemetryEventType::MissionAssigned &&
        event.telemetry.reason == TelemetryReason::AssignmentBroadcast) {
      outcome.selected_node = event.telemetry.related_node;
      assigned_mission = event.telemetry.mission_key;
      if (event.node_id == outcome.selected_node) {
        outcome.authorization_time_ms = event.now_ms;
      }
      break;
    }
  }
  if (outcome.selected_node == kBroadcastNode || !isValid(assigned_mission)) {
    throw std::invalid_argument("browser simulation has no recorded assignment decision");
  }
  for (const SimulationEvent& event : result.events) {
    if (outcome.authorization_time_ms.has_value()) {
      break;
    }
    if (event.type == SimulationEventType::ControllerTelemetry &&
        event.node_id == outcome.selected_node &&
        event.telemetry.type == TelemetryEventType::MissionAssigned &&
        event.telemetry.reason == TelemetryReason::AssignmentReceived &&
        event.telemetry.mission_key == assigned_mission &&
        event.telemetry.related_node == outcome.selected_node) {
      outcome.authorization_time_ms = event.now_ms;
      break;
    }
  }
  const auto selected_index = static_cast<std::size_t>(outcome.selected_node);
  const auto departure_frame =
      std::find_if(result.frames.begin(), result.frames.end(), [](const FrameObservation& frame) {
        return frame.now_ms == kDepartureTimeMilliseconds;
      });
  if (outcome.authorization_time_ms.has_value() &&
      *outcome.authorization_time_ms <= kDepartureTimeMilliseconds &&
      departure_frame != result.frames.end() && selected_index < departure_frame->nodes.size()) {
    const NodeObservation& node = departure_frame->nodes[selected_index];
    outcome.executable = node.running && node.state == ControllerState::Active &&
                         node.mission_key == assigned_mission;
  }
  return outcome;
}

void writeMissionOrbit(std::ostream& output, const BrowserSimulation& simulation,
                       const SimulationResult& result) {
  const AssignmentOutcome assignment = assignmentOutcome(result);
  const Sgp4Orbit orbit = makeScenarioOrbit(static_cast<std::size_t>(assignment.selected_node));
  const std::vector<TrajectorySample> coast = currentCoast(orbit, simulation.maneuver_scenario);
  std::optional<ManeuverPlan> plan;
  if (assignment.executable) {
    const Coordinate objective = simulation.trace.frames.front().mission_commands.front().objective;
    plan = planManeuver(orbit, objective, simulation.maneuver_scenario);
  }

  output << R"(  "missionOrbit": {
    "status": ")";
  if (plan.has_value()) {
    output << "executed";
  } else if (!assignment.authorization_time_ms.has_value()) {
    output << "assignment-not-received";
  } else {
    output << "node-unavailable-before-burn";
  }
  output << R"(",
    "selectedNodeId": )"
         << static_cast<unsigned int>(assignment.selected_node) << R"(,
    "authorizationEpochUnixMilliseconds": )";
  if (assignment.authorization_time_ms.has_value()) {
    output << simulation.scenario_epoch_unix_milliseconds +
                  static_cast<int64_t>(*assignment.authorization_time_ms);
  } else {
    output << "null";
  }
  output << R"(,
    "quantization": {"positionMetres":1,"velocityMillimetresPerSecond":1},
    "current": )";
  writeTrajectory(output, coast, TrajectoryRole::CurrentCoast);
  output << R"(,
    "maneuvers": [)";
  if (plan.has_value()) {
    for (std::size_t index = 0U; index < plan->events.size(); ++index) {
      writeManeuverEvent(output, plan->events[index]);
      if (index + 1U != plan->events.size()) {
        output << ',';
      }
    }
  }
  output << R"(],
    "transfer": )";
  if (plan.has_value()) {
    writeTrajectory(output, plan->transfer, TrajectoryRole::Transfer);
  } else {
    output << "null";
  }
  output << R"(,
    "target": )";
  if (plan.has_value()) {
    writeTrajectory(output, plan->target_orbit, TrajectoryRole::TargetOrbit);
  } else {
    output << "null";
  }
  output << "\n  },\n";
}

void writeCoordinate(std::ostream& output, const Coordinate& coordinate) {
  output << R"({"longitudeDegrees":)" << coordinate.longitude_degrees << R"(,"latitudeDegrees":)"
         << coordinate.latitude_degrees << '}';
}

void writeCanonicalDouble(std::ostream& output, double value) {
  std::ostringstream formatted;
  formatted << value;
  std::string text = formatted.str();
  const std::size_t exponent = text.find_first_of("eE");
  if (exponent != std::string::npos) {
    std::size_t last_digit = exponent;
    while (last_digit > 0U && text[last_digit - 1U] == '0') {
      --last_digit;
    }
    if (last_digit > 0U && text[last_digit - 1U] == '.') {
      --last_digit;
    }
    text.erase(last_digit, exponent - last_digit);
  }
  output << text;
}

void writeMissionKey(std::ostream& output, const MissionKey& mission_key) {
  if (!isValid(mission_key)) {
    output << "null";
    return;
  }
  output << R"({"originNode":)" << static_cast<unsigned int>(mission_key.origin_node)
         << R"(,"bootEpoch":)" << mission_key.boot_epoch << R"(,"sequence":)"
         << mission_key.sequence << '}';
}

void writeBrowserNode(std::ostream& output, const NodeObservation& node) {
  if (!node.orbit.has_value()) {
    throw std::invalid_argument("browser simulation node lacks an orbit result");
  }
  const OrbitalStateVector& earth_fixed = node.orbit->earth_fixed;
  output << R"({"id":)" << static_cast<unsigned int>(node.node_id) << R"(,"state":")"
         << stateName(node.state) << R"(","position":)";
  writeCoordinate(output, node.satellite.coordinate);
  output << R"(,"orbitalRadiusMetres":)";
  writeCanonicalDouble(output, node.satellite.orbital_radius_metres);
  output << R"(,"epochUnixMilliseconds":)" << earth_fixed.epoch_unix_milliseconds
         << R"(,"earthFixedPositionMetres":)";
  writeCartesianMetres(output, earth_fixed.position_metres);
  output << R"(,"earthFixedVelocityMillimetresPerSecond":)";
  writeCartesianMillimetresPerSecond(output, earth_fixed.velocity_metres_per_second);
  output << R"(,"candidacyScore":)" << static_cast<unsigned int>(node.candidacy_score)
         << R"(,"telemetryDrops":)" << node.telemetry_drops << R"(,"bootEpoch":)" << node.boot_epoch
         << R"(,"missionKey":)";
  writeMissionKey(output, node.mission_key);
  output << R"(,"assignedNode":)";
  if (node.assigned_node == kBroadcastNode) {
    output << "null";
  } else {
    output << static_cast<unsigned int>(node.assigned_node);
  }
  output << '}';
}

void writeBrowserFrame(std::ostream& output, const FrameObservation& frame,
                       double playback_multiplier) {
  output << R"(    {"timeMs":)" << frame.now_ms << R"(,"playbackMultiplier":)"
         << playback_multiplier << R"(,"nodes":[)";
  for (std::size_t node_index = 0; node_index < frame.nodes.size(); ++node_index) {
    writeBrowserNode(output, frame.nodes[node_index]);
    if (node_index + 1U != frame.nodes.size()) {
      output << ',';
    }
  }
  output << "]}";
}

void writeMessage(std::ostream& output, const Message& message) {
  output << R"({"type":")" << messageName(message.type) << R"(","sender":)"
         << static_cast<unsigned int>(message.sender) << R"(,"target":)";
  if (message.target == kBroadcastNode) {
    output << "null";
  } else {
    output << static_cast<unsigned int>(message.target);
  }
  output << R"(,"missionKey":)";
  writeMissionKey(output, message.mission_key);
  output << R"(,"score":)" << static_cast<unsigned int>(message.score) << '}';
}

void writeBrowserEvent(std::ostream& output, const SimulationEvent& event) {
  output << R"(    {"type":")" << eventName(event.type) << R"(","timeMs":)" << event.now_ms
         << R"(,"nodeId":)" << static_cast<unsigned int>(event.node_id);
  if (event.type == SimulationEventType::MissionCommand) {
    output << R"(,"accepted":)" << (event.accepted ? "true" : "false") << R"(,"objective":)";
    writeCoordinate(output, event.objective);
  } else if (event.type == SimulationEventType::MissionCompletion) {
    output << R"(,"accepted":)" << (event.accepted ? "true" : "false");
  } else if (event.type == SimulationEventType::MessageSent) {
    output << R"(,"message":)";
    writeMessage(output, event.message);
  } else if (event.type == SimulationEventType::MessageDropped ||
             event.type == SimulationEventType::MessageDelayed ||
             event.type == SimulationEventType::MessageDuplicated ||
             event.type == SimulationEventType::DelayedMessageDelivered) {
    output << R"(,"recipientNode":)" << static_cast<unsigned int>(event.recipient_node);
    if (event.type == SimulationEventType::MessageDropped) {
      output << R"(,"reason":")"
             << (event.drop_reason == MessageDropReason::LinkUnavailable ? "link-unavailable"
                                                                         : "scripted-drop")
             << '"';
    } else if (event.type == SimulationEventType::MessageDelayed) {
      output << R"(,"deliverAtMs":)" << event.deliver_at_ms;
    }
    output << R"(,"message":)";
    writeMessage(output, event.message);
  } else if (event.type == SimulationEventType::LinkChanged) {
    output << R"(,"recipientNode":)" << static_cast<unsigned int>(event.recipient_node)
           << R"(,"connected":)" << (event.connected ? "true" : "false");
  } else if (event.type == SimulationEventType::ControllerTelemetry) {
    const TelemetryEvent& telemetry = event.telemetry;
    output << R"(,"bootEpoch":)" << telemetry.boot_epoch << R"(,"sequence":)" << telemetry.sequence
           << R"(,"droppedBefore":)" << telemetry.dropped_before << R"(,"event":")"
           << telemetryEventName(telemetry.type) << R"(","reason":")"
           << telemetryReasonName(telemetry.reason) << R"(","priority":")"
           << telemetryPriorityName(telemetry.priority) << R"(","missionKey":)";
    writeMissionKey(output, telemetry.mission_key);
    output << R"(,"relatedNode":)";
    if (telemetry.related_node == kBroadcastNode) {
      output << "null";
    } else {
      output << static_cast<unsigned int>(telemetry.related_node);
    }
    output << R"(,"value":)" << static_cast<unsigned int>(telemetry.value)
           << R"(,"previousState":")" << stateName(telemetry.previous_state)
           << R"(","currentState":")" << stateName(telemetry.current_state) << '"';
  } else {
    output << R"(,"previousState":")" << stateName(event.previous_state) << R"(","currentState":")"
           << stateName(event.current_state) << '"';
  }
  output << '}';
}

void appendOrbitFrame(SimulationTrace& trace, const std::array<Sgp4Orbit, 3>& orbits,
                      int64_t scenario_epoch_unix_milliseconds, Coordinate objective,
                      BrowserScenario scenario, uint32_t now_ms) {
  SimulationFrame frame;
  frame.now_ms = now_ms;
  for (std::size_t index = 0U; index < orbits.size(); ++index) {
    frame.orbit_updates.emplace_back(
        static_cast<NodeId>(index),
        orbits[index].propagate(scenario_epoch_unix_milliseconds + now_ms));
  }
  if (now_ms == 0U) {
    frame.mission_commands.emplace_back(MissionCommand{0U, objective});
  }
  if (scenario == BrowserScenario::SafeStateSuccess && now_ms == 110U) {
    frame.health_updates.emplace_back(HealthUpdate{1U, HealthStatus::Fatal});
  }
  if (scenario == BrowserScenario::SafeStateSuccess && now_ms == 120U) {
    frame.safe_state_status_updates.emplace_back(
        SafeStateStatusUpdate{1U, SafeStateExecutionStatus::Succeeded});
  }
  trace.frames.emplace_back(std::move(frame));
}

void configureAssignmentLoss(SimulationTrace& trace) {
  constexpr std::size_t kAssignmentFrameIndex = 10U;
  for (std::size_t leader_index = 0U; leader_index < trace.nodes.size(); ++leader_index) {
    const auto leader = static_cast<NodeId>(leader_index);
    trace.frames.front().mission_commands.front().leader = leader;
    const auto trial = runSimulationTrace(trace);
    const NodeId assignee =
        trial.frames.at(kAssignmentFrameIndex).nodes.at(leader_index).assigned_node;
    if (assignee != leader && static_cast<std::size_t>(assignee) < trace.nodes.size()) {
      trace.frames.at(kAssignmentFrameIndex)
          .delivery_faults.emplace_back(DeliveryFault{
              leader, assignee, MessageType::MissionAssignment, DeliveryFaultType::Drop, 0U});
      return;
    }
  }
  throw BrowserScenarioError("browser assignment-loss scenario has no remote winner");
}

} // namespace

BrowserSimulation makeBrowserDemonstration(Coordinate objective, BrowserScenario scenario) {
  if (!isValid(objective)) {
    throw std::invalid_argument("mission objective is outside the coordinate bounds");
  }

  BrowserSimulation simulation;
  simulation.scenario = scenario;
  SimulationTrace& trace = simulation.trace;
  trace.controller.response_window_ms = 100U;
  std::array<Sgp4Orbit, 3> orbits = {makeScenarioOrbit(0U), makeScenarioOrbit(1U),
                                     makeScenarioOrbit(2U)};
  simulation.scenario_epoch_unix_milliseconds = orbits.front().epochUnixMilliseconds();
  simulation.maneuver_scenario.departure_epoch_unix_milliseconds =
      simulation.scenario_epoch_unix_milliseconds + kDepartureTimeMilliseconds;
  simulation.maneuver_scenario.arrival_epoch_unix_milliseconds =
      simulation.scenario_epoch_unix_milliseconds + kArrivalTimeMilliseconds;
  simulation.maneuver_scenario.end_epoch_unix_milliseconds =
      simulation.scenario_epoch_unix_milliseconds + kOrbitReplayDurationMilliseconds;
  for (std::size_t index = 0U; index < orbits.size(); ++index) {
    if (orbits[index].epochUnixMilliseconds() != simulation.scenario_epoch_unix_milliseconds) {
      throw std::invalid_argument("browser scenario TLE epochs do not match");
    }
    trace.nodes.emplace_back(static_cast<NodeId>(index),
                             satelliteSnapshotFrom(orbits[index].propagate(
                                 simulation.scenario_epoch_unix_milliseconds)));
  }
  if (scenario == BrowserScenario::SafeStateSuccess) {
    trace.nodes[1].safe_state_request_result = SafeStateResult::Accepted;
  }

  for (uint32_t now_ms = 0U; now_ms <= 120U; now_ms += 10U) {
    appendOrbitFrame(trace, orbits, simulation.scenario_epoch_unix_milliseconds, objective,
                     scenario, now_ms);
  }
  for (uint32_t now_ms = kOrbitSampleIntervalMilliseconds;
       now_ms <= kOrbitReplayDurationMilliseconds; now_ms += kOrbitSampleIntervalMilliseconds) {
    appendOrbitFrame(trace, orbits, simulation.scenario_epoch_unix_milliseconds, objective,
                     scenario, now_ms);
  }

  if (scenario == BrowserScenario::LostAssignment) {
    configureAssignmentLoss(trace);
  }
  return simulation;
}

std::string serializeBrowserSimulation(const BrowserSimulation& simulation,
                                       const SimulationResult& result) {
  const SimulationTrace& trace = simulation.trace;
  if (trace.frames.empty() || trace.frames.front().mission_commands.empty()) {
    throw std::invalid_argument("browser simulation requires a mission command");
  }
  if (result.frames.size() != trace.frames.size() || result.frames.back().now_ms < 7'980'000U) {
    throw std::invalid_argument("browser simulation does not cover one complete reference orbit");
  }

  const Coordinate objective = trace.frames.front().mission_commands.front().objective;
  std::ostringstream output;
  output << R"({
  "schemaVersion": )"
         << static_cast<unsigned int>(kBrowserSimulationSchemaVersion) << R"(,
  "traceVersion": )"
         << static_cast<unsigned int>(trace.version) << R"(,
  "scenario": ")"
         << scenarioName(simulation.scenario) << R"(",
  "source": "portable C++ SimulationTrace",
  "positionModel": "SGP4 pre-burn coast, deterministic impulsive transfer, and two-body target orbit",
  "propagationFrame": "TEME",
  "renderingFrame": "GCRF inertial trajectories from pinned UTC, TAI, TT, UT1, and Earth-orientation inputs",
  "scenarioEpochUnixMilliseconds": )"
         << simulation.scenario_epoch_unix_milliseconds << R"(,
  "objective": )";
  writeCoordinate(output, objective);
  output << ",\n";
  writeMissionOrbit(output, simulation, result);
  output << R"(  "frames": [
)";

  for (std::size_t output_index = 0; output_index < result.frames.size(); ++output_index) {
    const FrameObservation& frame = result.frames[output_index];
    const double playback_multiplier =
        frame.now_ms < 120U ? kNegotiationPlaybackMultiplier : kQuietPlaybackMultiplier;
    writeBrowserFrame(output, frame, playback_multiplier);
    if (output_index + 1U != result.frames.size()) {
      output << ',';
    }
    output << '\n';
  }

  output << R"(  ],
  "events": [
)";
  for (std::size_t event_index = 0; event_index < result.events.size(); ++event_index) {
    writeBrowserEvent(output, result.events[event_index]);
    if (event_index + 1U != result.events.size()) {
      output << ',';
    }
    output << '\n';
  }
  output << "  ]\n}\n";
  return output.str();
}

std::string runBrowserDemonstration(Coordinate objective, BrowserScenario scenario) {
  const BrowserSimulation simulation = makeBrowserDemonstration(objective, scenario);
  return serializeBrowserSimulation(simulation, runSimulationTrace(simulation.trace));
}

} // namespace satellite_swarm::simulation
