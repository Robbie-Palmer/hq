#ifndef SATELLITE_SWARM_TYPES_HPP
#define SATELLITE_SWARM_TYPES_HPP

#include <stdint.h>

namespace satellite_swarm {

using NodeId = uint8_t;
using BootEpoch = uint32_t;
using MissionSequence = uint16_t;

constexpr NodeId kBroadcastNode = UINT8_MAX;
constexpr uint8_t kMaximumNodes = 16U;
constexpr uint8_t kMaximumCandidacyScore = 100U;

struct MissionKey {
  NodeId origin_node = kBroadcastNode;
  BootEpoch boot_epoch = 0U;
  MissionSequence sequence = 0U;

  MissionKey() = default;
  MissionKey(NodeId origin, BootEpoch epoch, MissionSequence mission_sequence)
      : origin_node(origin), boot_epoch(epoch), sequence(mission_sequence) {}

  friend bool operator==(const MissionKey& left, const MissionKey& right) {
    return left.origin_node == right.origin_node && left.boot_epoch == right.boot_epoch &&
           left.sequence == right.sequence;
  }

  friend bool operator!=(const MissionKey& left, const MissionKey& right) {
    return !(left == right);
  }
};

bool isValid(const MissionKey& mission_key);

struct Coordinate {
  float longitude_degrees = 0.0F;
  float latitude_degrees = 0.0F;

  Coordinate() = default;
  Coordinate(float longitude, float latitude)
      : longitude_degrees(longitude), latitude_degrees(latitude) {}
};

bool isValid(const Coordinate& coordinate);

enum class TravelDirection : uint8_t { Northbound, Southbound };

struct SatelliteSnapshot {
  Coordinate coordinate{};
  float orbital_radius_metres = 6750000.0F;
  float mass_kilograms = 1.0F;
  float available_propulsion_energy_joules = 40000.0F;
  TravelDirection travel_direction = TravelDirection::Southbound;

  SatelliteSnapshot() = default;
};

bool isValid(const SatelliteSnapshot& satellite);

enum class MessageType : uint8_t {
  MissionRequest = 1,
  Candidacy = 2,
  Acknowledgement = 3,
  MissionAssignment = 4
};

struct Message {
  MessageType type = MessageType::MissionRequest;
  NodeId sender = 0U;
  NodeId target = kBroadcastNode;
  MissionKey mission_key{};
  Coordinate objective{};
  uint8_t score = 0U;

  Message() = default;

  static Message missionRequest(NodeId sender, MissionKey mission_key, Coordinate objective);
  static Message candidacy(NodeId sender, NodeId leader, MissionKey mission_key, uint8_t score);
  static Message acknowledgement(NodeId sender, NodeId candidate, MissionKey mission_key);
  static Message assignment(NodeId sender, NodeId assignee, MissionKey mission_key);
};

enum class HealthStatus : uint8_t { Nominal, Quiescent, Fatal };

enum class SafeStateReason : uint8_t {
  InvalidConfiguration,
  FatalHealth,
  CommunicationFailureLimit
};

struct SafeStateRequestId {
  NodeId node_id = kBroadcastNode;
  BootEpoch boot_epoch = 0U;

  SafeStateRequestId() = default;
  SafeStateRequestId(NodeId node, BootEpoch epoch) : node_id(node), boot_epoch(epoch) {}

  friend bool operator==(const SafeStateRequestId& left, const SafeStateRequestId& right) {
    return left.node_id == right.node_id && left.boot_epoch == right.boot_epoch;
  }
};

struct SafeStateRequest {
  SafeStateRequestId id{};
  SafeStateReason reason = SafeStateReason::InvalidConfiguration;
  MissionKey mission_key{};

  SafeStateRequest() = default;
  SafeStateRequest(SafeStateRequestId request_id, SafeStateReason request_reason,
                   MissionKey current_mission)
      : id(request_id), reason(request_reason), mission_key(current_mission) {}
};

enum class SafeStateResult : uint8_t { Rejected, Accepted };

enum class SafeStateExecutionStatus : uint8_t { Pending, Succeeded, Failed };

enum class ControllerState : uint8_t {
  Idle,
  Leading,
  AwaitingAcknowledgement,
  AwaitingAssignment,
  Active,
  Quiescent,
  SafeDisabled
};

} // namespace satellite_swarm

#endif
