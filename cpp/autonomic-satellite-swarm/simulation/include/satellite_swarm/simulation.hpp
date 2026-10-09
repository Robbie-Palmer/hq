#ifndef SATELLITE_SWARM_SIMULATION_HPP
#define SATELLITE_SWARM_SIMULATION_HPP

#include "satellite_swarm/controller.hpp"
#include "satellite_swarm/orbit.hpp"

#include <optional>
#include <stdint.h>
#include <string>
#include <vector>

namespace satellite_swarm::simulation {

constexpr uint8_t kSimulationTraceVersion = 6U;

struct NodeConfiguration {
  NodeConfiguration() = default;
  NodeConfiguration(NodeId configured_node_id, SatelliteSnapshot configured_satellite,
                    BootEpoch configured_boot_epoch = 1U,
                    SafeStateResult configured_safe_state_result = SafeStateResult::Rejected)
      : node_id(configured_node_id), satellite(configured_satellite),
        boot_epoch(configured_boot_epoch), safe_state_request_result(configured_safe_state_result) {
  }

  NodeId node_id = 0U;
  SatelliteSnapshot satellite{};
  BootEpoch boot_epoch = 1U;
  SafeStateResult safe_state_request_result = SafeStateResult::Rejected;
  uint16_t protocol_version = 1U;
  uint16_t receive_buffer_capacity = 64U;
};

struct TraceProvenance {
  std::string scenario_id;
  std::string code_revision;
  std::string configuration_id;
  uint64_t seed = 0U;
};

struct SeededDeliveryFaults {
  bool enabled = false;
  uint16_t loss_permyriad = 0U;
  uint16_t delay_permyriad = 0U;
  uint16_t duplicate_permyriad = 0U;
  uint16_t reorder_permyriad = 0U;
  uint32_t minimum_delay_ms = 1U;
  uint32_t maximum_delay_ms = 1U;
};

struct SatelliteUpdate {
  NodeId node_id = 0U;
  SatelliteSnapshot satellite{};
};

struct OrbitUpdate {
  OrbitUpdate() = default;
  OrbitUpdate(NodeId configured_node_id, const PropagationResult& configured_orbit)
      : node_id(configured_node_id), orbit(configured_orbit) {}

  NodeId node_id = 0U;
  PropagationResult orbit{};
};

struct HealthUpdate {
  NodeId node_id = 0U;
  HealthStatus health = HealthStatus::Nominal;
};

struct SafeStateStatusUpdate {
  NodeId node_id = 0U;
  SafeStateExecutionStatus status = SafeStateExecutionStatus::Pending;
};

struct MissionCommand {
  NodeId leader = 0U;
  Coordinate objective{};
};

struct MissionCompletion {
  NodeId node_id = 0U;
};

enum class DeliveryFaultType : uint8_t { Drop, Delay, Duplicate };
enum class DeliveryDecisionType : uint8_t { Deliver, Drop, Delay, Duplicate, Reorder };
enum class MessageDropReason : uint8_t {
  Scripted,
  LinkUnavailable,
  NodeCrashed,
  StoragePressure,
  IncompatibleProtocol
};

// A directive applies once to the next matching sender-to-recipient delivery in its frame.
// A delayed delivery reaches the recipient on the first trace frame at or after deliver_at_ms.
struct DeliveryFault {
  NodeId sender = 0U;
  NodeId recipient = 0U;
  MessageType message_type = MessageType::MissionRequest;
  DeliveryFaultType type = DeliveryFaultType::Drop;
  uint32_t delay_ms = 0U;
};

struct LinkUpdate {
  NodeId sender = 0U;
  NodeId recipient = 0U;
  bool connected = true;
};

// Contact observations retain both the plan and the link that was actually available.
struct ContactUpdate {
  NodeId sender = 0U;
  NodeId recipient = 0U;
  bool planned_connected = true;
  bool connected = true;
};

struct StoragePressureUpdate {
  NodeId node_id = 0U;
  uint16_t receive_buffer_capacity = 0U;
};

struct NodeCrash {
  NodeId node_id = 0U;
};

struct NodeReset {
  NodeId node_id = 0U;
};

struct SimulationFrame {
  uint32_t now_ms = 0U;
  std::vector<SatelliteUpdate> satellite_updates;
  std::vector<OrbitUpdate> orbit_updates;
  std::vector<HealthUpdate> health_updates;
  // Status changes take effect before controller updates in the same frame.
  std::vector<SafeStateStatusUpdate> safe_state_status_updates;
  // Link changes take effect before resets, delayed-message release, and controller updates.
  std::vector<LinkUpdate> link_updates;
  std::vector<ContactUpdate> contact_updates;
  std::vector<StoragePressureUpdate> storage_pressure_updates;
  // Link availability takes precedence over a matching directive, which is still consumed.
  std::vector<DeliveryFault> delivery_faults;
  std::vector<NodeCrash> node_crashes;
  // Resets complete before due delayed messages are released to the replacement controller.
  std::vector<NodeReset> node_resets;
  // Completions run before new mission commands, so a node can finish and lead within one frame.
  std::vector<MissionCompletion> mission_completions;
  std::vector<MissionCommand> mission_commands;
};

struct SimulationTrace {
  uint8_t version = kSimulationTraceVersion;
  TraceProvenance provenance{};
  SeededDeliveryFaults seeded_delivery_faults{};
  bool record_delivery_decisions = false;
  bool record_resource_samples = false;
  ControllerConfig controller{};
  // Nodes must be non-empty, contiguous, and ordered by node_id.
  std::vector<NodeConfiguration> nodes;
  // Frames may be empty. Each time must advance by at most INT32_MAX ticks modulo 2^32.
  std::vector<SimulationFrame> frames;
};

enum class SimulationEventType : uint8_t {
  MissionCommand,
  MissionCompletion,
  MessageSent,
  MessageDropped,
  MessageDelayed,
  MessageDuplicated,
  MessageDelivered,
  DeliveryDecision,
  DelayedMessageDelivered,
  LinkChanged,
  ContactObserved,
  StoragePressureChanged,
  NodeCrashed,
  NodeReset,
  ResourceSample,
  StateChanged,
  ControllerTelemetry
};

struct SimulationEvent {
  SimulationEventType type = SimulationEventType::StateChanged;
  uint32_t now_ms = 0U;
  NodeId node_id = 0U;
  NodeId recipient_node = kBroadcastNode;
  bool accepted = false;
  bool connected = true;
  bool planned_connected = true;
  bool running = true;
  uint32_t deliver_at_ms = 0U;
  uint32_t random_value = 0U;
  DeliveryDecisionType delivery_decision = DeliveryDecisionType::Deliver;
  uint16_t buffer_occupancy = 0U;
  uint16_t buffer_capacity = 0U;
  uint64_t bytes_sent = 0U;
  uint64_t bytes_received = 0U;
  uint64_t bytes_dropped = 0U;
  double estimated_energy_millijoules = 0.0;
  MessageDropReason drop_reason = MessageDropReason::Scripted;
  Coordinate objective{};
  Message message{};
  MissionKey mission_key{};
  ControllerState previous_state = ControllerState::Idle;
  ControllerState current_state = ControllerState::Idle;
  TelemetryEvent telemetry{};
};

struct NodeObservation {
  NodeId node_id = 0U;
  ControllerState state = ControllerState::Idle;
  SatelliteSnapshot satellite{};
  BootEpoch boot_epoch = 0U;
  MissionKey mission_key{};
  NodeId assigned_node = kBroadcastNode;
  uint8_t candidacy_score = 0U;
  uint8_t communication_failures = 0U;
  uint32_t telemetry_drops = 0U;
  std::optional<PropagationResult> orbit;
  bool running = true;
  uint16_t protocol_version = 1U;
  uint16_t buffer_occupancy = 0U;
  uint16_t buffer_capacity = 0U;
};

struct FrameObservation {
  uint32_t now_ms = 0U;
  std::vector<NodeObservation> nodes;
};

struct SimulationResult {
  std::vector<SimulationEvent> events;
  std::vector<FrameObservation> frames;
};

// Throws std::invalid_argument when the trace is malformed or references an unknown node.
SimulationResult runSimulationTrace(const SimulationTrace& trace);

} // namespace satellite_swarm::simulation

#endif
