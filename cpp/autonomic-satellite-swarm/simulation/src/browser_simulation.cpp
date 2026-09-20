#include "satellite_swarm/browser_simulation.hpp"

#include <array>
#include <cstddef>
#include <cstdint>
#include <sstream>
#include <stdexcept>

namespace satellite_swarm::simulation {
namespace {

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
  case SimulationEventType::DelayedMessageDelivered:
    return "delayed-message-delivered";
  case SimulationEventType::LinkChanged:
    return "link-changed";
  case SimulationEventType::NodeReset:
    return "node-reset";
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

SatelliteSnapshot satelliteAt(float longitude, float latitude) {
  SatelliteSnapshot satellite;
  satellite.coordinate = Coordinate(longitude, latitude);
  return satellite;
}

void writeCoordinate(std::ostream& output, const Coordinate& coordinate) {
  output << R"({"longitudeDegrees":)" << coordinate.longitude_degrees << R"(,"latitudeDegrees":)"
         << coordinate.latitude_degrees << '}';
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
  output << R"({"id":)" << static_cast<unsigned int>(node.node_id) << R"(,"state":")"
         << stateName(node.state) << R"(","position":)";
  writeCoordinate(output, node.satellite.coordinate);
  output << R"(,"orbitalRadiusMetres":)" << node.satellite.orbital_radius_metres
         << R"(,"candidacyScore":)" << static_cast<unsigned int>(node.candidacy_score)
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

void writeBrowserFrame(std::ostream& output, const FrameObservation& frame) {
  output << R"(    {"timeMs":)" << frame.now_ms << R"(,"nodes":[)";
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

} // namespace

BrowserSimulation makeBrowserDemonstration(Coordinate objective, BrowserScenario scenario) {
  if (!isValid(objective)) {
    throw std::invalid_argument("mission objective is outside the coordinate bounds");
  }

  BrowserSimulation simulation;
  simulation.scenario = scenario;
  SimulationTrace& trace = simulation.trace;
  trace.controller.response_window_ms = 100U;
  trace.nodes = {
      {0U, satelliteAt(-0.5F, 60.0F)},
      {1U, satelliteAt(0.0F, 10.0F)},
      {2U, satelliteAt(0.5F, 0.0F)},
  };
  if (scenario == BrowserScenario::SafeStateSuccess) {
    trace.nodes[1].safe_state_request_result = SafeStateResult::Accepted;
  }

  for (uint32_t now_ms = 0U; now_ms <= 120U; now_ms += 10U) {
    SimulationFrame frame;
    frame.now_ms = now_ms;
    const auto step_index = now_ms / 10U;
    const auto step = static_cast<float>(step_index);
    frame.satellite_updates = {
        {0U, satelliteAt(-0.5F + step * 0.06F, 60.0F - step * 0.25F)},
        {1U, satelliteAt(0.0F + step * 0.08F, 10.0F - step * 0.4F)},
        {2U, satelliteAt(0.5F + step * 0.1F, 0.0F - step * 0.3F)},
    };
    if (now_ms == 0U) {
      frame.mission_commands.push_back({0U, objective});
    }
    if (scenario == BrowserScenario::LostAssignment && now_ms == 100U) {
      frame.delivery_faults.push_back(
          {0U, 1U, MessageType::MissionAssignment, DeliveryFaultType::Drop, 0U});
    }
    if (scenario == BrowserScenario::SafeStateSuccess && now_ms == 110U) {
      frame.health_updates.push_back({1U, HealthStatus::Fatal});
    }
    if (scenario == BrowserScenario::SafeStateSuccess && now_ms == 120U) {
      frame.safe_state_status_updates.push_back({1U, SafeStateExecutionStatus::Succeeded});
    }
    trace.frames.push_back(frame);
  }
  return simulation;
}

std::string serializeBrowserSimulation(const BrowserSimulation& simulation,
                                       const SimulationResult& result) {
  const SimulationTrace& trace = simulation.trace;
  if (trace.frames.empty() || trace.frames.front().mission_commands.empty()) {
    throw std::invalid_argument("browser simulation requires a mission command");
  }
  constexpr std::array<std::size_t, 4> kBrowserFrameIndices = {0U, 1U, 10U, 12U};
  for (const std::size_t frame_index : kBrowserFrameIndices) {
    if (frame_index >= result.frames.size()) {
      throw std::invalid_argument("browser simulation does not contain the required frames");
    }
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
  "positionModel": "scripted simulation data; not orbit propagation",
  "objective": )";
  writeCoordinate(output, objective);
  output << R"(,
  "frames": [
)";

  for (std::size_t output_index = 0; output_index < kBrowserFrameIndices.size(); ++output_index) {
    writeBrowserFrame(output, result.frames[kBrowserFrameIndices[output_index]]);
    if (output_index + 1U != kBrowserFrameIndices.size()) {
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
