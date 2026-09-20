#ifndef SATELLITE_SWARM_INTERFACES_HPP
#define SATELLITE_SWARM_INTERFACES_HPP

#include "satellite_swarm/types.hpp"

namespace satellite_swarm {

struct TelemetryEvent;

class Transport {
public:
  virtual ~Transport() = default;

  virtual bool send(const Message& message) = 0;
  virtual bool receive(Message& message) = 0;
};

class HealthMonitor {
public:
  virtual ~HealthMonitor() = default;

  virtual HealthStatus poll() = 0;
};

class CandidacyScorer {
public:
  virtual ~CandidacyScorer() = default;

  // The controller constrains implementations' results to the protocol's 0..100 score range.
  virtual uint8_t score(const SatelliteSnapshot& satellite, const Coordinate& objective) const = 0;
};

class SafeStateActuator {
public:
  virtual ~SafeStateActuator() = default;

  // Requests must be idempotent by request ID and must return without blocking controller work.
  virtual SafeStateResult request(const SafeStateRequest& request) = 0;
  // Status checks must return without blocking. The controller stops polling after a terminal
  // result, so implementations must retain that result for the request's lifetime.
  virtual SafeStateExecutionStatus status(const SafeStateRequestId& request_id) = 0;
};

class TelemetrySink {
public:
  virtual ~TelemetrySink() = default;

  // Implementations must copy the event before returning if publication continues asynchronously.
  virtual bool publish(const TelemetryEvent& event) = 0;
};

} // namespace satellite_swarm

#endif
