#include "satellite_swarm/browser_simulation.hpp"
#include "satellite_swarm/fair_allocation_simulation.hpp"
#include "satellite_swarm/network_laboratory.hpp"

#include <charconv>
#include <exception>
#include <iostream>
#include <string>
#include <string_view>
#include <vector>

#ifndef SATELLITE_SWARM_SOURCE_REVISION
#define SATELLITE_SWARM_SOURCE_REVISION "unknown"
#endif

namespace {

using namespace satellite_swarm;
using namespace satellite_swarm::simulation;

const char* stateName(ControllerState state) {
  switch (state) {
  case ControllerState::Idle:
    return "idle";
  case ControllerState::Leading:
    return "leading";
  case ControllerState::AwaitingAcknowledgement:
    return "awaiting acknowledgement";
  case ControllerState::AwaitingAssignment:
    return "awaiting assignment";
  case ControllerState::Active:
    return "active";
  case ControllerState::Quiescent:
    return "quiescent";
  case ControllerState::SafeDisabled:
    return "safe-disabled";
  }
  return "unknown";
}

int runSimulation(bool json, bool fairness_json) {
  if (fairness_json) {
    std::cout << runFairAllocationEvidence();
    return 0;
  }

  const Coordinate kSouthPole(0.0F, -90.0F);
  const BrowserSimulation simulation = makeBrowserDemonstration(kSouthPole);
  const SimulationResult result = runSimulationTrace(simulation.trace);
  if (json) {
    std::cout << serializeBrowserSimulation(simulation, result);
    return 0;
  }

  const FrameObservation& final_frame = result.frames.back();
  const NodeObservation& leader = final_frame.nodes.front();
  std::cout << "Mission " << static_cast<unsigned int>(leader.mission_key.origin_node) << ':'
            << leader.mission_key.boot_epoch << ':' << leader.mission_key.sequence
            << " assigned to node " << static_cast<unsigned int>(leader.assigned_node) << '\n';
  for (const NodeObservation& node : final_frame.nodes) {
    std::cout << "node " << static_cast<unsigned int>(node.node_id) << ": " << stateName(node.state)
              << '\n';
  }

  const auto assigned_index = static_cast<std::size_t>(leader.assigned_node);
  return assigned_index < final_frame.nodes.size() &&
                 final_frame.nodes[assigned_index].state == ControllerState::Active
             ? 0
             : 1;
}

uint64_t parseSeed(std::string_view value) {
  const std::string text(value);
  uint64_t seed = 0U;
  const char* const end = text.data() + text.size();
  const auto result = std::from_chars(text.data(), end, seed);
  if (result.ec != std::errc() || result.ptr != end || seed == 0U) {
    throw std::invalid_argument("laboratory seed must be a positive integer");
  }
  return seed;
}

int runLaboratory(bool batch, uint64_t seed = 1U) {
  NetworkLaboratoryConfig config;
  config.code_revision = SATELLITE_SWARM_SOURCE_REVISION;
  if (!batch) {
    const ExperimentVariant variant{"baseline", ControllerConfig()};
    std::cout << serializeLaboratoryRun(config, runNetworkLaboratory(config, seed, variant));
    return 0;
  }

  ExperimentVariant baseline{"baseline", ControllerConfig()};
  ExperimentVariant patient{"patient-retry", ControllerConfig()};
  patient.controller.maximum_attempts = 6U;
  patient.controller.retry_interval_ms = 200U;
  std::vector<uint64_t> seeds;
  for (uint64_t seed = 1U; seed <= 32U; ++seed) {
    seeds.push_back(seed);
  }
  const BatchReport report = runPairedBatch(config, {baseline, patient}, seeds);
  std::cout << serializeBatchReport(config, report);
  return 0;
}

} // namespace

int main(int argc, char* argv[]) {
  try {
    const bool json = argc == 2 && std::string_view(argv[1]) == "--json";
    const bool fairness_json = argc == 2 && std::string_view(argv[1]) == "--fairness-json";
    const bool laboratory_json =
        (argc == 2 || argc == 3) && std::string_view(argv[1]) == "--laboratory-json";
    const bool batch_json = argc == 2 && std::string_view(argv[1]) == "--batch-json";
    if (argc > 3 || (argc == 3 && !laboratory_json) ||
        (argc == 2 && !json && !fairness_json && !laboratory_json && !batch_json)) {
      std::cerr << "usage: autonomic-satellite-swarm-simulation "
                   "[--json|--fairness-json|--laboratory-json [seed]|--batch-json]\n";
      return 2;
    }
    if (laboratory_json || batch_json) {
      const uint64_t seed = argc == 3 ? parseSeed(argv[2]) : 1U;
      return runLaboratory(batch_json, seed);
    }
    return runSimulation(json, fairness_json);
  } catch (const std::exception& error) {
    std::cerr << "simulation setup failed: " << error.what() << '\n';
    return 1;
  }
}
