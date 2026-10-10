#ifndef SATELLITE_SWARM_NETWORK_LABORATORY_HPP
#define SATELLITE_SWARM_NETWORK_LABORATORY_HPP

#include "satellite_swarm/simulation.hpp"

#include <stdint.h>
#include <string>
#include <vector>

namespace satellite_swarm::simulation {

constexpr uint8_t kNetworkScenarioVersion = 1U;
constexpr uint8_t kLaboratoryTraceSchemaVersion = 1U;
constexpr uint8_t kBatchReportSchemaVersion = 1U;

struct NetworkLaboratoryConfig {
  uint8_t version = kNetworkScenarioVersion;
  std::string scenario_id = "network-laboratory-v1";
  std::string code_revision = "unknown";
  std::string configuration_id = "default-fault-profile";
  uint32_t duration_ms = 300U;
  uint32_t step_ms = 10U;
  uint32_t response_window_ms = 100U;
  bool include_stale_contacts = true;
  bool include_partition = true;
  bool include_asymmetric_partition = true;
  bool include_crash_and_reset = true;
  bool include_storage_pressure = true;
  bool include_mixed_protocol_versions = true;
  SeededDeliveryFaults delivery_faults{true, 800U, 900U, 500U, 500U, 10U, 40U};
  PacketNetworkConfig packet_network{true, 14400U, 2U, 8U, 0.08, 0.04};
};

struct ExperimentVariant {
  std::string id;
  ControllerConfig controller{};
};

struct RunMetrics {
  uint32_t safety_violations = 0U;
  uint32_t liveness_failures = 0U;
  uint32_t missions_started = 0U;
  uint32_t missions_completed = 0U;
  double mean_assignment_latency_ms = 0.0;
  uint64_t deliveries = 0U;
  uint64_t delivery_failures = 0U;
  uint64_t bytes_sent = 0U;
  uint64_t bytes_received = 0U;
  uint64_t bytes_dropped = 0U;
  uint64_t useful_bytes_delivered = 0U;
  uint16_t peak_buffer_occupancy = 0U;
  uint16_t peak_transmit_queue_occupancy = 0U;
  uint64_t airtime_microseconds = 0U;
  double estimated_energy_millijoules = 0.0;
  double energy_per_delivered_byte_millijoules = 0.0;
};

struct LaboratoryRun {
  std::string variant_id;
  SimulationTrace trace;
  SimulationResult result;
  RunMetrics metrics;
};

struct ConfidenceInterval {
  double mean = 0.0;
  double lower = 0.0;
  double upper = 0.0;
};

struct VariantSummary {
  std::string variant_id;
  ConfidenceInterval mission_completion_rate;
  ConfidenceInterval assignment_latency_ms;
  ConfidenceInterval delivery_ratio;
  ConfidenceInterval energy_per_delivered_byte_millijoules;
};

struct RegressionFixture {
  std::string variant_id;
  uint64_t seed = 0U;
  SimulationTrace trace;
  RunMetrics metrics;
};

struct BatchReport {
  std::vector<LaboratoryRun> runs;
  std::vector<VariantSummary> summaries;
  std::vector<RegressionFixture> worst_failures;
};

SimulationTrace makeNetworkLaboratoryTrace(const NetworkLaboratoryConfig& config, uint64_t seed,
                                           const ControllerConfig& controller = ControllerConfig());
RunMetrics measureRun(const SimulationTrace& trace, const SimulationResult& result);
LaboratoryRun runNetworkLaboratory(const NetworkLaboratoryConfig& config, uint64_t seed,
                                   const ExperimentVariant& variant);
BatchReport runPairedBatch(const NetworkLaboratoryConfig& config,
                           const std::vector<ExperimentVariant>& variants,
                           const std::vector<uint64_t>& seeds);

std::string serializeLaboratoryRun(const NetworkLaboratoryConfig& config, const LaboratoryRun& run);
std::string serializeBatchReport(const NetworkLaboratoryConfig& config, const BatchReport& report);

} // namespace satellite_swarm::simulation

#endif
