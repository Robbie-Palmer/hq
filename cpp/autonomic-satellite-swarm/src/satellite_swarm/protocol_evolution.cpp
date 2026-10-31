#include "satellite_swarm/protocol_evolution.hpp"

namespace satellite_swarm {
namespace {

constexpr uint8_t kEvolutionMagic = 0xC5U;
constexpr size_t kPayloadOffset = 13U;
constexpr size_t kChecksumOffset = 31U;
constexpr uint8_t kJournalSummaryPayloadSize = 13U;
constexpr uint8_t kMissingRecordRequestPayloadSize = 13U;
constexpr uint8_t kJournalEntryPayloadSize = 16U;
constexpr uint8_t kCapabilityAdvertisementPayloadSize = 9U;

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

bool isKnownRecordType(uint8_t value) {
  return value >= static_cast<uint8_t>(EvolutionRecordType::JournalSummary) &&
         value <= static_cast<uint8_t>(EvolutionRecordType::CapabilityAdvertisement);
}

bool isKnownJournalEntryKind(JournalEntryKind kind) {
  return kind == JournalEntryKind::MissionIntent || kind == JournalEntryKind::MissionOutcome ||
         kind == JournalEntryKind::HealthObservation;
}

bool hasZeroPadding(const uint8_t* bytes, size_t begin, size_t end) {
  for (size_t index = begin; index < end; ++index) {
    if (bytes[index] != 0U) {
      return false;
    }
  }
  return true;
}

bool hasValidSummary(const JournalSummaryRecord& summary) {
  if (summary.origin_node >= kMaximumNodes || summary.boot_epoch == 0U) {
    return false;
  }
  const bool empty = summary.oldest_sequence == 0U && summary.newest_sequence == 0U;
  const bool bounded =
      summary.oldest_sequence != 0U && summary.oldest_sequence <= summary.newest_sequence;
  return empty || bounded;
}

bool hasValidRequest(const MissingRecordRequest& request) {
  return request.origin_node < kMaximumNodes && request.boot_epoch != 0U &&
         request.first_sequence != 0U && request.first_sequence <= request.last_sequence;
}

bool hasValidEntry(uint8_t envelope_version, const JournalEntryRecord& entry) {
  if ((entry.record_schema != 1U && entry.record_schema != 2U) ||
      !isKnownJournalEntryKind(entry.kind) || entry.required_capabilities == 0U ||
      entry.data_size > kMaximumJournalDataSize) {
    return false;
  }
  if (entry.priority != JournalPriority::Normal && entry.priority != JournalPriority::Critical) {
    return false;
  }
  if (entry.priority == JournalPriority::Critical &&
      (entry.record_schema < 2U || envelope_version < 2U)) {
    return false;
  }
  if (entry.record_schema > envelope_version) {
    return false;
  }
  return hasZeroPadding(entry.data, entry.data_size, kMaximumJournalDataSize);
}

bool hasValidAdvertisement(const CapabilityAdvertisement& advertisement) {
  return advertisement.software_version != 0U && advertisement.minimum_wire_version != 0U &&
         advertisement.minimum_wire_version <= advertisement.maximum_wire_version &&
         advertisement.durable_state_schema != 0U &&
         (advertisement.capabilities & capability(ProtocolCapability::MissionCoordination)) != 0U;
}

bool hasValidEnvelopeHeader(const EvolutionEnvelope& envelope) {
  return envelope.version >= kMinimumEvolutionWireVersion &&
         envelope.version <= kCurrentEvolutionWireVersion && envelope.sender < kMaximumNodes &&
         envelope.boot_epoch != 0U && envelope.sender_sequence != 0U &&
         envelope.payload_size <= ProtocolEvolutionCodec::kMaximumPayloadSize;
}

bool hasValidPayload(const EvolutionEnvelope& envelope) {
  switch (envelope.type) {
  case EvolutionRecordType::JournalSummary: {
    JournalSummaryRecord summary;
    return ProtocolEvolutionCodec::readJournalSummary(envelope, summary) &&
           hasValidSummary(summary);
  }
  case EvolutionRecordType::MissingRecordRequest: {
    MissingRecordRequest request;
    return ProtocolEvolutionCodec::readMissingRecordRequest(envelope, request) &&
           hasValidRequest(request);
  }
  case EvolutionRecordType::JournalEntry: {
    JournalEntryRecord entry;
    return ProtocolEvolutionCodec::readJournalEntry(envelope, entry) &&
           hasValidEntry(envelope.version, entry);
  }
  case EvolutionRecordType::CapabilityAdvertisement: {
    CapabilityAdvertisement advertisement;
    return ProtocolEvolutionCodec::readCapabilityAdvertisement(envelope, advertisement) &&
           hasValidAdvertisement(advertisement);
  }
  }
  return false;
}

bool hasValidState(const DurableProtocolState& state) {
  if (state.node_id >= kMaximumNodes || state.schema_version == 0U ||
      state.schema_version > kCurrentDurableStateSchema || state.minimum_reader_schema == 0U ||
      state.minimum_reader_schema > state.schema_version || state.boot_epoch == 0U ||
      state.next_sender_sequence == 0U || state.journal_size > kDurableJournalCapacity) {
    return false;
  }
  uint32_t previous_sequence = 0U;
  for (size_t index = 0U; index < state.journal_size; ++index) {
    const DurableJournalEntry& durable_entry = state.journal[index];
    if (durable_entry.sequence == 0U || durable_entry.sequence >= state.next_sender_sequence ||
        durable_entry.sequence <= previous_sequence ||
        !hasValidEntry(kCurrentEvolutionWireVersion, durable_entry.record)) {
      return false;
    }
    previous_sequence = durable_entry.sequence;
  }
  return true;
}

bool profileSupports(const SoftwareProfile& software, ProtocolCapabilities required) {
  return required != 0U && (software.capabilities & required) == required;
}

} // namespace

EvolutionEnvelope ProtocolEvolutionCodec::journalSummary(uint8_t version, NodeId sender,
                                                         BootEpoch boot_epoch,
                                                         uint32_t sender_sequence,
                                                         const JournalSummaryRecord& summary) {
  EvolutionEnvelope envelope;
  envelope.version = version;
  envelope.type = EvolutionRecordType::JournalSummary;
  envelope.sender = sender;
  envelope.boot_epoch = boot_epoch;
  envelope.sender_sequence = sender_sequence;
  envelope.payload_size = kJournalSummaryPayloadSize;
  envelope.payload[0] = summary.origin_node;
  writeUint32(summary.boot_epoch, &envelope.payload[1]);
  writeUint32(summary.oldest_sequence, &envelope.payload[5]);
  writeUint32(summary.newest_sequence, &envelope.payload[9]);
  return envelope;
}

EvolutionEnvelope
ProtocolEvolutionCodec::missingRecordRequest(uint8_t version, NodeId sender, BootEpoch boot_epoch,
                                             uint32_t sender_sequence,
                                             const MissingRecordRequest& request) {
  EvolutionEnvelope envelope;
  envelope.version = version;
  envelope.type = EvolutionRecordType::MissingRecordRequest;
  envelope.sender = sender;
  envelope.boot_epoch = boot_epoch;
  envelope.sender_sequence = sender_sequence;
  envelope.payload_size = kMissingRecordRequestPayloadSize;
  envelope.payload[0] = request.origin_node;
  writeUint32(request.boot_epoch, &envelope.payload[1]);
  writeUint32(request.first_sequence, &envelope.payload[5]);
  writeUint32(request.last_sequence, &envelope.payload[9]);
  return envelope;
}

EvolutionEnvelope ProtocolEvolutionCodec::journalEntry(uint8_t version, NodeId sender,
                                                       BootEpoch boot_epoch,
                                                       uint32_t sender_sequence,
                                                       const JournalEntryRecord& entry) {
  EvolutionEnvelope envelope;
  envelope.version = version;
  envelope.type = EvolutionRecordType::JournalEntry;
  envelope.sender = sender;
  envelope.boot_epoch = boot_epoch;
  envelope.sender_sequence = sender_sequence;
  envelope.payload_size = kJournalEntryPayloadSize;
  envelope.payload[0] = entry.record_schema;
  envelope.payload[1] = static_cast<uint8_t>(entry.kind);
  writeUint32(entry.required_capabilities, &envelope.payload[2]);
  envelope.payload[6] = static_cast<uint8_t>(entry.priority);
  envelope.payload[7] = entry.data_size;
  for (size_t index = 0U; index < kMaximumJournalDataSize; ++index) {
    envelope.payload[8U + index] = entry.data[index];
  }
  return envelope;
}

EvolutionEnvelope
ProtocolEvolutionCodec::capabilityAdvertisement(uint8_t version, NodeId sender,
                                                BootEpoch boot_epoch, uint32_t sender_sequence,
                                                const CapabilityAdvertisement& advertisement) {
  EvolutionEnvelope envelope;
  envelope.version = version;
  envelope.type = EvolutionRecordType::CapabilityAdvertisement;
  envelope.sender = sender;
  envelope.boot_epoch = boot_epoch;
  envelope.sender_sequence = sender_sequence;
  envelope.payload_size = kCapabilityAdvertisementPayloadSize;
  writeUint16(advertisement.software_version, &envelope.payload[0]);
  envelope.payload[2] = advertisement.minimum_wire_version;
  envelope.payload[3] = advertisement.maximum_wire_version;
  envelope.payload[4] = advertisement.durable_state_schema;
  writeUint32(advertisement.capabilities, &envelope.payload[5]);
  return envelope;
}

bool ProtocolEvolutionCodec::readJournalSummary(const EvolutionEnvelope& envelope,
                                                JournalSummaryRecord& summary) {
  if (envelope.type != EvolutionRecordType::JournalSummary ||
      envelope.payload_size != kJournalSummaryPayloadSize) {
    return false;
  }
  summary.origin_node = envelope.payload[0];
  summary.boot_epoch = readUint32(&envelope.payload[1]);
  summary.oldest_sequence = readUint32(&envelope.payload[5]);
  summary.newest_sequence = readUint32(&envelope.payload[9]);
  return true;
}

bool ProtocolEvolutionCodec::readMissingRecordRequest(const EvolutionEnvelope& envelope,
                                                      MissingRecordRequest& request) {
  if (envelope.type != EvolutionRecordType::MissingRecordRequest ||
      envelope.payload_size != kMissingRecordRequestPayloadSize) {
    return false;
  }
  request.origin_node = envelope.payload[0];
  request.boot_epoch = readUint32(&envelope.payload[1]);
  request.first_sequence = readUint32(&envelope.payload[5]);
  request.last_sequence = readUint32(&envelope.payload[9]);
  return true;
}

bool ProtocolEvolutionCodec::readJournalEntry(const EvolutionEnvelope& envelope,
                                              JournalEntryRecord& entry) {
  if (envelope.type != EvolutionRecordType::JournalEntry ||
      envelope.payload_size != kJournalEntryPayloadSize) {
    return false;
  }
  entry.record_schema = envelope.payload[0];
  entry.kind = static_cast<JournalEntryKind>(envelope.payload[1]);
  entry.required_capabilities = readUint32(&envelope.payload[2]);
  entry.priority = static_cast<JournalPriority>(envelope.payload[6]);
  entry.data_size = envelope.payload[7];
  for (size_t index = 0U; index < kMaximumJournalDataSize; ++index) {
    entry.data[index] = envelope.payload[8U + index];
  }
  return true;
}

bool ProtocolEvolutionCodec::readCapabilityAdvertisement(const EvolutionEnvelope& envelope,
                                                         CapabilityAdvertisement& advertisement) {
  if (envelope.type != EvolutionRecordType::CapabilityAdvertisement ||
      envelope.payload_size != kCapabilityAdvertisementPayloadSize) {
    return false;
  }
  advertisement.software_version = readUint16(&envelope.payload[0]);
  advertisement.minimum_wire_version = envelope.payload[2];
  advertisement.maximum_wire_version = envelope.payload[3];
  advertisement.durable_state_schema = envelope.payload[4];
  advertisement.capabilities = readUint32(&envelope.payload[5]);
  return true;
}

bool ProtocolEvolutionCodec::encode(const EvolutionEnvelope& envelope, uint8_t* output,
                                    size_t output_size) {
  if (output == nullptr || output_size != kPacketSize ||
      !isKnownRecordType(static_cast<uint8_t>(envelope.type)) ||
      !hasValidEnvelopeHeader(envelope) || !hasValidPayload(envelope)) {
    return false;
  }
  for (size_t index = 0U; index < output_size; ++index) {
    output[index] = 0U;
  }
  output[0] = kEvolutionMagic;
  output[1] = envelope.version;
  output[2] = static_cast<uint8_t>(envelope.type);
  output[3] = envelope.sender;
  writeUint32(envelope.boot_epoch, &output[4]);
  writeUint32(envelope.sender_sequence, &output[8]);
  output[12] = envelope.payload_size;
  for (size_t index = 0U; index < envelope.payload_size; ++index) {
    output[kPayloadOffset + index] = envelope.payload[index];
  }
  output[kChecksumOffset] = checksum(output, kChecksumOffset);
  return true;
}

EvolutionDecodeResult ProtocolEvolutionCodec::decode(const uint8_t* packet, size_t packet_size,
                                                     EvolutionEnvelope& envelope) {
  if (packet == nullptr || packet_size != kPacketSize || packet[0] != kEvolutionMagic) {
    return EvolutionDecodeResult::InvalidSize;
  }
  if (packet[kChecksumOffset] != checksum(packet, kChecksumOffset)) {
    return EvolutionDecodeResult::InvalidChecksum;
  }
  if (packet[1] < kMinimumEvolutionWireVersion || packet[1] > kCurrentEvolutionWireVersion) {
    return EvolutionDecodeResult::UnsupportedVersion;
  }
  if (!isKnownRecordType(packet[2])) {
    return EvolutionDecodeResult::UnknownRecordType;
  }
  if (packet[12] > kMaximumPayloadSize ||
      !hasZeroPadding(packet, kPayloadOffset + packet[12], kChecksumOffset)) {
    return EvolutionDecodeResult::InvalidEnvelope;
  }

  EvolutionEnvelope decoded;
  decoded.version = packet[1];
  decoded.type = static_cast<EvolutionRecordType>(packet[2]);
  decoded.sender = packet[3];
  decoded.boot_epoch = readUint32(&packet[4]);
  decoded.sender_sequence = readUint32(&packet[8]);
  decoded.payload_size = packet[12];
  for (size_t index = 0U; index < decoded.payload_size; ++index) {
    decoded.payload[index] = packet[kPayloadOffset + index];
  }
  if (!hasValidEnvelopeHeader(decoded)) {
    return EvolutionDecodeResult::InvalidEnvelope;
  }
  if (!hasValidPayload(decoded)) {
    return EvolutionDecodeResult::InvalidPayload;
  }
  envelope = decoded;
  return EvolutionDecodeResult::Accepted;
}

uint8_t ProtocolEvolutionCodec::checksum(const uint8_t* bytes, size_t size) {
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

SoftwareProfile ProtocolEvolution::legacyProfile() {
  SoftwareProfile profile;
  profile.software_version = 1U;
  profile.minimum_wire_version = 1U;
  profile.maximum_wire_version = 1U;
  profile.maximum_state_schema = 1U;
  profile.capabilities = capability(ProtocolCapability::MissionCoordination) |
                         capability(ProtocolCapability::JournalExchange);
  return profile;
}

SoftwareProfile ProtocolEvolution::currentProfile() {
  SoftwareProfile profile;
  profile.software_version = 2U;
  profile.minimum_wire_version = 1U;
  profile.maximum_wire_version = 2U;
  profile.maximum_state_schema = 2U;
  profile.capabilities = capability(ProtocolCapability::MissionCoordination) |
                         capability(ProtocolCapability::JournalExchange) |
                         capability(ProtocolCapability::CriticalJournalPriority);
  return profile;
}

StateLoadResult ProtocolEvolution::loadState(DurableProtocolState& state,
                                             const SoftwareProfile& software) {
  if (software.software_version == 0U || software.maximum_state_schema == 0U) {
    return StateLoadResult::InvalidState;
  }
  if (state.schema_version > kCurrentDurableStateSchema ||
      software.maximum_state_schema > kCurrentDurableStateSchema) {
    return StateLoadResult::UnsupportedSchema;
  }
  if (!hasValidState(state)) {
    return StateLoadResult::InvalidState;
  }
  if (state.schema_version <= software.maximum_state_schema) {
    if (state.schema_version == software.maximum_state_schema) {
      return StateLoadResult::Ready;
    }
    if (state.schema_version == 1U && software.maximum_state_schema == 2U) {
      DurableProtocolState migrated = state;
      migrated.schema_version = 2U;
      migrated.minimum_reader_schema = 1U;
      state = migrated;
      return StateLoadResult::Migrated;
    }
    return StateLoadResult::UnsupportedSchema;
  }
  if (state.minimum_reader_schema <= software.maximum_state_schema) {
    return StateLoadResult::RollbackCompatible;
  }
  return StateLoadResult::UnsafeRollback;
}

JournalAppendResult ProtocolEvolution::append(DurableProtocolState& state,
                                              const SoftwareProfile& software,
                                              const JournalEntryRecord& entry) {
  DurableProtocolState candidate = state;
  const StateLoadResult load_result = loadState(candidate, software);
  if (load_result == StateLoadResult::InvalidState) {
    return JournalAppendResult::InvalidState;
  }
  if (load_result == StateLoadResult::UnsupportedSchema ||
      load_result == StateLoadResult::UnsafeRollback) {
    return JournalAppendResult::UnsupportedRecordSchema;
  }
  if (!hasValidEntry(kCurrentEvolutionWireVersion, entry) ||
      entry.record_schema > software.maximum_state_schema) {
    return JournalAppendResult::UnsupportedRecordSchema;
  }
  if (!profileSupports(software, entry.required_capabilities) ||
      (entry.priority == JournalPriority::Critical &&
       !profileSupports(software, capability(ProtocolCapability::CriticalJournalPriority)))) {
    return JournalAppendResult::UnsupportedCapability;
  }
  if (candidate.journal_size >= kDurableJournalCapacity) {
    return JournalAppendResult::JournalFull;
  }
  if (candidate.next_sender_sequence == UINT32_MAX) {
    return JournalAppendResult::SequenceExhausted;
  }

  DurableJournalEntry durable_entry;
  durable_entry.sequence = candidate.next_sender_sequence;
  durable_entry.record = entry;
  candidate.journal[candidate.journal_size] = durable_entry;
  ++candidate.journal_size;
  ++candidate.next_sender_sequence;
  if (entry.record_schema > candidate.minimum_reader_schema) {
    candidate.minimum_reader_schema = entry.record_schema;
  }
  state = candidate;
  return JournalAppendResult::Appended;
}

SequenceReservationResult ProtocolEvolution::reserveSenderSequence(DurableProtocolState& state,
                                                                   const SoftwareProfile& software,
                                                                   uint32_t& sequence) {
  DurableProtocolState candidate = state;
  const StateLoadResult load_result = loadState(candidate, software);
  if (load_result == StateLoadResult::InvalidState) {
    return SequenceReservationResult::InvalidState;
  }
  if (load_result == StateLoadResult::UnsupportedSchema ||
      load_result == StateLoadResult::UnsafeRollback) {
    return SequenceReservationResult::UnsupportedSchema;
  }
  if (candidate.next_sender_sequence == UINT32_MAX) {
    return SequenceReservationResult::SequenceExhausted;
  }
  sequence = candidate.next_sender_sequence;
  ++candidate.next_sender_sequence;
  state = candidate;
  return SequenceReservationResult::Reserved;
}

CapabilityAdvertisement ProtocolEvolution::advertise(const SoftwareProfile& software,
                                                     const DurableProtocolState& state) {
  CapabilityAdvertisement advertisement;
  advertisement.software_version = software.software_version;
  advertisement.minimum_wire_version = software.minimum_wire_version;
  advertisement.maximum_wire_version = software.maximum_wire_version;
  advertisement.durable_state_schema = state.schema_version;
  advertisement.capabilities = software.capabilities;
  return advertisement;
}

bool ProtocolEvolution::negotiateWireVersion(const CapabilityAdvertisement& left,
                                             const CapabilityAdvertisement& right,
                                             uint8_t& negotiated_version) {
  if (!hasValidAdvertisement(left) || !hasValidAdvertisement(right)) {
    return false;
  }
  const uint8_t minimum = left.minimum_wire_version > right.minimum_wire_version
                              ? left.minimum_wire_version
                              : right.minimum_wire_version;
  const uint8_t peer_maximum = left.maximum_wire_version < right.maximum_wire_version
                                   ? left.maximum_wire_version
                                   : right.maximum_wire_version;
  const uint8_t maximum =
      peer_maximum < kCurrentEvolutionWireVersion ? peer_maximum : kCurrentEvolutionWireVersion;
  if (minimum > maximum) {
    return false;
  }
  negotiated_version = maximum;
  return true;
}

bool ProtocolEvolution::supports(const CapabilityAdvertisement& advertisement,
                                 ProtocolCapabilities required_capabilities) {
  return hasValidAdvertisement(advertisement) && required_capabilities != 0U &&
         (advertisement.capabilities & required_capabilities) == required_capabilities;
}

} // namespace satellite_swarm
