#ifndef SATELLITE_SWARM_TELEMETRY_TRANSMITTER_HPP
#define SATELLITE_SWARM_TELEMETRY_TRANSMITTER_HPP

#include "satellite_swarm/controller.hpp"
#include "satellite_swarm/interfaces.hpp"

#include <stdint.h>

namespace satellite_swarm {

struct TelemetryTransmitterConfig {
  uint32_t minimum_interval_ms = 1000U;
};

enum class TelemetryTransmitResult : uint8_t {
  NoTelemetry,
  ChannelUnavailable,
  RateLimited,
  Sent,
  SinkRejected
};

// Attempts at most one record per call. The platform grants channel_available only after any
// coordination or safety traffic that shares the same channel has been serviced.
class TelemetryTransmitter {
public:
  TelemetryTransmitter(SwarmController& controller, TelemetrySink& sink,
                       const TelemetryTransmitterConfig& config = TelemetryTransmitterConfig());

  TelemetryTransmitResult update(uint32_t now_ms, bool channel_available);

  uint32_t attemptedRecords() const { return attempted_records_; }
  uint32_t sentRecords() const { return sent_records_; }
  uint32_t rejectedRecords() const { return rejected_records_; }
  uint32_t minimumIntervalMs() const { return minimum_interval_ms_; }

private:
  SwarmController& controller_;
  TelemetrySink& sink_;
  uint32_t minimum_interval_ms_;
  uint32_t last_attempt_at_ms_ = 0U;
  uint32_t attempted_records_ = 0U;
  uint32_t sent_records_ = 0U;
  uint32_t rejected_records_ = 0U;
  bool has_attempted_ = false;

  static void increment(uint32_t& counter);
};

} // namespace satellite_swarm

#endif
