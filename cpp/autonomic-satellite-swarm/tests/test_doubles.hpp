#ifndef SATELLITE_SWARM_TEST_DOUBLES_HPP
#define SATELLITE_SWARM_TEST_DOUBLES_HPP

#include "satellite_swarm/interfaces.hpp"

#include <deque>
#include <vector>

namespace satellite_swarm::test {

class FakeTransport : public Transport {
public:
  bool send(const Message& message) override {
    sent.push_back(message);
    return send_succeeds;
  }

  bool receive(Message& message) override {
    if (incoming.empty()) {
      return false;
    }
    message = incoming.front();
    incoming.pop_front();
    return true;
  }

  void deliver(const Message& message) { incoming.push_back(message); }

  bool send_succeeds = true;
  std::deque<Message> incoming;
  std::vector<Message> sent;
};

class FakeHealthMonitor : public HealthMonitor {
public:
  HealthStatus poll() override { return current; }

  HealthStatus current = HealthStatus::Nominal;
};

class FixedScorer : public CandidacyScorer {
public:
  explicit FixedScorer(uint8_t fixed_score) : fixed_score_(fixed_score) {}

  uint8_t score(const SatelliteSnapshot&, const Coordinate&) const override { return fixed_score_; }

private:
  uint8_t fixed_score_;
};

class FakeSafeStateActuator : public SafeStateActuator {
public:
  SafeStateResult request(const SafeStateRequest& request) override {
    ++request_count;
    last_request = request;
    return result;
  }

  SafeStateExecutionStatus status(const SafeStateRequestId& request_id) override {
    ++status_count;
    last_status_request = request_id;
    return execution_status;
  }

  SafeStateResult result = SafeStateResult::Accepted;
  SafeStateExecutionStatus execution_status = SafeStateExecutionStatus::Pending;
  uint8_t request_count = 0U;
  uint8_t status_count = 0U;
  SafeStateRequest last_request{};
  SafeStateRequestId last_status_request{};
};

} // namespace satellite_swarm::test

#endif
