#ifndef SATELLITE_SWARM_CONTROLLER_HPP
#define SATELLITE_SWARM_CONTROLLER_HPP

#include "satellite_swarm/interfaces.hpp"
#include "satellite_swarm/telemetry.hpp"

#include <stdint.h>

namespace satellite_swarm {

struct ControllerConfig {
  uint32_t response_window_ms = 2000U;
  uint32_t retry_interval_ms = 250U;
  uint8_t maximum_attempts = 4U;
  uint8_t failed_missions_before_safe_disable = 2U;
  uint8_t node_capacity = kMaximumNodes;
  uint8_t maximum_messages_per_update = 4U;

  ControllerConfig() = default;
};

struct ControllerDependencies {
  Transport& transport;
  HealthMonitor& health_monitor;
  const CandidacyScorer& scorer;
  SafeStateActuator* safe_state_actuator;

  ControllerDependencies(Transport& controller_transport, HealthMonitor& controller_health_monitor,
                         const CandidacyScorer& controller_scorer,
                         SafeStateActuator* controller_safe_state_actuator = nullptr)
      : transport(controller_transport), health_monitor(controller_health_monitor),
        scorer(controller_scorer), safe_state_actuator(controller_safe_state_actuator) {}
};

class SwarmController {
public:
  // A null actuator records a rejected safe-state result while preserving the latch. A supplied
  // actuator must outlive the controller.
  SwarmController(NodeId node_id, BootEpoch boot_epoch, const SatelliteSnapshot& satellite,
                  Transport& transport, HealthMonitor& health_monitor,
                  const CandidacyScorer& scorer,
                  const ControllerConfig& config = ControllerConfig());
  SwarmController(NodeId node_id, BootEpoch boot_epoch, const SatelliteSnapshot& satellite,
                  ControllerDependencies dependencies,
                  const ControllerConfig& config = ControllerConfig());

  // now_ms must use one modulo-2^32 monotonic tick source for every call. Unsigned elapsed-time
  // comparisons support one clock rollover when configured durations are shorter than that period.
  bool initiateMission(const Coordinate& objective, uint32_t now_ms);
  void update(uint32_t now_ms);
  void completeMission(uint32_t now_ms);
  // Invalid observations return false and leave the previous snapshot unchanged.
  bool updateSatelliteSnapshot(const SatelliteSnapshot& satellite);

  ControllerState state() const { return state_; }
  NodeId nodeId() const { return node_id_; }
  const SatelliteSnapshot& satelliteSnapshot() const { return satellite_; }
  BootEpoch bootEpoch() const { return boot_epoch_; }
  MissionKey currentMissionKey() const { return current_mission_.mission_key; }
  NodeId assignedNode() const { return assigned_node_; }
  uint8_t currentCandidacyScore() const {
    return node_id_ < kMaximumNodes ? candidates_[node_id_].score : 0U;
  }
  uint8_t consecutiveCommunicationFailures() const { return communication_failures_; }
  // A successful read removes the oldest event. Hardware adapters can drain this queue without
  // blocking controller progress.
  bool readTelemetry(TelemetryEvent& event) { return telemetry_.read(event); }
  // Transmission adapters can inspect the oldest event and remove it only after a sink accepts it.
  bool peekTelemetry(TelemetryEvent& event) const { return telemetry_.peek(event); }
  bool discardTelemetry() { return telemetry_.discard(); }
  uint8_t pendingTelemetryEvents() const { return telemetry_.size(); }
  uint32_t droppedTelemetryEvents() const { return telemetry_.droppedEvents(); }

private:
  struct Candidate {
    bool received = false;
    uint8_t score = 0U;
  };

  struct SafeStateExecution {
    TelemetryReason reason = TelemetryReason::None;
    bool pending = false;
  };

  NodeId node_id_;
  BootEpoch boot_epoch_;
  SatelliteSnapshot satellite_;
  Transport& transport_;
  HealthMonitor& health_monitor_;
  const CandidacyScorer& scorer_;
  SafeStateActuator* safe_state_actuator_;
  ControllerConfig config_;
  ControllerState state_ = ControllerState::Idle;
  Message current_mission_{};
  MissionSequence next_mission_sequence_ = 1U;
  NodeId assigned_node_ = kBroadcastNode;
  uint32_t phase_started_at_ms_ = 0U;
  uint32_t last_attempt_at_ms_ = 0U;
  uint8_t attempts_ = 0U;
  uint8_t communication_failures_ = 0U;
  HealthStatus last_health_ = HealthStatus::Nominal;
  SafeStateExecution safe_state_execution_{};
  Candidate candidates_[kMaximumNodes]{};
  BoundedTelemetryBuffer telemetry_{};

  void resetCandidates();
  void process(const Message& message, uint32_t now_ms);
  void acceptMissionRequest(const Message& request, uint32_t now_ms);
  bool sendCandidacy(uint32_t now_ms);
  void finishLeading(uint32_t now_ms);
  void abandonUnacknowledgedMission(uint32_t now_ms);
  void recordTelemetry(TelemetryEventType type, TelemetryReason reason, TelemetryPriority priority,
                       uint32_t now_ms, MissionKey mission_key = MissionKey(),
                       NodeId related_node = kBroadcastNode, uint8_t value = 0U);
  void transitionTo(ControllerState state, TelemetryReason reason, uint32_t now_ms,
                    TelemetryPriority priority = TelemetryPriority::Operational);
  void enterSafeDisabled(TelemetryReason telemetry_reason, SafeStateReason safe_state_reason,
                         uint32_t now_ms);
  void observeSafeState(uint32_t now_ms);
  void observeHealth(HealthStatus health, uint32_t now_ms);
  bool matchesCurrentMission(const Message& message) const;
  bool elapsed(uint32_t now_ms, uint32_t since_ms, uint32_t duration_ms) const;
};

} // namespace satellite_swarm

#endif
