#include "satellite_swarm/wire_codec.hpp"

#include <math.h>

namespace satellite_swarm {
namespace {

constexpr uint8_t kMagicAndVersion = 0xA2U;
constexpr float kCoordinateScale = 100.0F;

void writeInt16(int16_t value, uint8_t* output) {
  const auto bits = static_cast<uint16_t>(value);
  output[0] = static_cast<uint8_t>(bits >> 8U);
  output[1] = static_cast<uint8_t>(bits & 0xFFU);
}

int16_t readInt16(const uint8_t* input) {
  const uint16_t bits = static_cast<uint16_t>(static_cast<uint16_t>(input[0]) << 8U) |
                        static_cast<uint16_t>(input[1]);
  return static_cast<int16_t>(bits);
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

bool isKnownMessageType(uint8_t type) {
  return type >= static_cast<uint8_t>(MessageType::MissionRequest) &&
         type <= static_cast<uint8_t>(MessageType::MissionAssignment);
}

bool hasValidRouting(const Message& message) {
  return message.sender < kMaximumNodes &&
         (message.target < kMaximumNodes || message.target == kBroadcastNode);
}

} // namespace

bool WireCodec::encode(const Message& message, uint8_t* output, size_t output_size) {
  if (output == nullptr || output_size != kPacketSize ||
      !isKnownMessageType(static_cast<uint8_t>(message.type)) || !isValid(message.objective) ||
      !hasValidRouting(message) || !isValid(message.mission_key) ||
      message.score > kMaximumCandidacyScore) {
    return false;
  }

  output[0] = kMagicAndVersion;
  output[1] = static_cast<uint8_t>(message.type);
  output[2] = message.sender;
  output[3] = message.target;
  output[4] = message.mission_key.origin_node;
  writeUint32(message.mission_key.boot_epoch, &output[5]);
  output[9] = static_cast<uint8_t>(message.mission_key.sequence >> 8U);
  output[10] = static_cast<uint8_t>(message.mission_key.sequence & 0xFFU);
  writeInt16(static_cast<int16_t>(lroundf(message.objective.longitude_degrees * kCoordinateScale)),
             &output[11]);
  writeInt16(static_cast<int16_t>(lroundf(message.objective.latitude_degrees * kCoordinateScale)),
             &output[13]);
  output[15] = message.score;
  output[16] = 0U;
  output[17] = checksum(output, kPacketSize - 1U);
  return true;
}

bool WireCodec::decode(const uint8_t* packet, size_t packet_size, Message& message) {
  if (packet == nullptr || packet_size != kPacketSize || packet[0] != kMagicAndVersion ||
      !isKnownMessageType(packet[1]) || packet[15] > kMaximumCandidacyScore || packet[16] != 0U ||
      packet[17] != checksum(packet, kPacketSize - 1U)) {
    return false;
  }

  Message decoded;
  decoded.type = static_cast<MessageType>(packet[1]);
  decoded.sender = packet[2];
  decoded.target = packet[3];
  decoded.mission_key.origin_node = packet[4];
  decoded.mission_key.boot_epoch = readUint32(&packet[5]);
  decoded.mission_key.sequence =
      static_cast<MissionSequence>(static_cast<uint16_t>(packet[9]) << 8U) |
      static_cast<MissionSequence>(packet[10]);
  decoded.objective.longitude_degrees =
      static_cast<float>(readInt16(&packet[11])) / kCoordinateScale;
  decoded.objective.latitude_degrees =
      static_cast<float>(readInt16(&packet[13])) / kCoordinateScale;
  decoded.score = packet[15];
  if (!isValid(decoded.objective) || !isValid(decoded.mission_key)) {
    return false;
  }
  if (!hasValidRouting(decoded)) {
    return false;
  }

  message = decoded;
  return true;
}

uint8_t WireCodec::checksum(const uint8_t* bytes, size_t size) {
  uint8_t crc = 0;
  for (size_t index = 0; index < size; ++index) {
    crc ^= bytes[index];
    for (uint8_t bit = 0; bit < 8U; ++bit) {
      const auto shifted = static_cast<uint8_t>(static_cast<uint16_t>(crc) << 1U);
      crc = (crc & 0x80U) != 0U ? static_cast<uint8_t>(shifted ^ uint8_t{0x07}) : shifted;
    }
  }
  return crc;
}

} // namespace satellite_swarm
