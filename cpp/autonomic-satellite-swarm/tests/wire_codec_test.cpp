#include "satellite_swarm/wire_codec.hpp"

#include <array>
#include <catch2/catch_test_macros.hpp>
#include <catch2/matchers/catch_matchers_floating_point.hpp>

using Catch::Matchers::WithinAbs;
using namespace satellite_swarm;

namespace {
uint8_t packetChecksum(const uint8_t* bytes, size_t size) {
  uint8_t crc = 0U;
  for (size_t index = 0U; index < size; ++index) {
    crc ^= bytes[index];
    for (uint8_t bit = 0U; bit < 8U; ++bit) {
      const auto shifted = static_cast<uint8_t>(static_cast<uint16_t>(crc) << 1U);
      crc = (crc & 0x80U) != 0U ? static_cast<uint8_t>(shifted ^ uint8_t{0x07}) : shifted;
    }
  }
  return crc;
}
} // namespace

TEST_CASE("the wire codec round-trips every message field") {
  const MissionKey mission_key(7U, 0x12345678U, 0x9ABCU);
  const Message original = Message::missionRequest(7U, mission_key, Coordinate(-123.45F, 67.89F));
  std::array<uint8_t, WireCodec::kPacketSize> packet{};

  REQUIRE(WireCodec::encode(original, packet.data(), packet.size()));
  REQUIRE(packet[0] == 0xA2);
  REQUIRE(packet[2] == 7);
  REQUIRE(packet[4] == 7);
  REQUIRE(packet[5] == 0x12);
  REQUIRE(packet[6] == 0x34);
  REQUIRE(packet[7] == 0x56);
  REQUIRE(packet[8] == 0x78);
  REQUIRE(packet[9] == 0x9A);
  REQUIRE(packet[10] == 0xBC);

  Message decoded;
  REQUIRE(WireCodec::decode(packet.data(), packet.size(), decoded));
  CHECK(decoded.type == MessageType::MissionRequest);
  CHECK(decoded.sender == 7);
  CHECK(decoded.target == kBroadcastNode);
  CHECK(decoded.mission_key == mission_key);
  CHECK_THAT(decoded.objective.longitude_degrees, WithinAbs(-123.45F, 0.001F));
  CHECK_THAT(decoded.objective.latitude_degrees, WithinAbs(67.89F, 0.001F));
}

TEST_CASE("the wire codec rejects corrupted and invalid packets") {
  Message message = Message::candidacy(2, 1, MissionKey(1U, 4U, 8U), 73);
  std::array<uint8_t, WireCodec::kPacketSize> packet{};
  REQUIRE(WireCodec::encode(message, packet.data(), packet.size()));

  packet[15] ^= 0x01U;
  Message decoded;
  CHECK_FALSE(WireCodec::decode(packet.data(), packet.size(), decoded));
  CHECK_FALSE(WireCodec::decode(packet.data(), packet.size() - 1U, decoded));

  message.objective = Coordinate(181.0F, 0.0F);
  CHECK_FALSE(WireCodec::encode(message, packet.data(), packet.size()));

  message.objective = Coordinate();
  message.type = static_cast<MessageType>(99);
  CHECK_FALSE(WireCodec::encode(message, packet.data(), packet.size()));

  message.type = MessageType::Candidacy;
  message.sender = kBroadcastNode;
  CHECK_FALSE(WireCodec::encode(message, packet.data(), packet.size()));

  message.sender = 2U;
  message.mission_key.origin_node = kMaximumNodes;
  CHECK_FALSE(WireCodec::encode(message, packet.data(), packet.size()));
}

TEST_CASE("message factories set routing semantics explicitly") {
  const MissionKey mission_key(1U, 9U, 42U);
  const Message candidacy = Message::candidacy(3, 1, mission_key, 88);
  CHECK(candidacy.type == MessageType::Candidacy);
  CHECK(candidacy.sender == 3);
  CHECK(candidacy.target == 1);
  CHECK(candidacy.mission_key == mission_key);
  CHECK(candidacy.score == 88);

  const Message assignment = Message::assignment(1, 3, mission_key);
  CHECK(assignment.type == MessageType::MissionAssignment);
  CHECK(assignment.sender == 1);
  CHECK(assignment.target == 3);
}

TEST_CASE("the wire codec rejects an absent mission identity and nonzero reserved fields") {
  std::array<uint8_t, WireCodec::kPacketSize> packet{};
  Message invalid = Message::missionRequest(0U, MissionKey(), Coordinate());
  CHECK_FALSE(WireCodec::encode(invalid, packet.data(), packet.size()));

  const Message valid = Message::missionRequest(0U, MissionKey(0U, 1U, 1U), Coordinate());
  REQUIRE(WireCodec::encode(valid, packet.data(), packet.size()));
  REQUIRE(packet[17] == packetChecksum(packet.data(), packet.size() - 1U));
  packet[16] = 1U;
  packet[17] = packetChecksum(packet.data(), packet.size() - 1U);
  CHECK_FALSE(WireCodec::decode(packet.data(), packet.size(), invalid));
}
