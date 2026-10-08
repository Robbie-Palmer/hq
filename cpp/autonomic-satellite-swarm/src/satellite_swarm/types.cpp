#include "satellite_swarm/types.hpp"

#include <math.h>

namespace satellite_swarm {

bool isValid(const MissionKey& mission_key) {
  return mission_key.origin_node < kMaximumNodes && mission_key.boot_epoch != 0U &&
         mission_key.sequence != 0U;
}

bool isValid(const Coordinate& coordinate) {
  return isfinite(coordinate.longitude_degrees) && isfinite(coordinate.latitude_degrees) &&
         coordinate.longitude_degrees >= -180.0F && coordinate.longitude_degrees <= 180.0F &&
         coordinate.latitude_degrees >= -90.0F && coordinate.latitude_degrees <= 90.0F;
}

bool isValid(const SatelliteSnapshot& satellite) {
  const bool valid_direction = satellite.travel_direction == TravelDirection::Northbound ||
                               satellite.travel_direction == TravelDirection::Southbound;
  return isValid(satellite.coordinate) && isfinite(satellite.orbital_radius_metres) &&
         isfinite(satellite.mass_kilograms) &&
         isfinite(satellite.available_propulsion_energy_joules) &&
         satellite.orbital_radius_metres > 0.0F && satellite.mass_kilograms > 0.0F &&
         satellite.available_propulsion_energy_joules > 0.0F && valid_direction;
}

Message Message::missionRequest(NodeId sender, MissionKey mission_key, Coordinate objective) {
  Message message;
  message.type = MessageType::MissionRequest;
  message.sender = sender;
  message.target = kBroadcastNode;
  message.mission_key = mission_key;
  message.objective = objective;
  return message;
}

Message Message::candidacy(NodeId sender, NodeId leader, MissionKey mission_key, uint8_t score) {
  Message message;
  message.type = MessageType::Candidacy;
  message.sender = sender;
  message.target = leader;
  message.mission_key = mission_key;
  message.score = score;
  return message;
}

Message Message::acknowledgement(NodeId sender, NodeId candidate, MissionKey mission_key) {
  Message message;
  message.type = MessageType::Acknowledgement;
  message.sender = sender;
  message.target = candidate;
  message.mission_key = mission_key;
  return message;
}

Message Message::assignment(NodeId sender, NodeId assignee, MissionKey mission_key) {
  Message message;
  message.type = MessageType::MissionAssignment;
  message.sender = sender;
  message.target = assignee;
  message.mission_key = mission_key;
  return message;
}

} // namespace satellite_swarm
