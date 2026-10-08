#include "satellite_swarm/telemetry.hpp"

namespace satellite_swarm {

void BoundedTelemetryBuffer::countDrop() {
  if (dropped_events_ != UINT32_MAX) {
    ++dropped_events_;
  }
}

void BoundedTelemetryBuffer::erase(uint8_t index) {
  if (index >= size_) {
    return;
  }
  for (uint8_t current = index; current + 1U < size_; ++current) {
    events_[current] = events_[static_cast<uint8_t>(current + 1U)];
  }
  --size_;
}

bool BoundedTelemetryBuffer::record(const TelemetryEvent& event) {
  // Zero is reserved. Failing closed here preserves record identity within a boot without
  // widening every buffered record on SRAM-constrained targets.
  if (next_sequence_ == 0U) {
    countDrop();
    return false;
  }

  const uint32_t sequence = next_sequence_;
  next_sequence_ = next_sequence_ == UINT32_MAX ? 0U : next_sequence_ + 1U;

  if (size_ == kTelemetryBufferCapacity) {
    uint8_t eviction = kTelemetryBufferCapacity;
    TelemetryPriority lowest_priority = event.priority;
    for (uint8_t index = 0U; index < size_; ++index) {
      if (events_[index].priority < event.priority &&
          (eviction == kTelemetryBufferCapacity || events_[index].priority < lowest_priority)) {
        eviction = index;
        lowest_priority = events_[index].priority;
      }
    }
    if (eviction == kTelemetryBufferCapacity) {
      countDrop();
      return false;
    }
    erase(eviction);
    countDrop();
  }

  events_[size_] = event;
  events_[size_].sequence = sequence;
  events_[size_].dropped_before = dropped_events_;
  ++size_;
  return true;
}

bool BoundedTelemetryBuffer::read(TelemetryEvent& event) {
  if (!peek(event)) {
    return false;
  }
  return discard();
}

bool BoundedTelemetryBuffer::peek(TelemetryEvent& event) const {
  if (size_ == 0U) {
    return false;
  }
  event = events_[0];
  return true;
}

bool BoundedTelemetryBuffer::discard() {
  if (size_ == 0U) {
    return false;
  }
  erase(0U);
  return true;
}

} // namespace satellite_swarm
