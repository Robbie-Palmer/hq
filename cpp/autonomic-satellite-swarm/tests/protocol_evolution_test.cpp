#include "satellite_swarm/protocol_evolution.hpp"

#include <array>
#include <catch2/catch_test_macros.hpp>
#include <limits>

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

JournalEntryRecord normalEntry() {
  JournalEntryRecord entry;
  entry.record_schema = 1U;
  entry.kind = JournalEntryKind::MissionIntent;
  entry.required_capabilities = capability(ProtocolCapability::MissionCoordination);
  entry.data_size = 2U;
  entry.data[0] = 0x12U;
  entry.data[1] = 0x34U;
  return entry;
}

JournalEntryRecord criticalEntry() {
  JournalEntryRecord entry = normalEntry();
  entry.record_schema = 2U;
  entry.priority = JournalPriority::Critical;
  entry.required_capabilities = capability(ProtocolCapability::JournalExchange) |
                                capability(ProtocolCapability::CriticalJournalPriority);
  return entry;
}

bool sameState(const DurableProtocolState& left, const DurableProtocolState& right) {
  if (left.node_id != right.node_id || left.schema_version != right.schema_version ||
      left.minimum_reader_schema != right.minimum_reader_schema ||
      left.boot_epoch != right.boot_epoch ||
      left.next_sender_sequence != right.next_sender_sequence ||
      left.journal_size != right.journal_size) {
    return false;
  }
  for (size_t index = 0U; index < kDurableJournalCapacity; ++index) {
    const DurableJournalEntry& left_entry = left.journal[index];
    const DurableJournalEntry& right_entry = right.journal[index];
    if (left_entry.sequence != right_entry.sequence ||
        left_entry.record.record_schema != right_entry.record.record_schema ||
        left_entry.record.kind != right_entry.record.kind ||
        left_entry.record.required_capabilities != right_entry.record.required_capabilities ||
        left_entry.record.priority != right_entry.record.priority ||
        left_entry.record.data_size != right_entry.record.data_size) {
      return false;
    }
    for (size_t data_index = 0U; data_index < kMaximumJournalDataSize; ++data_index) {
      if (left_entry.record.data[data_index] != right_entry.record.data[data_index]) {
        return false;
      }
    }
  }
  return true;
}

} // namespace

TEST_CASE("the evolution envelope round-trips every record type") {
  std::array<uint8_t, ProtocolEvolutionCodec::kPacketSize> packet{};
  EvolutionEnvelope decoded;

  SECTION("journal summary") {
    const JournalSummaryRecord summary{2U, 7U, 11U, 19U};
    const EvolutionEnvelope envelope =
        ProtocolEvolutionCodec::journalSummary(1U, 2U, 7U, 20U, summary);
    REQUIRE(ProtocolEvolutionCodec::encode(envelope, packet.data(), packet.size()));
    CHECK(packet[0] == 0xC5U);
    CHECK(packet[1] == 1U);
    CHECK(packet[2] == static_cast<uint8_t>(EvolutionRecordType::JournalSummary));
    CHECK(packet[3] == 2U);
    REQUIRE(ProtocolEvolutionCodec::decode(packet.data(), packet.size(), decoded) ==
            EvolutionDecodeResult::Accepted);
    JournalSummaryRecord restored;
    REQUIRE(ProtocolEvolutionCodec::readJournalSummary(decoded, restored));
    CHECK(restored.origin_node == 2U);
    CHECK(restored.boot_epoch == 7U);
    CHECK(restored.oldest_sequence == 11U);
    CHECK(restored.newest_sequence == 19U);
  }

  SECTION("missing record request") {
    const MissingRecordRequest request{1U, 4U, 6U, 9U};
    const EvolutionEnvelope envelope =
        ProtocolEvolutionCodec::missingRecordRequest(1U, 3U, 8U, 12U, request);
    REQUIRE(ProtocolEvolutionCodec::encode(envelope, packet.data(), packet.size()));
    REQUIRE(ProtocolEvolutionCodec::decode(packet.data(), packet.size(), decoded) ==
            EvolutionDecodeResult::Accepted);
    MissingRecordRequest restored;
    REQUIRE(ProtocolEvolutionCodec::readMissingRecordRequest(decoded, restored));
    CHECK(restored.origin_node == 1U);
    CHECK(restored.first_sequence == 6U);
    CHECK(restored.last_sequence == 9U);
  }

  SECTION("journal entry") {
    const JournalEntryRecord entry = criticalEntry();
    const EvolutionEnvelope envelope = ProtocolEvolutionCodec::journalEntry(2U, 4U, 9U, 15U, entry);
    REQUIRE(ProtocolEvolutionCodec::encode(envelope, packet.data(), packet.size()));
    REQUIRE(ProtocolEvolutionCodec::decode(packet.data(), packet.size(), decoded) ==
            EvolutionDecodeResult::Accepted);
    JournalEntryRecord restored;
    REQUIRE(ProtocolEvolutionCodec::readJournalEntry(decoded, restored));
    CHECK(restored.record_schema == 2U);
    CHECK(restored.priority == JournalPriority::Critical);
    CHECK(restored.required_capabilities == entry.required_capabilities);
    CHECK(restored.data[0] == 0x12U);
  }

  SECTION("capability advertisement") {
    DurableProtocolState state;
    const SoftwareProfile software = ProtocolEvolution::currentProfile();
    REQUIRE(ProtocolEvolution::loadState(state, software) == StateLoadResult::Migrated);
    const CapabilityAdvertisement advertisement = ProtocolEvolution::advertise(software, state);
    const EvolutionEnvelope envelope =
        ProtocolEvolutionCodec::capabilityAdvertisement(1U, 0U, 1U, 1U, advertisement);
    REQUIRE(ProtocolEvolutionCodec::encode(envelope, packet.data(), packet.size()));
    REQUIRE(ProtocolEvolutionCodec::decode(packet.data(), packet.size(), decoded) ==
            EvolutionDecodeResult::Accepted);
    CapabilityAdvertisement restored;
    REQUIRE(ProtocolEvolutionCodec::readCapabilityAdvertisement(decoded, restored));
    CHECK(restored.software_version == 2U);
    CHECK(restored.maximum_wire_version == 2U);
    CHECK(restored.durable_state_schema == 2U);
    CHECK(ProtocolEvolution::supports(restored,
                                      capability(ProtocolCapability::CriticalJournalPriority)));
  }
}

TEST_CASE("the evolution decoder distinguishes unknown versions, types, and malformed payloads") {
  std::array<uint8_t, ProtocolEvolutionCodec::kPacketSize> packet{};
  EvolutionEnvelope decoded;
  const EvolutionEnvelope valid =
      ProtocolEvolutionCodec::journalSummary(1U, 0U, 1U, 1U, JournalSummaryRecord{0U, 1U, 1U, 1U});
  REQUIRE(ProtocolEvolutionCodec::encode(valid, packet.data(), packet.size()));

  packet[1] = 3U;
  packet.back() = packetChecksum(packet.data(), packet.size() - 1U);
  CHECK(ProtocolEvolutionCodec::decode(packet.data(), packet.size(), decoded) ==
        EvolutionDecodeResult::UnsupportedVersion);

  packet[1] = 1U;
  packet[2] = 99U;
  packet.back() = packetChecksum(packet.data(), packet.size() - 1U);
  CHECK(ProtocolEvolutionCodec::decode(packet.data(), packet.size(), decoded) ==
        EvolutionDecodeResult::UnknownRecordType);

  packet[2] = static_cast<uint8_t>(EvolutionRecordType::JournalSummary);
  packet[13U + 9U] = 0U;
  packet[13U + 10U] = 0U;
  packet[13U + 11U] = 0U;
  packet[13U + 12U] = 0U;
  packet.back() = packetChecksum(packet.data(), packet.size() - 1U);
  CHECK(ProtocolEvolutionCodec::decode(packet.data(), packet.size(), decoded) ==
        EvolutionDecodeResult::InvalidPayload);

  packet[13U + 9U] = 0U;
  packet[13U + 10U] = 0U;
  packet[13U + 11U] = 0U;
  packet[13U + 12U] = 1U;
  packet[30] = 1U;
  packet.back() = packetChecksum(packet.data(), packet.size() - 1U);
  CHECK(ProtocolEvolutionCodec::decode(packet.data(), packet.size(), decoded) ==
        EvolutionDecodeResult::InvalidEnvelope);

  packet[30] = 0U;
  packet.back() ^= 0x01U;
  CHECK(ProtocolEvolutionCodec::decode(packet.data(), packet.size(), decoded) ==
        EvolutionDecodeResult::InvalidChecksum);
  CHECK(ProtocolEvolutionCodec::decode(packet.data(), packet.size() - 1U, decoded) ==
        EvolutionDecodeResult::InvalidSize);
}

TEST_CASE("wire version one rejects the version two critical-priority change") {
  std::array<uint8_t, ProtocolEvolutionCodec::kPacketSize> packet{};
  const EvolutionEnvelope critical =
      ProtocolEvolutionCodec::journalEntry(1U, 0U, 1U, 1U, criticalEntry());
  CHECK_FALSE(ProtocolEvolutionCodec::encode(critical, packet.data(), packet.size()));

  JournalEntryRecord entry = normalEntry();
  const EvolutionEnvelope normal = ProtocolEvolutionCodec::journalEntry(1U, 0U, 1U, 1U, entry);
  CHECK(ProtocolEvolutionCodec::encode(normal, packet.data(), packet.size()));
}

TEST_CASE("an interrupted rollout leaves old and migrated state readable") {
  DurableProtocolState old_node;
  old_node.node_id = 0U;
  DurableProtocolState updated_node;
  updated_node.node_id = 1U;

  CHECK(ProtocolEvolution::loadState(old_node, ProtocolEvolution::legacyProfile()) ==
        StateLoadResult::Ready);
  CHECK(ProtocolEvolution::loadState(updated_node, ProtocolEvolution::currentProfile()) ==
        StateLoadResult::Migrated);
  CHECK(old_node.schema_version == 1U);
  CHECK(updated_node.schema_version == 2U);
  CHECK(updated_node.minimum_reader_schema == 1U);

  const CapabilityAdvertisement old_advertisement =
      ProtocolEvolution::advertise(ProtocolEvolution::legacyProfile(), old_node);
  const CapabilityAdvertisement new_advertisement =
      ProtocolEvolution::advertise(ProtocolEvolution::currentProfile(), updated_node);
  uint8_t negotiated_version = 0U;
  REQUIRE(ProtocolEvolution::negotiateWireVersion(old_advertisement, new_advertisement,
                                                  negotiated_version));
  CHECK(negotiated_version == 1U);
}

TEST_CASE("future advertisements negotiate the newest wire version this build understands") {
  CapabilityAdvertisement future;
  future.software_version = 7U;
  future.minimum_wire_version = 1U;
  future.maximum_wire_version = 9U;
  future.durable_state_schema = 6U;
  future.capabilities = capability(ProtocolCapability::MissionCoordination);
  const CapabilityAdvertisement current =
      ProtocolEvolution::advertise(ProtocolEvolution::currentProfile(), DurableProtocolState{});
  uint8_t negotiated_version = 0U;
  REQUIRE(ProtocolEvolution::negotiateWireVersion(future, current, negotiated_version));
  CHECK(negotiated_version == 2U);
}

TEST_CASE("rollback after a version two durable write fails without changing state") {
  DurableProtocolState state;
  state.node_id = 1U;
  const SoftwareProfile current = ProtocolEvolution::currentProfile();
  REQUIRE(ProtocolEvolution::loadState(state, current) == StateLoadResult::Migrated);
  REQUIRE(ProtocolEvolution::append(state, current, criticalEntry()) ==
          JournalAppendResult::Appended);
  REQUIRE(state.minimum_reader_schema == 2U);
  const DurableProtocolState before_rollback = state;

  CHECK(ProtocolEvolution::loadState(state, ProtocolEvolution::legacyProfile()) ==
        StateLoadResult::UnsafeRollback);
  CHECK(sameState(state, before_rollback));
}

TEST_CASE("a new-version minority does not send unsupported work to old peers") {
  DurableProtocolState new_state;
  DurableProtocolState old_state_one;
  DurableProtocolState old_state_two;
  new_state.node_id = 0U;
  old_state_one.node_id = 1U;
  old_state_two.node_id = 2U;
  REQUIRE(ProtocolEvolution::loadState(new_state, ProtocolEvolution::currentProfile()) ==
          StateLoadResult::Migrated);

  const CapabilityAdvertisement new_advertisement =
      ProtocolEvolution::advertise(ProtocolEvolution::currentProfile(), new_state);
  const CapabilityAdvertisement old_advertisement_one =
      ProtocolEvolution::advertise(ProtocolEvolution::legacyProfile(), old_state_one);
  const CapabilityAdvertisement old_advertisement_two =
      ProtocolEvolution::advertise(ProtocolEvolution::legacyProfile(), old_state_two);
  const ProtocolCapabilities critical_capability =
      capability(ProtocolCapability::CriticalJournalPriority);

  CHECK(ProtocolEvolution::supports(new_advertisement, critical_capability));
  CHECK_FALSE(ProtocolEvolution::supports(old_advertisement_one, critical_capability));
  CHECK_FALSE(ProtocolEvolution::supports(old_advertisement_two, critical_capability));

  const DurableProtocolState before = old_state_one;
  CHECK(ProtocolEvolution::append(old_state_one, ProtocolEvolution::legacyProfile(),
                                  criticalEntry()) == JournalAppendResult::UnsupportedRecordSchema);
  CHECK(sameState(old_state_one, before));
}

TEST_CASE("a long-isolated old node rejoins through the oldest common wire version") {
  DurableProtocolState current_state;
  current_state.node_id = 0U;
  current_state.boot_epoch = 8U;
  REQUIRE(ProtocolEvolution::loadState(current_state, ProtocolEvolution::currentProfile()) ==
          StateLoadResult::Migrated);
  DurableProtocolState isolated_state;
  isolated_state.node_id = 2U;
  isolated_state.boot_epoch = 3U;

  const CapabilityAdvertisement current_advertisement =
      ProtocolEvolution::advertise(ProtocolEvolution::currentProfile(), current_state);
  const CapabilityAdvertisement isolated_advertisement =
      ProtocolEvolution::advertise(ProtocolEvolution::legacyProfile(), isolated_state);
  uint8_t negotiated_version = 0U;
  REQUIRE(ProtocolEvolution::negotiateWireVersion(current_advertisement, isolated_advertisement,
                                                  negotiated_version));
  REQUIRE(negotiated_version == 1U);

  const JournalSummaryRecord summary{0U, 8U, 1U, 7U};
  uint32_t sender_sequence = 0U;
  REQUIRE(ProtocolEvolution::reserveSenderSequence(
              current_state, ProtocolEvolution::currentProfile(), sender_sequence) ==
          SequenceReservationResult::Reserved);
  const EvolutionEnvelope envelope = ProtocolEvolutionCodec::journalSummary(
      negotiated_version, 0U, current_state.boot_epoch, sender_sequence, summary);
  std::array<uint8_t, ProtocolEvolutionCodec::kPacketSize> packet{};
  REQUIRE(ProtocolEvolutionCodec::encode(envelope, packet.data(), packet.size()));
  EvolutionEnvelope decoded;
  CHECK(ProtocolEvolutionCodec::decode(packet.data(), packet.size(), decoded) ==
        EvolutionDecodeResult::Accepted);
}

TEST_CASE("unsupported work and exhausted journals leave durable state unchanged") {
  DurableProtocolState state;
  const DurableProtocolState original = state;
  CHECK(ProtocolEvolution::append(state, ProtocolEvolution::legacyProfile(), criticalEntry()) ==
        JournalAppendResult::UnsupportedRecordSchema);
  CHECK(sameState(state, original));

  JournalEntryRecord entry = normalEntry();
  for (size_t index = 0U; index < kDurableJournalCapacity; ++index) {
    REQUIRE(ProtocolEvolution::append(state, ProtocolEvolution::legacyProfile(), entry) ==
            JournalAppendResult::Appended);
  }
  const DurableProtocolState full = state;
  CHECK(ProtocolEvolution::append(state, ProtocolEvolution::legacyProfile(), entry) ==
        JournalAppendResult::JournalFull);
  CHECK(sameState(state, full));

  DurableProtocolState exhausted;
  exhausted.next_sender_sequence = std::numeric_limits<uint32_t>::max();
  const DurableProtocolState before_exhaustion = exhausted;
  CHECK(ProtocolEvolution::append(exhausted, ProtocolEvolution::legacyProfile(), entry) ==
        JournalAppendResult::SequenceExhausted);
  CHECK(sameState(exhausted, before_exhaustion));

  uint32_t sequence = 0U;
  CHECK(ProtocolEvolution::reserveSenderSequence(exhausted, ProtocolEvolution::legacyProfile(),
                                                 sequence) ==
        SequenceReservationResult::SequenceExhausted);
  CHECK(sequence == 0U);
  CHECK(sameState(exhausted, before_exhaustion));
}

TEST_CASE("unknown durable-state schemas are rejected without mutation") {
  DurableProtocolState state;
  state.schema_version = 3U;
  state.minimum_reader_schema = 3U;
  const DurableProtocolState before = state;
  CHECK(ProtocolEvolution::loadState(state, ProtocolEvolution::currentProfile()) ==
        StateLoadResult::UnsupportedSchema);
  CHECK(sameState(state, before));
}
