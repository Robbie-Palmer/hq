#include "satellite_swarm/telemetry_codec.hpp"

namespace satellite_swarm {
namespace {

constexpr uint8_t kMagicAndVersion = 0xB3U;

void writeUint16(uint16_t value, uint8_t* output) {
  output[0] = static_cast<uint8_t>(value >> 8U);
  output[1] = static_cast<uint8_t>(value & 0xFFU);
}

uint16_t readUint16(const uint8_t* input) {
  return static_cast<uint16_t>(static_cast<uint16_t>(input[0]) << 8U) |
         static_cast<uint16_t>(input[1]);
}

void writeUint32(uint32_t value, uint8_t* output) {
  output[0] = static_cast<uint8_t>(value >> 24U);
  output[1] = static_cast<uint8_t>((value >> 16U) & 0xFFU);
  output[2] = static_cast<uint8_t>((value >> 8U) & 0xFFU);
  output[3] = static_cast<uint8_t>(value & 0xFFU);
}

uint32_t readUint32(const uint8_t* input) {
  return static_cast<uint32_t>(input[0]) << 24U | static_cast<uint32_t>(input[1]) << 16U |
         static_cast<uint32_t>(input[2]) << 8U | static_cast<uint32_t>(input[3]);
}

bool isKnownEventType(uint8_t value) {
  return value <= static_cast<uint8_t>(TelemetryEventType::SafeStateExecutionResult);
}

bool isKnownReason(uint8_t value) {
  return value <= static_cast<uint8_t>(TelemetryReason::InvalidConfiguration);
}

bool isKnownPriority(uint8_t value) {
  return value <= static_cast<uint8_t>(TelemetryPriority::Critical);
}

bool isKnownState(uint8_t value) {
  return value <= static_cast<uint8_t>(ControllerState::SafeDisabled);
}

bool isAbsentMissionKey(const MissionKey& mission_key) {
  return mission_key.origin_node == kBroadcastNode && mission_key.boot_epoch == 0U &&
         mission_key.sequence == 0U;
}

bool isSafeStateReason(TelemetryReason reason) {
  return reason == TelemetryReason::InvalidConfiguration ||
         reason == TelemetryReason::HealthFatal || reason == TelemetryReason::RetryLimitReached;
}

bool hasValidTypeSpecificFields(const TelemetryEvent& event) {
  if (event.type == TelemetryEventType::SafeStateRequested) {
    return event.priority == TelemetryPriority::Critical && event.related_node == event.node_id &&
           event.value == 0U && isSafeStateReason(event.reason);
  }
  if (event.type == TelemetryEventType::SafeStateResult) {
    return event.priority == TelemetryPriority::Critical && event.related_node == event.node_id &&
           event.value <= static_cast<uint8_t>(SafeStateResult::Accepted) &&
           isSafeStateReason(event.reason);
  }
  if (event.type == TelemetryEventType::SafeStateExecutionResult) {
    return event.priority == TelemetryPriority::Critical && event.related_node == event.node_id &&
           event.value >= static_cast<uint8_t>(SafeStateExecutionStatus::Succeeded) &&
           event.value <= static_cast<uint8_t>(SafeStateExecutionStatus::Failed) &&
           isSafeStateReason(event.reason);
  }
  return true;
}

bool isValidEvent(const TelemetryEvent& event) {
  return event.sequence != 0U && event.node_id < kMaximumNodes &&
         (event.related_node < kMaximumNodes || event.related_node == kBroadcastNode) &&
         isKnownEventType(static_cast<uint8_t>(event.type)) &&
         isKnownReason(static_cast<uint8_t>(event.reason)) &&
         isKnownPriority(static_cast<uint8_t>(event.priority)) &&
         isKnownState(static_cast<uint8_t>(event.previous_state)) &&
         isKnownState(static_cast<uint8_t>(event.current_state)) &&
         (isAbsentMissionKey(event.mission_key) || isValid(event.mission_key)) &&
         hasValidTypeSpecificFields(event);
}

} // namespace

bool TelemetryCodec::encode(const TelemetryEvent& event, uint8_t* output, size_t output_size) {
  if (output == nullptr || output_size != kFrameSize || !isValidEvent(event)) {
    return false;
  }

  output[0] = kMagicAndVersion;
  output[1] = static_cast<uint8_t>(event.type);
  output[2] = static_cast<uint8_t>(event.reason);
  output[3] = static_cast<uint8_t>(event.priority);
  output[4] = event.node_id;
  output[5] = event.related_node;
  output[6] = static_cast<uint8_t>(event.previous_state);
  output[7] = static_cast<uint8_t>(event.current_state);
  output[8] = event.value;
  writeUint32(event.boot_epoch, &output[9]);
  writeUint32(event.sequence, &output[13]);
  writeUint32(event.timestamp_ms, &output[17]);
  writeUint32(event.dropped_before, &output[21]);
  output[25] = event.mission_key.origin_node;
  writeUint32(event.mission_key.boot_epoch, &output[26]);
  writeUint16(event.mission_key.sequence, &output[30]);
  output[32] = 0U;
  output[33] = checksum(output, kFrameSize - 1U);
  return true;
}

bool TelemetryCodec::decode(const uint8_t* frame, size_t frame_size, TelemetryEvent& event) {
  if (frame == nullptr || frame_size != kFrameSize || frame[0] != kMagicAndVersion ||
      frame[32] != 0U || frame[33] != checksum(frame, kFrameSize - 1U)) {
    return false;
  }

  TelemetryEvent decoded;
  decoded.type = static_cast<TelemetryEventType>(frame[1]);
  decoded.reason = static_cast<TelemetryReason>(frame[2]);
  decoded.priority = static_cast<TelemetryPriority>(frame[3]);
  decoded.node_id = frame[4];
  decoded.related_node = frame[5];
  decoded.previous_state = static_cast<ControllerState>(frame[6]);
  decoded.current_state = static_cast<ControllerState>(frame[7]);
  decoded.value = frame[8];
  decoded.boot_epoch = readUint32(&frame[9]);
  decoded.sequence = readUint32(&frame[13]);
  decoded.timestamp_ms = readUint32(&frame[17]);
  decoded.dropped_before = readUint32(&frame[21]);
  decoded.mission_key.origin_node = frame[25];
  decoded.mission_key.boot_epoch = readUint32(&frame[26]);
  decoded.mission_key.sequence = readUint16(&frame[30]);
  if (!isValidEvent(decoded)) {
    return false;
  }

  event = decoded;
  return true;
}

uint8_t TelemetryCodec::checksum(const uint8_t* bytes, size_t size) {
  uint8_t crc = 0U;
  for (size_t index = 0U; index < size; ++index) {
    crc ^= bytes[index];
    for (uint8_t bit = 0U; bit < 8U; ++bit) {
      const auto shifted = static_cast<uint8_t>(static_cast<uint16_t>(crc) << 1U);
      crc = (crc & 0x80U) != 0U ? static_cast<uint8_t>(shifted ^ uint8_t{0x07U}) : shifted;
    }
  }
  return crc;
}

} // namespace satellite_swarm
