#ifndef SATELLITE_SWARM_TELEMETRY_HPP
#define SATELLITE_SWARM_TELEMETRY_HPP

#include "satellite_swarm/types.hpp"

#include <stddef.h>
#include <stdint.h>

namespace satellite_swarm {

constexpr uint8_t kTelemetryBufferCapacity = 16U;

enum class TelemetryPriority : uint8_t { Routine, Operational, Critical };

enum class TelemetryEventType : uint8_t {
  StateTransition,
  MissionProposed,
  CandidacySent,
  CandidacyAccepted,
  MissionAssigned,
  MissionCompleted,
  MissionFailed,
  HealthChanged,
  TransportFailure,
  SafeStateRequested,
  SafeStateResult,
  SafeStateExecutionResult
};

enum class TelemetryReason : uint8_t {
  None,
  MissionInitiated,
  MissionRequestAccepted,
  AcknowledgementReceived,
  AssignmentReceived,
  AssignmentBroadcast,
  AssignmentWindowExpired,
  RetryLimitReached,
  MissionCompleted,
  HealthQuiescent,
  HealthRecovered,
  HealthFatal,
  SendFailed,
  InvalidConfiguration
};

struct TelemetryEvent {
  uint32_t sequence = 0U;
  uint32_t timestamp_ms = 0U;
  uint32_t dropped_before = 0U;
  BootEpoch boot_epoch = 0U;
  MissionKey mission_key{};
  NodeId node_id = 0U;
  NodeId related_node = kBroadcastNode;
  TelemetryEventType type = TelemetryEventType::StateTransition;
  TelemetryReason reason = TelemetryReason::None;
  TelemetryPriority priority = TelemetryPriority::Routine;
  ControllerState previous_state = ControllerState::Idle;
  ControllerState current_state = ControllerState::Idle;
  uint8_t value = 0U;
};

// A fixed-capacity, non-blocking queue for controller evidence. When full, a higher-priority
// record displaces the oldest record at the lowest available priority. Other incoming records are
// dropped. Sequence gaps and dropped_before make either case visible to a consumer. The queue has
// no synchronization; record and read must run in one execution context.
class BoundedTelemetryBuffer {
public:
  bool record(const TelemetryEvent& event);
  bool peek(TelemetryEvent& event) const;
  bool discard();
  bool read(TelemetryEvent& event);

  uint8_t size() const { return size_; }
  constexpr uint8_t capacity() const { return kTelemetryBufferCapacity; }
  uint32_t droppedEvents() const { return dropped_events_; }

private:
  TelemetryEvent events_[kTelemetryBufferCapacity]{};
  uint32_t next_sequence_ = 1U;
  uint32_t dropped_events_ = 0U;
  uint8_t size_ = 0U;

  void countDrop();
  void erase(uint8_t index);
};

} // namespace satellite_swarm

#endif
