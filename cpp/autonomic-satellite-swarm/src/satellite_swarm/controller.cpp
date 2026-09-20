#include "satellite_swarm/controller.hpp"

namespace satellite_swarm {
namespace {

uint8_t boundedScore(uint8_t score) {
  return score > kMaximumCandidacyScore ? kMaximumCandidacyScore : score;
}

uint32_t missionLineageHash(const MissionKey& mission_key) {
  constexpr uint32_t kFnvOffsetBasis = 2166136261U;
  constexpr uint32_t kFnvPrime = 16777619U;
  uint32_t hash = kFnvOffsetBasis;
  const uint8_t bytes[] = {
      mission_key.origin_node,
      static_cast<uint8_t>(mission_key.boot_epoch >> 24U),
      static_cast<uint8_t>(mission_key.boot_epoch >> 16U),
      static_cast<uint8_t>(mission_key.boot_epoch >> 8U),
      static_cast<uint8_t>(mission_key.boot_epoch),
  };
  for (const uint8_t value : bytes) {
    hash ^= value;
    hash *= kFnvPrime;
  }
  return hash;
}

uint8_t cyclicTieIndex(const MissionKey& mission_key, uint8_t tied_candidates) {
  if (tied_candidates == 0U) {
    return 0U;
  }
  const uint32_t lineage_offset = missionLineageHash(mission_key) % tied_candidates;
  const uint32_t sequence_offset =
      static_cast<uint32_t>(mission_key.sequence - 1U) % tied_candidates;
  return static_cast<uint8_t>((lineage_offset + sequence_offset) % tied_candidates);
}

TelemetryReason healthReason(HealthStatus health) {
  switch (health) {
  case HealthStatus::Nominal:
    return TelemetryReason::HealthRecovered;
  case HealthStatus::Quiescent:
    return TelemetryReason::HealthQuiescent;
  case HealthStatus::Fatal:
    return TelemetryReason::HealthFatal;
  }
  return TelemetryReason::None;
}

} // namespace

SwarmController::SwarmController(NodeId node_id, BootEpoch boot_epoch,
                                 const SatelliteSnapshot& satellite, Transport& transport,
                                 HealthMonitor& health_monitor, const CandidacyScorer& scorer,
                                 const ControllerConfig& config)
    : SwarmController(node_id, boot_epoch, satellite,
                      ControllerDependencies{transport, health_monitor, scorer}, config) {}

SwarmController::SwarmController(NodeId node_id, BootEpoch boot_epoch,
                                 const SatelliteSnapshot& satellite,
                                 ControllerDependencies dependencies,
                                 const ControllerConfig& config)
    : node_id_(node_id), boot_epoch_(boot_epoch), satellite_(satellite),
      transport_(dependencies.transport), health_monitor_(dependencies.health_monitor),
      scorer_(dependencies.scorer), safe_state_actuator_(dependencies.safe_state_actuator),
      config_(config) {
  if (config_.node_capacity == 0U || config_.node_capacity > kMaximumNodes) {
    config_.node_capacity = kMaximumNodes;
  }
  if (config_.maximum_attempts == 0U) {
    config_.maximum_attempts = 1U;
  }
  if (config_.failed_missions_before_safe_disable == 0U) {
    config_.failed_missions_before_safe_disable = 1U;
  }
  if (config_.maximum_messages_per_update == 0U) {
    config_.maximum_messages_per_update = 1U;
  }
  resetCandidates();
  if (node_id_ >= config_.node_capacity || boot_epoch_ == 0U) {
    enterSafeDisabled(TelemetryReason::InvalidConfiguration, SafeStateReason::InvalidConfiguration,
                      0U);
  }
}

bool SwarmController::initiateMission(const Coordinate& objective, uint32_t now_ms) {
  if (state_ != ControllerState::Idle || node_id_ >= config_.node_capacity ||
      next_mission_sequence_ == 0U || !isValid(objective)) {
    return false;
  }

  const MissionKey mission_key(node_id_, boot_epoch_, next_mission_sequence_);
  const Message mission = Message::missionRequest(node_id_, mission_key, objective);
  if (!transport_.send(mission)) {
    recordTelemetry(TelemetryEventType::TransportFailure, TelemetryReason::SendFailed,
                    TelemetryPriority::Operational, now_ms, mission_key);
    return false;
  }

  current_mission_ = mission;
  next_mission_sequence_ = next_mission_sequence_ == UINT16_MAX
                               ? 0U
                               : static_cast<MissionSequence>(next_mission_sequence_ + 1U);

  resetCandidates();
  candidates_[node_id_].received = true;
  candidates_[node_id_].score = boundedScore(scorer_.score(satellite_, objective));
  assigned_node_ = kBroadcastNode;
  phase_started_at_ms_ = now_ms;
  recordTelemetry(TelemetryEventType::MissionProposed, TelemetryReason::MissionInitiated,
                  TelemetryPriority::Operational, now_ms, mission_key);
  transitionTo(ControllerState::Leading, TelemetryReason::MissionInitiated, now_ms);
  return true;
}

void SwarmController::update(uint32_t now_ms) {
  const HealthStatus health = health_monitor_.poll();
  observeHealth(health, now_ms);
  if (state_ == ControllerState::SafeDisabled) {
    observeSafeState(now_ms);
    return;
  }
  if (health == HealthStatus::Fatal) {
    enterSafeDisabled(TelemetryReason::HealthFatal, SafeStateReason::FatalHealth, now_ms);
    return;
  }
  if (health == HealthStatus::Quiescent) {
    transitionTo(ControllerState::Quiescent, TelemetryReason::HealthQuiescent, now_ms);
    return;
  }
  if (state_ == ControllerState::Quiescent) {
    transitionTo(ControllerState::Idle, TelemetryReason::HealthRecovered, now_ms);
  }

  if (state_ == ControllerState::Leading &&
      elapsed(now_ms, phase_started_at_ms_, config_.response_window_ms)) {
    finishLeading(now_ms);
  } else if (state_ == ControllerState::AwaitingAcknowledgement &&
             elapsed(now_ms, last_attempt_at_ms_, config_.retry_interval_ms)) {
    if (attempts_ >= config_.maximum_attempts) {
      abandonUnacknowledgedMission(now_ms);
    } else {
      sendCandidacy(now_ms);
    }
  } else if (state_ == ControllerState::AwaitingAssignment &&
             elapsed(now_ms, phase_started_at_ms_, config_.response_window_ms)) {
    recordTelemetry(TelemetryEventType::MissionFailed, TelemetryReason::AssignmentWindowExpired,
                    TelemetryPriority::Critical, now_ms, current_mission_.mission_key);
    transitionTo(ControllerState::Idle, TelemetryReason::AssignmentWindowExpired, now_ms,
                 TelemetryPriority::Critical);
  }

  Message incoming;
  for (uint8_t processed = 0U; processed < config_.maximum_messages_per_update; ++processed) {
    if (!transport_.receive(incoming)) {
      break;
    }
    process(incoming, now_ms);
    if (state_ == ControllerState::SafeDisabled || state_ == ControllerState::Quiescent) {
      return;
    }
  }
}

void SwarmController::completeMission(uint32_t now_ms) {
  if (state_ == ControllerState::Active) {
    recordTelemetry(TelemetryEventType::MissionCompleted, TelemetryReason::MissionCompleted,
                    TelemetryPriority::Critical, now_ms, current_mission_.mission_key, node_id_);
    assigned_node_ = kBroadcastNode;
    transitionTo(ControllerState::Idle, TelemetryReason::MissionCompleted, now_ms,
                 TelemetryPriority::Critical);
  }
}

bool SwarmController::updateSatelliteSnapshot(const SatelliteSnapshot& satellite) {
  if (!isValid(satellite)) {
    return false;
  }
  satellite_ = satellite;
  return true;
}

void SwarmController::resetCandidates() {
  for (uint8_t index = 0; index < kMaximumNodes; ++index) {
    candidates_[index].received = false;
    candidates_[index].score = 0U;
  }
}

void SwarmController::process(const Message& message, uint32_t now_ms) {
  if (message.sender >= config_.node_capacity || message.sender == node_id_ ||
      message.mission_key.origin_node >= config_.node_capacity || !isValid(message.mission_key)) {
    return;
  }

  switch (message.type) {
  case MessageType::MissionRequest:
    if (message.target == kBroadcastNode && message.sender == message.mission_key.origin_node &&
        isValid(message.objective)) {
      acceptMissionRequest(message, now_ms);
    }
    break;
  case MessageType::Candidacy:
    if (state_ == ControllerState::Leading && message.target == node_id_ &&
        message.mission_key == current_mission_.mission_key &&
        message.score <= kMaximumCandidacyScore) {
      candidates_[message.sender].received = true;
      candidates_[message.sender].score = message.score;
      recordTelemetry(TelemetryEventType::CandidacyAccepted, TelemetryReason::None,
                      TelemetryPriority::Routine, now_ms, message.mission_key, message.sender,
                      message.score);
      if (!transport_.send(
              Message::acknowledgement(node_id_, message.sender, message.mission_key))) {
        recordTelemetry(TelemetryEventType::TransportFailure, TelemetryReason::SendFailed,
                        TelemetryPriority::Operational, now_ms, message.mission_key,
                        message.sender);
      }
    }
    break;
  case MessageType::Acknowledgement:
    if (state_ == ControllerState::AwaitingAcknowledgement && message.target == node_id_ &&
        matchesCurrentMission(message)) {
      communication_failures_ = 0U;
      phase_started_at_ms_ = now_ms;
      transitionTo(ControllerState::AwaitingAssignment, TelemetryReason::AcknowledgementReceived,
                   now_ms);
    }
    break;
  case MessageType::MissionAssignment:
    if ((state_ == ControllerState::AwaitingAcknowledgement ||
         state_ == ControllerState::AwaitingAssignment) &&
        message.target < config_.node_capacity && matchesCurrentMission(message)) {
      communication_failures_ = 0U;
      assigned_node_ = message.target;
      recordTelemetry(TelemetryEventType::MissionAssigned, TelemetryReason::AssignmentReceived,
                      TelemetryPriority::Critical, now_ms, message.mission_key, message.target);
      transitionTo(message.target == node_id_ ? ControllerState::Active : ControllerState::Idle,
                   TelemetryReason::AssignmentReceived, now_ms, TelemetryPriority::Critical);
    }
    break;
  }
}

void SwarmController::acceptMissionRequest(const Message& request, uint32_t now_ms) {
  if (state_ != ControllerState::Idle) {
    return;
  }

  current_mission_ = request;
  attempts_ = 0U;
  phase_started_at_ms_ = now_ms;
  candidates_[node_id_].score = boundedScore(scorer_.score(satellite_, request.objective));
  if (!sendCandidacy(now_ms)) {
    transitionTo(ControllerState::Idle, TelemetryReason::SendFailed, now_ms);
  }
}

bool SwarmController::sendCandidacy(uint32_t now_ms) {
  const bool sent = transport_.send(
      Message::candidacy(node_id_, current_mission_.mission_key.origin_node,
                         current_mission_.mission_key, candidates_[node_id_].score));
  ++attempts_;
  last_attempt_at_ms_ = now_ms;
  if (sent) {
    recordTelemetry(TelemetryEventType::CandidacySent, TelemetryReason::MissionRequestAccepted,
                    TelemetryPriority::Routine, now_ms, current_mission_.mission_key,
                    current_mission_.mission_key.origin_node, candidates_[node_id_].score);
    transitionTo(ControllerState::AwaitingAcknowledgement, TelemetryReason::MissionRequestAccepted,
                 now_ms);
  } else {
    recordTelemetry(TelemetryEventType::TransportFailure, TelemetryReason::SendFailed,
                    TelemetryPriority::Operational, now_ms, current_mission_.mission_key,
                    current_mission_.mission_key.origin_node);
  }
  return sent;
}

void SwarmController::finishLeading(uint32_t now_ms) {
  uint8_t highest_score = 0U;
  uint8_t tied_candidates = 0U;
  for (NodeId candidate = 0; candidate < config_.node_capacity; ++candidate) {
    if (!candidates_[candidate].received) {
      continue;
    }
    if (tied_candidates == 0U || candidates_[candidate].score > highest_score) {
      highest_score = candidates_[candidate].score;
      tied_candidates = 1U;
    } else if (candidates_[candidate].score == highest_score) {
      ++tied_candidates;
    }
  }

  const uint8_t selected_tie_index = cyclicTieIndex(current_mission_.mission_key, tied_candidates);
  NodeId chosen = node_id_;
  uint8_t tie_index = 0U;
  for (NodeId candidate = 0; candidate < config_.node_capacity; ++candidate) {
    if (candidates_[candidate].received && candidates_[candidate].score == highest_score) {
      if (tie_index == selected_tie_index) {
        chosen = candidate;
        break;
      }
      ++tie_index;
    }
  }

  if (!transport_.send(Message::assignment(node_id_, chosen, current_mission_.mission_key))) {
    recordTelemetry(TelemetryEventType::TransportFailure, TelemetryReason::SendFailed,
                    TelemetryPriority::Operational, now_ms, current_mission_.mission_key, chosen);
    recordTelemetry(TelemetryEventType::MissionFailed, TelemetryReason::SendFailed,
                    TelemetryPriority::Critical, now_ms, current_mission_.mission_key, chosen);
    assigned_node_ = kBroadcastNode;
    transitionTo(ControllerState::Idle, TelemetryReason::SendFailed, now_ms,
                 TelemetryPriority::Critical);
    return;
  }

  assigned_node_ = chosen;
  recordTelemetry(TelemetryEventType::MissionAssigned, TelemetryReason::AssignmentBroadcast,
                  TelemetryPriority::Critical, now_ms, current_mission_.mission_key, chosen,
                  highest_score);
  transitionTo(chosen == node_id_ ? ControllerState::Active : ControllerState::Idle,
               TelemetryReason::AssignmentBroadcast, now_ms, TelemetryPriority::Critical);
}

void SwarmController::abandonUnacknowledgedMission(uint32_t now_ms) {
  ++communication_failures_;
  recordTelemetry(TelemetryEventType::MissionFailed, TelemetryReason::RetryLimitReached,
                  TelemetryPriority::Critical, now_ms, current_mission_.mission_key,
                  current_mission_.mission_key.origin_node, communication_failures_);
  if (communication_failures_ >= config_.failed_missions_before_safe_disable) {
    enterSafeDisabled(TelemetryReason::RetryLimitReached,
                      SafeStateReason::CommunicationFailureLimit, now_ms);
  } else {
    transitionTo(ControllerState::Idle, TelemetryReason::RetryLimitReached, now_ms,
                 TelemetryPriority::Critical);
  }
}

void SwarmController::recordTelemetry(TelemetryEventType type, TelemetryReason reason,
                                      TelemetryPriority priority, uint32_t now_ms,
                                      MissionKey mission_key, NodeId related_node, uint8_t value) {
  TelemetryEvent event;
  event.timestamp_ms = now_ms;
  event.boot_epoch = boot_epoch_;
  event.mission_key = mission_key;
  event.node_id = node_id_;
  event.related_node = related_node;
  event.type = type;
  event.reason = reason;
  event.priority = priority;
  event.previous_state = state_;
  event.current_state = state_;
  event.value = value;
  telemetry_.record(event);
}

void SwarmController::transitionTo(ControllerState state, TelemetryReason reason, uint32_t now_ms,
                                   TelemetryPriority priority) {
  if (state_ == state) {
    return;
  }
  TelemetryEvent event;
  event.timestamp_ms = now_ms;
  event.boot_epoch = boot_epoch_;
  event.mission_key = current_mission_.mission_key;
  event.node_id = node_id_;
  event.type = TelemetryEventType::StateTransition;
  event.reason = reason;
  event.priority = priority;
  event.previous_state = state_;
  event.current_state = state;
  telemetry_.record(event);
  state_ = state;
}

void SwarmController::enterSafeDisabled(TelemetryReason telemetry_reason,
                                        SafeStateReason safe_state_reason, uint32_t now_ms) {
  if (state_ == ControllerState::SafeDisabled) {
    return;
  }

  const SafeStateRequest request{SafeStateRequestId(node_id_, boot_epoch_), safe_state_reason,
                                 current_mission_.mission_key};
  safe_state_execution_.reason = telemetry_reason;
  recordTelemetry(TelemetryEventType::SafeStateRequested, telemetry_reason,
                  TelemetryPriority::Critical, now_ms, request.mission_key, node_id_);
  transitionTo(ControllerState::SafeDisabled, telemetry_reason, now_ms,
               TelemetryPriority::Critical);
  const SafeStateResult requested_result = safe_state_actuator_ == nullptr
                                               ? SafeStateResult::Rejected
                                               : safe_state_actuator_->request(request);
  const SafeStateResult result = requested_result == SafeStateResult::Accepted
                                     ? SafeStateResult::Accepted
                                     : SafeStateResult::Rejected;
  safe_state_execution_.pending = result == SafeStateResult::Accepted;
  recordTelemetry(TelemetryEventType::SafeStateResult, telemetry_reason,
                  TelemetryPriority::Critical, now_ms, request.mission_key, node_id_,
                  static_cast<uint8_t>(result));
}

void SwarmController::observeSafeState(uint32_t now_ms) {
  if (!safe_state_execution_.pending || safe_state_actuator_ == nullptr) {
    return;
  }

  SafeStateExecutionStatus status =
      safe_state_actuator_->status(SafeStateRequestId(node_id_, boot_epoch_));
  if (status == SafeStateExecutionStatus::Pending) {
    return;
  }
  if (status != SafeStateExecutionStatus::Succeeded && status != SafeStateExecutionStatus::Failed) {
    status = SafeStateExecutionStatus::Failed;
  }

  safe_state_execution_.pending = false;
  recordTelemetry(TelemetryEventType::SafeStateExecutionResult, safe_state_execution_.reason,
                  TelemetryPriority::Critical, now_ms, current_mission_.mission_key, node_id_,
                  static_cast<uint8_t>(status));
}

void SwarmController::observeHealth(HealthStatus health, uint32_t now_ms) {
  if (health == last_health_) {
    return;
  }
  recordTelemetry(
      TelemetryEventType::HealthChanged, healthReason(health),
      health == HealthStatus::Fatal ? TelemetryPriority::Critical : TelemetryPriority::Operational,
      now_ms, current_mission_.mission_key, kBroadcastNode, static_cast<uint8_t>(health));
  last_health_ = health;
}

bool SwarmController::matchesCurrentMission(const Message& message) const {
  return message.mission_key == current_mission_.mission_key &&
         message.sender == current_mission_.mission_key.origin_node;
}

bool SwarmController::elapsed(uint32_t now_ms, uint32_t since_ms, uint32_t duration_ms) const {
  return now_ms - since_ms >= duration_ms;
}

} // namespace satellite_swarm
