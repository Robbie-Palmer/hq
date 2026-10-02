#include "satellite_swarm/simulation.hpp"

#include <catch2/catch_test_macros.hpp>
#include <cstddef>
#include <cstdint>
#include <vector>

using namespace satellite_swarm;
using namespace satellite_swarm::simulation;

namespace {

SatelliteSnapshot satelliteAt(float longitude, float latitude) {
  SatelliteSnapshot satellite;
  satellite.coordinate = Coordinate(longitude, latitude);
  return satellite;
}

SimulationTrace missionTrace(uint32_t final_time_ms = 120U) {
  SimulationTrace trace;
  trace.controller.response_window_ms = 100U;
  trace.nodes = {
      {0U, satelliteAt(3.0F, 90.0F), 11U},
      {1U, satelliteAt(0.0F, 90.0F), 21U},
      {2U, satelliteAt(1.0F, 90.0F), 31U},
  };
  for (uint32_t now_ms = 0U; now_ms <= final_time_ms; now_ms += 10U) {
    SimulationFrame frame;
    frame.now_ms = now_ms;
    if (now_ms == 0U) {
      frame.mission_commands.push_back({0U, Coordinate(0.0F, -90.0F)});
    }
    trace.frames.push_back(frame);
  }
  return trace;
}

bool activeNodesHoldCurrentEpochAssignments(const SimulationResult& result) {
  for (const FrameObservation& frame : result.frames) {
    for (const NodeObservation& node : frame.nodes) {
      if (node.state != ControllerState::Active) {
        continue;
      }
      const auto origin_index = static_cast<std::size_t>(node.mission_key.origin_node);
      if (!isValid(node.mission_key) || node.assigned_node != node.node_id ||
          origin_index >= frame.nodes.size() ||
          frame.nodes[origin_index].boot_epoch != node.mission_key.boot_epoch) {
        return false;
      }
    }
  }
  return true;
}

bool atMostOneActiveNodePerMission(const SimulationResult& result) {
  for (const FrameObservation& frame : result.frames) {
    for (std::size_t left = 0U; left < frame.nodes.size(); ++left) {
      if (frame.nodes[left].state != ControllerState::Active) {
        continue;
      }
      for (std::size_t right = left + 1U; right < frame.nodes.size(); ++right) {
        if (frame.nodes[right].state == ControllerState::Active &&
            frame.nodes[left].mission_key == frame.nodes[right].mission_key) {
          return false;
        }
      }
    }
  }
  return true;
}

std::size_t countTransitions(const SimulationResult& result, NodeId node_id,
                             ControllerState state) {
  std::size_t count = 0U;
  for (const SimulationEvent& event : result.events) {
    if (event.type == SimulationEventType::StateChanged && event.node_id == node_id &&
        event.current_state == state) {
      ++count;
    }
  }
  return count;
}

std::size_t countEvents(const SimulationResult& result, SimulationEventType type) {
  std::size_t count = 0U;
  for (const SimulationEvent& event : result.events) {
    if (event.type == type) {
      ++count;
    }
  }
  return count;
}

} // namespace

TEST_CASE("lost acknowledgement does not masquerade as assignment knowledge",
          "[invariant][safety]") {
  SimulationTrace trace = missionTrace();
  trace.frames[1].delivery_faults.push_back(
      {0U, 1U, MessageType::Acknowledgement, DeliveryFaultType::Drop, 0U});

  const SimulationResult result = runSimulationTrace(trace);
  const MissionKey key(0U, 11U, 1U);

  CHECK(result.frames[1].nodes[0].state == ControllerState::Leading);
  CHECK(result.frames[1].nodes[1].state == ControllerState::AwaitingAcknowledgement);
  CHECK(result.frames[1].nodes[1].mission_key == key);
  CHECK(result.frames[10].nodes[1].state == ControllerState::Active);
  CHECK(result.frames[10].nodes[1].assigned_node == 1U);
  CHECK(activeNodesHoldCurrentEpochAssignments(result));
  CHECK(atMostOneActiveNodePerMission(result));
}

TEST_CASE("lost assignment leaves the leader and candidate with different truthful claims",
          "[invariant][liveness]") {
  SimulationTrace trace = missionTrace();
  trace.frames[10].delivery_faults.push_back(
      {0U, 1U, MessageType::MissionAssignment, DeliveryFaultType::Drop, 0U});

  const SimulationResult result = runSimulationTrace(trace);
  const FrameObservation& assignment_frame = result.frames[10];
  const FrameObservation& final_frame = result.frames.back();

  CHECK(assignment_frame.nodes[0].assigned_node == 1U);
  CHECK(assignment_frame.nodes[1].state == ControllerState::AwaitingAssignment);
  CHECK(assignment_frame.nodes[1].assigned_node == kBroadcastNode);
  CHECK(final_frame.nodes[1].state == ControllerState::Idle);
  CHECK(final_frame.nodes[1].assigned_node == kBroadcastNode);
  CHECK(activeNodesHoldCurrentEpochAssignments(result));
  CHECK(atMostOneActiveNodePerMission(result));
}

TEST_CASE("duplicated assignment does not repeat the accepted state transition",
          "[invariant][safety]") {
  SimulationTrace trace = missionTrace();
  trace.frames[10].delivery_faults.push_back(
      {0U, 1U, MessageType::MissionAssignment, DeliveryFaultType::Duplicate, 0U});

  const SimulationResult result = runSimulationTrace(trace);

  CHECK(result.frames[10].nodes[1].state == ControllerState::Active);
  CHECK(countTransitions(result, 1U, ControllerState::Active) == 1U);
  CHECK(activeNodesHoldCurrentEpochAssignments(result));
  CHECK(atMostOneActiveNodePerMission(result));
}

TEST_CASE("safe-disabled node never becomes active before reset", "[invariant][safety]") {
  SimulationTrace trace = missionTrace();
  trace.frames[5].health_updates.push_back({1U, HealthStatus::Fatal});
  trace.frames[10].delivery_faults.push_back(
      {0U, 1U, MessageType::MissionAssignment, DeliveryFaultType::Duplicate, 0U});

  const SimulationResult result = runSimulationTrace(trace);

  REQUIRE(result.frames[5].nodes[1].state == ControllerState::SafeDisabled);
  for (std::size_t frame = 5U; frame < result.frames.size(); ++frame) {
    CHECK(result.frames[frame].nodes[1].state == ControllerState::SafeDisabled);
  }
  CHECK(countTransitions(result, 1U, ControllerState::Active) == 0U);
}

TEST_CASE("one-way assignment loss cannot be inferred from a working reverse link",
          "[invariant][liveness]") {
  SimulationTrace trace = missionTrace();
  trace.frames[10].link_updates.push_back({0U, 1U, false});

  const SimulationResult result = runSimulationTrace(trace);

  CHECK(result.frames[1].nodes[1].state == ControllerState::AwaitingAssignment);
  CHECK(result.frames[10].nodes[0].assigned_node == 1U);
  CHECK(result.frames[10].nodes[1].state == ControllerState::AwaitingAssignment);
  CHECK(result.frames.back().nodes[1].state == ControllerState::Idle);
  CHECK(activeNodesHoldCurrentEpochAssignments(result));
  CHECK(atMostOneActiveNodePerMission(result));
}

TEST_CASE("node reset advances the boot epoch and prevents mission-key reuse",
          "[invariant][safety]") {
  SimulationTrace trace;
  trace.controller.response_window_ms = 10U;
  trace.nodes = {{0U, satelliteAt(0.0F, 0.0F), 41U}};
  SimulationFrame first_mission;
  first_mission.now_ms = 0U;
  first_mission.mission_commands.push_back({0U, Coordinate()});
  trace.frames.push_back(first_mission);
  SimulationFrame assignment;
  assignment.now_ms = 10U;
  trace.frames.push_back(assignment);
  SimulationFrame reset_and_second_mission;
  reset_and_second_mission.now_ms = 20U;
  reset_and_second_mission.node_resets.push_back({0U});
  reset_and_second_mission.mission_commands.push_back({0U, Coordinate(1.0F, 1.0F)});
  trace.frames.push_back(reset_and_second_mission);

  const SimulationResult result = runSimulationTrace(trace);
  const MissionKey before_reset = result.frames[0].nodes[0].mission_key;
  const MissionKey after_reset = result.frames[2].nodes[0].mission_key;

  CHECK(before_reset == MissionKey(0U, 41U, 1U));
  CHECK(after_reset == MissionKey(0U, 42U, 1U));
  CHECK(before_reset != after_reset);
}

TEST_CASE("different origin nodes cannot alias the same epoch and sequence",
          "[invariant][safety]") {
  SimulationTrace trace;
  trace.controller.response_window_ms = 100U;
  trace.nodes = {
      {0U, satelliteAt(0.0F, 0.0F), 7U},
      {1U, satelliteAt(0.0F, 0.0F), 7U},
  };
  SimulationFrame frame;
  frame.now_ms = 0U;
  frame.mission_commands = {
      {0U, Coordinate(5.0F, 5.0F)},
      {1U, Coordinate(5.0F, 5.0F)},
  };
  trace.frames.push_back(frame);

  const SimulationResult result = runSimulationTrace(trace);
  const MissionKey left = result.frames[0].nodes[0].mission_key;
  const MissionKey right = result.frames[0].nodes[1].mission_key;

  CHECK(left == MissionKey(0U, 7U, 1U));
  CHECK(right == MissionKey(1U, 7U, 1U));
  CHECK(left != right);
}

TEST_CASE("expected baseline failure: safe-disabled survives reset until explicit recovery",
          "[invariant][safety][baseline][!mayfail]") {
  SimulationTrace trace = missionTrace(10U);
  trace.frames[0].mission_commands.clear();
  trace.frames[0].health_updates.push_back({1U, HealthStatus::Fatal});
  trace.frames[1].health_updates.push_back({1U, HealthStatus::Nominal});
  trace.frames[1].node_resets.push_back({1U});
  const BootEpoch initial_boot_epoch = trace.nodes[1].boot_epoch;

  const SimulationResult result = runSimulationTrace(trace);
  REQUIRE(result.frames[0].nodes[1].state == ControllerState::SafeDisabled);
  CHECK(result.frames[1].nodes[1].state == ControllerState::SafeDisabled);
  CHECK(result.frames[1].nodes[1].boot_epoch == initial_boot_epoch + 1U);
}

TEST_CASE("expected baseline failure: an expired mission request cannot start work",
          "[invariant][safety][baseline][!mayfail]") {
  SimulationTrace trace;
  trace.controller.response_window_ms = 100U;
  trace.nodes = {
      {0U, satelliteAt(3.0F, 90.0F), 11U},
      {1U, satelliteAt(0.0F, 90.0F), 21U},
  };
  for (uint32_t now_ms = 0U; now_ms <= 150U; now_ms += 50U) {
    SimulationFrame frame;
    frame.now_ms = now_ms;
    if (now_ms == 0U) {
      frame.mission_commands.push_back({0U, Coordinate(0.0F, -90.0F)});
      frame.delivery_faults.push_back(
          {0U, 1U, MessageType::MissionRequest, DeliveryFaultType::Delay, 150U});
    }
    trace.frames.push_back(frame);
  }

  const SimulationResult result = runSimulationTrace(trace);
  CHECK(result.frames.back().nodes[1].state == ControllerState::Idle);
}

TEST_CASE("link loss does not block local fatal-health handling", "[invariant][liveness]") {
  SimulationTrace trace = missionTrace(0U);
  trace.frames[0].mission_commands.clear();
  trace.frames[0].health_updates.push_back({1U, HealthStatus::Fatal});
  for (const NodeId peer : {NodeId{0U}, NodeId{2U}}) {
    trace.frames[0].link_updates.push_back({1U, peer, false});
    trace.frames[0].link_updates.push_back({peer, 1U, false});
  }

  const SimulationResult result = runSimulationTrace(trace);

  CHECK(result.frames[0].nodes[1].state == ControllerState::SafeDisabled);
}

TEST_CASE("duplicate delivery cost stays visible beside accepted software work",
          "[invariant][cost]") {
  SimulationTrace trace = missionTrace();
  trace.frames[10].delivery_faults.push_back(
      {0U, 1U, MessageType::MissionAssignment, DeliveryFaultType::Duplicate, 0U});

  const SimulationResult result = runSimulationTrace(trace);

  CHECK(countEvents(result, SimulationEventType::MessageSent) == 6U);
  CHECK(countEvents(result, SimulationEventType::MessageDuplicated) == 1U);
  CHECK(countTransitions(result, 1U, ControllerState::Active) == 1U);
}
