#ifndef SATELLITE_SWARM_BROWSER_SIMULATION_HPP
#define SATELLITE_SWARM_BROWSER_SIMULATION_HPP

#include "satellite_swarm/simulation.hpp"

#include <string>

namespace satellite_swarm::simulation {

constexpr uint8_t kBrowserSimulationSchemaVersion = 6U;
enum class BrowserScenario : uint8_t { Nominal = 0U, LostAssignment = 1U, SafeStateSuccess = 2U };

struct BrowserSimulation {
  BrowserScenario scenario = BrowserScenario::Nominal;
  SimulationTrace trace;
};

BrowserSimulation makeBrowserDemonstration(Coordinate objective,
                                           BrowserScenario scenario = BrowserScenario::Nominal);

std::string serializeBrowserSimulation(const BrowserSimulation& simulation,
                                       const SimulationResult& result);

std::string runBrowserDemonstration(Coordinate objective,
                                    BrowserScenario scenario = BrowserScenario::Nominal);

} // namespace satellite_swarm::simulation

#endif
