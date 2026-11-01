#ifndef SATELLITE_SWARM_PROTOCOL_EVOLUTION_HPP
#define SATELLITE_SWARM_PROTOCOL_EVOLUTION_HPP

#include "satellite_swarm/types.hpp"

#include <stddef.h>
#include <stdint.h>

namespace satellite_swarm {

constexpr uint8_t kMinimumEvolutionWireVersion = 1U;
constexpr uint8_t kCurrentEvolutionWireVersion = 2U;
constexpr uint8_t kCurrentDurableStateSchema = 2U;
constexpr size_t kMaximumJournalDataSize = 8U;
constexpr size_t kDurableJournalCapacity = 8U;

enum class EvolutionRecordType : uint8_t {
  JournalSummary = 1U,
  MissingRecordRequest = 2U,
  JournalEntry = 3U,
  CapabilityAdvertisement = 4U
};

enum class JournalEntryKind : uint8_t {
  MissionIntent = 1U,
  MissionOutcome = 2U,
  HealthObservation = 3U
};

enum class JournalPriority : uint8_t { Normal = 0U, Critical = 1U };

enum class ProtocolCapability : uint32_t {
  MissionCoordination = 1U << 0U,
  JournalExchange = 1U << 1U,
  CriticalJournalPriority = 1U << 2U
};

using ProtocolCapabilities = uint32_t;

constexpr ProtocolCapabilities capability(ProtocolCapability value) {
  return static_cast<ProtocolCapabilities>(value);
}

struct JournalSummaryRecord {
  NodeId origin_node = 0U;
  BootEpoch boot_epoch = 0U;
  uint32_t oldest_sequence = 0U;
  uint32_t newest_sequence = 0U;
};

struct MissingRecordRequest {
  NodeId origin_node = 0U;
  BootEpoch boot_epoch = 0U;
  uint32_t first_sequence = 0U;
  uint32_t last_sequence = 0U;
};

struct JournalEntryRecord {
  uint8_t record_schema = 1U;
  JournalEntryKind kind = JournalEntryKind::MissionIntent;
  ProtocolCapabilities required_capabilities = capability(ProtocolCapability::MissionCoordination);
  JournalPriority priority = JournalPriority::Normal;
  uint8_t data_size = 0U;
  uint8_t data[kMaximumJournalDataSize]{};
};

struct CapabilityAdvertisement {
  uint16_t software_version = 1U;
  uint8_t minimum_wire_version = kMinimumEvolutionWireVersion;
  uint8_t maximum_wire_version = kMinimumEvolutionWireVersion;
  uint8_t durable_state_schema = 1U;
  ProtocolCapabilities capabilities = capability(ProtocolCapability::MissionCoordination);
};

struct EvolutionEnvelope {
  uint8_t version = kMinimumEvolutionWireVersion;
  EvolutionRecordType type = EvolutionRecordType::JournalSummary;
  NodeId sender = 0U;
  BootEpoch boot_epoch = 0U;
  uint32_t sender_sequence = 0U;
  uint8_t payload_size = 0U;
  uint8_t payload[18U]{};
};

enum class EvolutionDecodeResult : uint8_t {
  Accepted,
  InvalidSize,
  InvalidChecksum,
  UnsupportedVersion,
  UnknownRecordType,
  InvalidEnvelope,
  InvalidPayload
};

class ProtocolEvolutionCodec {
public:
  static const size_t kPacketSize = 32U;
  static const size_t kMaximumPayloadSize = 18U;

  static EvolutionEnvelope journalSummary(uint8_t version, NodeId sender, BootEpoch boot_epoch,
                                          uint32_t sender_sequence,
                                          const JournalSummaryRecord& summary);
  static EvolutionEnvelope missingRecordRequest(uint8_t version, NodeId sender,
                                                BootEpoch boot_epoch, uint32_t sender_sequence,
                                                const MissingRecordRequest& request);
  static EvolutionEnvelope journalEntry(uint8_t version, NodeId sender, BootEpoch boot_epoch,
                                        uint32_t sender_sequence, const JournalEntryRecord& entry);
  static EvolutionEnvelope capabilityAdvertisement(uint8_t version, NodeId sender,
                                                   BootEpoch boot_epoch, uint32_t sender_sequence,
                                                   const CapabilityAdvertisement& advertisement);

  static bool readJournalSummary(const EvolutionEnvelope& envelope, JournalSummaryRecord& summary);
  static bool readMissingRecordRequest(const EvolutionEnvelope& envelope,
                                       MissingRecordRequest& request);
  static bool readJournalEntry(const EvolutionEnvelope& envelope, JournalEntryRecord& entry);
  static bool readCapabilityAdvertisement(const EvolutionEnvelope& envelope,
                                          CapabilityAdvertisement& advertisement);

  static bool encode(const EvolutionEnvelope& envelope, uint8_t* output, size_t output_size);
  static EvolutionDecodeResult decode(const uint8_t* packet, size_t packet_size,
                                      EvolutionEnvelope& envelope);

private:
  static uint8_t checksum(const uint8_t* bytes, size_t size);
};

struct SoftwareProfile {
  uint16_t software_version = 1U;
  uint8_t minimum_wire_version = kMinimumEvolutionWireVersion;
  uint8_t maximum_wire_version = kMinimumEvolutionWireVersion;
  uint8_t maximum_state_schema = 1U;
  ProtocolCapabilities capabilities = capability(ProtocolCapability::MissionCoordination);
};

struct DurableJournalEntry {
  uint32_t sequence = 0U;
  JournalEntryRecord record{};
};

struct DurableProtocolState {
  NodeId node_id = 0U;
  uint8_t schema_version = 1U;
  uint8_t minimum_reader_schema = 1U;
  BootEpoch boot_epoch = 1U;
  uint32_t next_sender_sequence = 1U;
  uint8_t journal_size = 0U;
  DurableJournalEntry journal[kDurableJournalCapacity]{};
};

enum class StateLoadResult : uint8_t {
  Ready,
  Migrated,
  RollbackCompatible,
  InvalidState,
  UnsupportedSchema,
  UnsafeRollback
};

enum class JournalAppendResult : uint8_t {
  Appended,
  InvalidState,
  UnsupportedCapability,
  UnsupportedRecordSchema,
  JournalFull,
  SequenceExhausted
};

enum class SequenceReservationResult : uint8_t {
  Reserved,
  InvalidState,
  UnsupportedSchema,
  SequenceExhausted
};

class ProtocolEvolution {
public:
  static SoftwareProfile legacyProfile();
  static SoftwareProfile currentProfile();

  static StateLoadResult loadState(DurableProtocolState& state, const SoftwareProfile& software);
  static JournalAppendResult append(DurableProtocolState& state, const SoftwareProfile& software,
                                    const JournalEntryRecord& entry);
  static SequenceReservationResult reserveSenderSequence(DurableProtocolState& state,
                                                         const SoftwareProfile& software,
                                                         uint32_t& sequence);

  static CapabilityAdvertisement advertise(const SoftwareProfile& software,
                                           const DurableProtocolState& state);
  static bool negotiateWireVersion(const CapabilityAdvertisement& left,
                                   const CapabilityAdvertisement& right,
                                   uint8_t& negotiated_version);
  static bool supports(const CapabilityAdvertisement& advertisement,
                       ProtocolCapabilities required_capabilities);
};

} // namespace satellite_swarm

#endif
