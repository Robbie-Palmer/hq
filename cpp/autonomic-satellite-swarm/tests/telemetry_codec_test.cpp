#include "satellite_swarm/telemetry_codec.hpp"

#include <array>
#include <catch2/catch_test_macros.hpp>

using namespace satellite_swarm;

namespace {

uint8_t frameChecksum(const uint8_t* bytes, size_t size) {
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

TelemetryEvent completeEvent() {
  TelemetryEvent event;
  event.sequence = 0x12345678U;
  event.timestamp_ms = 0x23456789U;
  event.dropped_before = 0x3456789AU;
  event.boot_epoch = 0x456789ABU;
  event.mission_key = MissionKey(7U, 0x56789ABCU, 0x9ABCU);
  event.node_id = 3U;
  event.related_node = 7U;
  event.type = TelemetryEventType::MissionAssigned;
  event.reason = TelemetryReason::AssignmentBroadcast;
  event.priority = TelemetryPriority::Critical;
  event.previous_state = ControllerState::Leading;
  event.current_state = ControllerState::Idle;
  event.value = 91U;
  return event;
}

} // namespace

TEST_CASE("the telemetry codec round-trips every record field in a fixed frame") {
  const TelemetryEvent original = completeEvent();
  std::array<uint8_t, TelemetryCodec::kFrameSize> frame{};

  REQUIRE(TelemetryCodec::encode(original, frame.data(), frame.size()));
  CHECK(frame[0] == 0xB3U);
  CHECK(frame[4] == 3U);
  CHECK(frame[9] == 0x45U);
  CHECK(frame[10] == 0x67U);
  CHECK(frame[11] == 0x89U);
  CHECK(frame[12] == 0xABU);
  CHECK(frame[13] == 0x12U);
  CHECK(frame[16] == 0x78U);
  CHECK(frame[25] == 7U);
  CHECK(frame[30] == 0x9AU);
  CHECK(frame[31] == 0xBCU);
  CHECK(frame[32] == 0U);
  CHECK(frame[33] == frameChecksum(frame.data(), frame.size() - 1U));

  TelemetryEvent decoded;
  REQUIRE(TelemetryCodec::decode(frame.data(), frame.size(), decoded));
  CHECK(decoded.sequence == original.sequence);
  CHECK(decoded.timestamp_ms == original.timestamp_ms);
  CHECK(decoded.dropped_before == original.dropped_before);
  CHECK(decoded.boot_epoch == original.boot_epoch);
  CHECK(decoded.mission_key == original.mission_key);
  CHECK(decoded.node_id == original.node_id);
  CHECK(decoded.related_node == original.related_node);
  CHECK(decoded.type == original.type);
  CHECK(decoded.reason == original.reason);
  CHECK(decoded.priority == original.priority);
  CHECK(decoded.previous_state == original.previous_state);
  CHECK(decoded.current_state == original.current_state);
  CHECK(decoded.value == original.value);
}

TEST_CASE("the telemetry codec accepts an absent mission key") {
  TelemetryEvent original = completeEvent();
  original.mission_key = MissionKey();
  std::array<uint8_t, TelemetryCodec::kFrameSize> frame{};

  REQUIRE(TelemetryCodec::encode(original, frame.data(), frame.size()));
  TelemetryEvent decoded;
  REQUIRE(TelemetryCodec::decode(frame.data(), frame.size(), decoded));
  CHECK(decoded.mission_key == MissionKey());
}

TEST_CASE("the telemetry codec rejects malformed and corrupted frames") {
  TelemetryEvent original = completeEvent();
  std::array<uint8_t, TelemetryCodec::kFrameSize> frame{};
  REQUIRE(TelemetryCodec::encode(original, frame.data(), frame.size()));

  TelemetryEvent decoded;
  frame[8] ^= 0x01U;
  CHECK_FALSE(TelemetryCodec::decode(frame.data(), frame.size(), decoded));
  CHECK_FALSE(TelemetryCodec::decode(frame.data(), frame.size() - 1U, decoded));
  CHECK_FALSE(TelemetryCodec::decode(nullptr, frame.size(), decoded));

  REQUIRE(TelemetryCodec::encode(original, frame.data(), frame.size()));
  frame[1] = 0xFFU;
  frame[33] = frameChecksum(frame.data(), frame.size() - 1U);
  CHECK_FALSE(TelemetryCodec::decode(frame.data(), frame.size(), decoded));

  REQUIRE(TelemetryCodec::encode(original, frame.data(), frame.size()));
  frame[0] = 0xB2U;
  frame[33] = frameChecksum(frame.data(), frame.size() - 1U);
  CHECK_FALSE(TelemetryCodec::decode(frame.data(), frame.size(), decoded));

  REQUIRE(TelemetryCodec::encode(original, frame.data(), frame.size()));
  frame[32] = 1U;
  frame[33] = frameChecksum(frame.data(), frame.size() - 1U);
  CHECK_FALSE(TelemetryCodec::decode(frame.data(), frame.size(), decoded));

  original.sequence = 0U;
  CHECK_FALSE(TelemetryCodec::encode(original, frame.data(), frame.size()));
  original.sequence = 1U;
  original.node_id = kMaximumNodes;
  CHECK_FALSE(TelemetryCodec::encode(original, frame.data(), frame.size()));
  original.node_id = 0U;
  original.mission_key = MissionKey(0U, 0U, 1U);
  CHECK_FALSE(TelemetryCodec::encode(original, frame.data(), frame.size()));
  CHECK_FALSE(TelemetryCodec::encode(original, nullptr, frame.size()));
}

TEST_CASE("safe-state telemetry enforces its result and correlation fields") {
  TelemetryEvent event = completeEvent();
  event.type = TelemetryEventType::SafeStateResult;
  event.reason = TelemetryReason::HealthFatal;
  event.node_id = 3U;
  event.related_node = 3U;
  event.value = static_cast<uint8_t>(SafeStateResult::Accepted);
  std::array<uint8_t, TelemetryCodec::kFrameSize> frame{};

  REQUIRE(TelemetryCodec::encode(event, frame.data(), frame.size()));

  event.value = 2U;
  CHECK_FALSE(TelemetryCodec::encode(event, frame.data(), frame.size()));
  event.value = static_cast<uint8_t>(SafeStateResult::Rejected);
  event.related_node = 2U;
  CHECK_FALSE(TelemetryCodec::encode(event, frame.data(), frame.size()));
  event.related_node = event.node_id;
  event.priority = TelemetryPriority::Operational;
  CHECK_FALSE(TelemetryCodec::encode(event, frame.data(), frame.size()));
  event.priority = TelemetryPriority::Critical;
  event.reason = TelemetryReason::MissionCompleted;
  CHECK_FALSE(TelemetryCodec::encode(event, frame.data(), frame.size()));
}

TEST_CASE("safe-state execution telemetry accepts only terminal results") {
  TelemetryEvent event = completeEvent();
  event.type = TelemetryEventType::SafeStateExecutionResult;
  event.reason = TelemetryReason::RetryLimitReached;
  event.node_id = 3U;
  event.related_node = 3U;
  event.value = static_cast<uint8_t>(SafeStateExecutionStatus::Succeeded);
  std::array<uint8_t, TelemetryCodec::kFrameSize> frame{};

  REQUIRE(TelemetryCodec::encode(event, frame.data(), frame.size()));
  event.value = static_cast<uint8_t>(SafeStateExecutionStatus::Failed);
  REQUIRE(TelemetryCodec::encode(event, frame.data(), frame.size()));
  event.value = static_cast<uint8_t>(SafeStateExecutionStatus::Pending);
  CHECK_FALSE(TelemetryCodec::encode(event, frame.data(), frame.size()));
  event.value = 3U;
  CHECK_FALSE(TelemetryCodec::encode(event, frame.data(), frame.size()));
}
