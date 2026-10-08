#ifndef SATELLITE_SWARM_WIRE_CODEC_HPP
#define SATELLITE_SWARM_WIRE_CODEC_HPP

#include "satellite_swarm/types.hpp"

#include <stddef.h>
#include <stdint.h>

namespace satellite_swarm {

class WireCodec {
public:
  static const size_t kPacketSize = 18;

  static bool encode(const Message& message, uint8_t* output, size_t output_size);
  static bool decode(const uint8_t* packet, size_t packet_size, Message& message);

private:
  static uint8_t checksum(const uint8_t* bytes, size_t size);
};

} // namespace satellite_swarm

#endif
