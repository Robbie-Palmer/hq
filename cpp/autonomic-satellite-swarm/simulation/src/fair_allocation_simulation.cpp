#include "satellite_swarm/fair_allocation_simulation.hpp"

#include <array>
#include <cstddef>
#include <cstdint>
#include <sstream>
#include <stdexcept>

namespace satellite_swarm::simulation {
namespace {

SatelliteSnapshot satelliteAt(float longitude, float latitude) {
  SatelliteSnapshot satellite;
  satellite.coordinate = Coordinate(longitude, latitude);
  return satellite;
}

void writeMissionKey(std::ostream& output, const MissionKey& mission_key) {
  output << R"({"originNode":)" << static_cast<unsigned int>(mission_key.origin_node)
         << R"(,"bootEpoch":)" << mission_key.boot_epoch << R"(,"sequence":)"
         << mission_key.sequence << '}';
}

} // namespace

SimulationTrace makeFairAllocationTrace() {
  SimulationTrace trace;
  trace.controller.response_window_ms = 20U;
  const SatelliteSnapshot shared_satellite = satelliteAt(0.0F, 0.0F);
  trace.nodes = {
      {0U, shared_satellite},
      {1U, shared_satellite},
      {2U, shared_satellite},
  };

  constexpr uint32_t kMissionSpacingMs = 40U;
  constexpr uint32_t kMissionCount = 6U;
  for (uint32_t mission_index = 0U; mission_index < kMissionCount; ++mission_index) {
    const uint32_t started_at_ms = mission_index * kMissionSpacingMs;
    SimulationFrame start;
    start.now_ms = started_at_ms;
    start.mission_commands.push_back({0U, shared_satellite.coordinate});
    trace.frames.push_back(start);

    SimulationFrame responses;
    responses.now_ms = started_at_ms + 10U;
    trace.frames.push_back(responses);

    SimulationFrame assignment;
    assignment.now_ms = started_at_ms + trace.controller.response_window_ms;
    trace.frames.push_back(assignment);

    SimulationFrame completion;
    completion.now_ms = started_at_ms + 30U;
    completion.mission_completions.push_back({static_cast<NodeId>(mission_index % 3U)});
    trace.frames.push_back(completion);
  }
  return trace;
}

std::string serializeFairAllocationEvidence(const SimulationResult& result) {
  constexpr std::size_t kExpectedMissions = 6U;
  constexpr std::size_t kExpectedNodes = 3U;
  std::array<uint8_t, kExpectedNodes> assignment_counts{};
  std::array<TelemetryEvent, kExpectedMissions> assignments{};
  std::size_t assignment_count = 0U;

  for (const SimulationEvent& event : result.events) {
    if (event.type != SimulationEventType::ControllerTelemetry || event.node_id != 0U ||
        event.telemetry.type != TelemetryEventType::MissionAssigned ||
        event.telemetry.reason != TelemetryReason::AssignmentBroadcast) {
      continue;
    }
    if (assignment_count >= assignments.size() ||
        static_cast<std::size_t>(event.telemetry.related_node) >= assignment_counts.size() ||
        event.telemetry.value != 100U) {
      throw std::invalid_argument("fair-allocation trace contains invalid assignment telemetry");
    }
    assignments[assignment_count] = event.telemetry;
    ++assignment_counts[event.telemetry.related_node];
    ++assignment_count;
  }
  if (assignment_count != assignments.size()) {
    throw std::invalid_argument("fair-allocation trace has incomplete assignment telemetry");
  }
  for (const uint8_t count : assignment_counts) {
    if (count != kExpectedMissions / kExpectedNodes) {
      throw std::invalid_argument("fair-allocation trace did not distribute assignments evenly");
    }
  }

  std::ostringstream output;
  output << R"({
  "schemaVersion": )"
         << static_cast<unsigned int>(kFairAllocationEvidenceSchemaVersion) << R"(,
  "traceVersion": )"
         << static_cast<unsigned int>(kSimulationTraceVersion) << R"(,
  "policy": "mission-keyed-cyclic-equal-score",
  "missions": [
)";
  for (std::size_t index = 0U; index < assignments.size(); ++index) {
    const TelemetryEvent& telemetry = assignments[index];
    output << R"(    {"missionKey":)";
    writeMissionKey(output, telemetry.mission_key);
    output << R"(,"score":)" << static_cast<unsigned int>(telemetry.value) << R"(,"assignedNode":)"
           << static_cast<unsigned int>(telemetry.related_node) << R"(,"telemetrySequence":)"
           << telemetry.sequence << R"(,"droppedBefore":)" << telemetry.dropped_before << '}';
    if (index + 1U != assignments.size()) {
      output << ',';
    }
    output << '\n';
  }
  output << R"(  ],
  "assignmentCounts": [
)";
  for (std::size_t index = 0U; index < assignment_counts.size(); ++index) {
    output << R"(    {"nodeId":)" << index << R"(,"missions":)"
           << static_cast<unsigned int>(assignment_counts[index]) << '}';
    if (index + 1U != assignment_counts.size()) {
      output << ',';
    }
    output << '\n';
  }
  output << "  ]\n}\n";
  return output.str();
}

std::string runFairAllocationEvidence() {
  const SimulationTrace trace = makeFairAllocationTrace();
  return serializeFairAllocationEvidence(runSimulationTrace(trace));
}

} // namespace satellite_swarm::simulation
