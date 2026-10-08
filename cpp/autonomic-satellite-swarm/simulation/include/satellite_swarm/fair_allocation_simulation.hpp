#ifndef SATELLITE_SWARM_FAIR_ALLOCATION_SIMULATION_HPP
#define SATELLITE_SWARM_FAIR_ALLOCATION_SIMULATION_HPP

#include "satellite_swarm/simulation.hpp"

#include <string>

namespace satellite_swarm::simulation {

constexpr uint8_t kFairAllocationEvidenceSchemaVersion = 1U;

SimulationTrace makeFairAllocationTrace();
std::string serializeFairAllocationEvidence(const SimulationResult& result);
std::string runFairAllocationEvidence();

} // namespace satellite_swarm::simulation

#endif
