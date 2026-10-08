#ifndef SATELLITE_SWARM_TELEMETRY_CODEC_HPP
#define SATELLITE_SWARM_TELEMETRY_CODEC_HPP

#include "satellite_swarm/telemetry.hpp"

#include <stddef.h>
#include <stdint.h>

namespace satellite_swarm {

class TelemetryCodec {
public:
  static const size_t kFrameSize = 34U;

  static bool encode(const TelemetryEvent& event, uint8_t* output, size_t output_size);
  static bool decode(const uint8_t* frame, size_t frame_size, TelemetryEvent& event);

private:
  static uint8_t checksum(const uint8_t* bytes, size_t size);
};

} // namespace satellite_swarm

#endif
