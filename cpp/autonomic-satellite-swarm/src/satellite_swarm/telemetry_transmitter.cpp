#include "satellite_swarm/telemetry_transmitter.hpp"

namespace satellite_swarm {

TelemetryTransmitter::TelemetryTransmitter(SwarmController& controller, TelemetrySink& sink,
                                           const TelemetryTransmitterConfig& config)
    : controller_(controller), sink_(sink),
      minimum_interval_ms_(config.minimum_interval_ms == 0U ? 1U : config.minimum_interval_ms) {}

TelemetryTransmitResult TelemetryTransmitter::update(uint32_t now_ms, bool channel_available) {
  TelemetryEvent event;
  if (!controller_.peekTelemetry(event)) {
    return TelemetryTransmitResult::NoTelemetry;
  }
  if (!channel_available) {
    return TelemetryTransmitResult::ChannelUnavailable;
  }
  if (has_attempted_ && now_ms - last_attempt_at_ms_ < minimum_interval_ms_) {
    return TelemetryTransmitResult::RateLimited;
  }

  has_attempted_ = true;
  last_attempt_at_ms_ = now_ms;
  increment(attempted_records_);
  if (!sink_.publish(event)) {
    increment(rejected_records_);
    return TelemetryTransmitResult::SinkRejected;
  }

  controller_.discardTelemetry();
  increment(sent_records_);
  return TelemetryTransmitResult::Sent;
}

void TelemetryTransmitter::increment(uint32_t& counter) {
  if (counter != UINT32_MAX) {
    ++counter;
  }
}

} // namespace satellite_swarm
