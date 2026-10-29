#include "satellite_swarm/resource_observer.hpp"
#include "satellite_swarm/satellite_swarm.hpp"

#include <chrono>
#include <cstddef>
#include <iostream>
#include <stdint.h>

namespace {

constexpr uint32_t kWarmupIterations = 10000U;
constexpr uint32_t kMeasuredIterations = 50000U;

class EmptyTransport : public satellite_swarm::Transport {
public:
  bool send(const satellite_swarm::Message&) override { return true; }
  bool receive(satellite_swarm::Message&) override { return false; }
};

class CountingHealthMonitor : public satellite_swarm::HealthMonitor {
public:
  satellite_swarm::HealthStatus poll() override {
    ++polls;
    return satellite_swarm::HealthStatus::Nominal;
  }

  uint32_t polls = 0U;
};

class FixedScorer : public satellite_swarm::CandidacyScorer {
public:
  uint8_t score(const satellite_swarm::SatelliteSnapshot&,
                const satellite_swarm::Coordinate&) const override {
    return 50U;
  }
};

} // namespace

int main() {
  EmptyTransport transport;
  CountingHealthMonitor health;
  FixedScorer scorer;
  satellite_swarm::SwarmController controller(0U, 1U, satellite_swarm::SatelliteSnapshot(),
                                              transport, health, scorer);

  for (uint32_t iteration = 0U; iteration < kWarmupIterations; ++iteration) {
    controller.update(iteration);
  }

  uint64_t worst_nanoseconds = 0U;
  const auto total_started_at = std::chrono::steady_clock::now();
  for (uint32_t iteration = 0U; iteration < kMeasuredIterations; ++iteration) {
    const auto started_at = std::chrono::steady_clock::now();
    controller.update(iteration + kWarmupIterations);
    const auto elapsed = std::chrono::duration_cast<std::chrono::nanoseconds>(
        std::chrono::steady_clock::now() - started_at);
    const auto elapsed_nanoseconds = static_cast<uint64_t>(elapsed.count());
    if (elapsed_nanoseconds > worst_nanoseconds) {
      worst_nanoseconds = elapsed_nanoseconds;
    }
  }
  const auto total_elapsed = std::chrono::duration_cast<std::chrono::nanoseconds>(
      std::chrono::steady_clock::now() - total_started_at);

  std::cout << R"({"profile":"host-idle-controller","iterations":)" << kMeasuredIterations
            << R"(,"controllerBytes":)" << sizeof(satellite_swarm::SwarmController)
            << R"(,"resourceObservationBytes":)" << sizeof(satellite_swarm::ResourceObservation)
            << R"(,"totalNanoseconds":)" << total_elapsed.count()
            << R"(,"worstObservedUpdateNanoseconds":)" << worst_nanoseconds
            << R"(,"worstObservedStackBytes":null,"healthPolls":)" << health.polls << "}\n";
  return 0;
}
