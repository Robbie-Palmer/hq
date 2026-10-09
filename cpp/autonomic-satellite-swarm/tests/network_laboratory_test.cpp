#include "satellite_swarm/network_laboratory.hpp"

#include <catch2/catch_test_macros.hpp>
#include <limits>
#include <stdexcept>
#include <string>
#include <vector>

using namespace satellite_swarm;
using namespace satellite_swarm::simulation;

namespace {

SimulationTrace twoNodeTrace(const SeededDeliveryFaults& faults) {
  SimulationTrace trace;
  trace.provenance = {"fault-unit", "test", "forced", 42U};
  trace.seeded_delivery_faults = faults;
  trace.record_delivery_decisions = true;
  trace.record_resource_samples = true;
  trace.controller.response_window_ms = 20U;
  trace.nodes = {{0U, SatelliteSnapshot()}, {1U, SatelliteSnapshot()}};
  for (uint32_t now_ms = 0U; now_ms <= 50U; now_ms += 10U) {
    SimulationFrame frame;
    frame.now_ms = now_ms;
    if (now_ms == 0U) {
      frame.mission_commands.push_back({0U, Coordinate(0.0F, -90.0F)});
    }
    trace.frames.push_back(frame);
  }
  return trace;
}

bool hasDecision(const SimulationResult& result, DeliveryDecisionType decision) {
  for (const SimulationEvent& event : result.events) {
    if (event.type == SimulationEventType::DeliveryDecision &&
        event.delivery_decision == decision) {
      return true;
    }
  }
  return false;
}

} // namespace

TEST_CASE("seeded delivery choices replay loss, delay, duplication, and reordering") {
  SECTION("loss") {
    const SimulationResult result =
        runSimulationTrace(twoNodeTrace({true, 10000U, 0U, 0U, 0U, 10U, 20U}));
    CHECK(hasDecision(result, DeliveryDecisionType::Drop));
  }
  SECTION("delay") {
    const SimulationResult result =
        runSimulationTrace(twoNodeTrace({true, 0U, 10000U, 0U, 0U, 10U, 20U}));
    CHECK(hasDecision(result, DeliveryDecisionType::Delay));
  }
  SECTION("duplication") {
    const SimulationResult result =
        runSimulationTrace(twoNodeTrace({true, 0U, 0U, 10000U, 0U, 10U, 20U}));
    CHECK(hasDecision(result, DeliveryDecisionType::Duplicate));
  }
  SECTION("reordering") {
    const SimulationResult result =
        runSimulationTrace(twoNodeTrace({true, 0U, 0U, 0U, 10000U, 10U, 20U}));
    CHECK(hasDecision(result, DeliveryDecisionType::Reorder));
  }
}

TEST_CASE("the laboratory records topology, lifecycle, pressure, compatibility, and resources") {
  NetworkLaboratoryConfig config;
  const ExperimentVariant variant{"baseline", ControllerConfig()};
  const LaboratoryRun run = runNetworkLaboratory(config, 7U, variant);

  bool stale_contact = false;
  bool asymmetric_contact = false;
  bool crash = false;
  bool reset = false;
  bool pressure = false;
  bool incompatible = false;
  bool resource = false;
  for (const SimulationEvent& event : run.result.events) {
    stale_contact = stale_contact || (event.type == SimulationEventType::ContactObserved &&
                                      event.planned_connected != event.connected);
    asymmetric_contact = asymmetric_contact ||
                         (event.type == SimulationEventType::ContactObserved &&
                          event.node_id == 1U && event.recipient_node == 0U && !event.connected);
    crash = crash || event.type == SimulationEventType::NodeCrashed;
    reset = reset || event.type == SimulationEventType::NodeReset;
    pressure = pressure || event.type == SimulationEventType::StoragePressureChanged;
    incompatible = incompatible || (event.type == SimulationEventType::MessageDropped &&
                                    event.drop_reason == MessageDropReason::IncompatibleProtocol);
    resource = resource || event.type == SimulationEventType::ResourceSample;
  }

  CHECK(stale_contact);
  CHECK(asymmetric_contact);
  CHECK(crash);
  CHECK(reset);
  CHECK(pressure);
  CHECK(incompatible);
  CHECK(resource);
  CHECK(run.trace.provenance.seed == 7U);
  CHECK(run.trace.nodes[2].protocol_version == 2U);
}

TEST_CASE("storage pressure rejects a delivery without growing the inbox") {
  SimulationTrace trace = twoNodeTrace(SeededDeliveryFaults());
  trace.nodes[1].receive_buffer_capacity = 0U;
  const SimulationResult result = runSimulationTrace(trace);

  bool pressure_drop = false;
  for (const SimulationEvent& event : result.events) {
    pressure_drop = pressure_drop || (event.type == SimulationEventType::MessageDropped &&
                                      event.recipient_node == 1U &&
                                      event.drop_reason == MessageDropReason::StoragePressure);
  }
  CHECK(pressure_drop);
  CHECK(result.frames.front().nodes[1].buffer_occupancy == 0U);
}

TEST_CASE("the same seed produces the same evidence and paired batches retain failures") {
  NetworkLaboratoryConfig config;
  const ExperimentVariant baseline{"baseline", ControllerConfig()};
  ExperimentVariant patient{"patient", ControllerConfig()};
  patient.controller.maximum_attempts = 6U;

  const LaboratoryRun first = runNetworkLaboratory(config, 11U, baseline);
  const LaboratoryRun replay = runNetworkLaboratory(config, 11U, baseline);
  const LaboratoryRun other = runNetworkLaboratory(config, 12U, baseline);
  CHECK(serializeLaboratoryRun(config, first) == serializeLaboratoryRun(config, replay));
  CHECK(serializeLaboratoryRun(config, first) != serializeLaboratoryRun(config, other));

  const BatchReport report = runPairedBatch(config, {baseline, patient}, {11U, 12U, 13U});
  CHECK(report.runs.size() == 6U);
  CHECK(report.summaries.size() == 2U);
  CHECK(report.worst_failures.size() == 2U);
  CHECK(report.worst_failures[0].trace.provenance.seed != 0U);
  const std::string json = serializeBatchReport(config, report);
  CHECK(json.find(R"("pairedSeeds":true)") != std::string::npos);
  CHECK(json.find(R"("rawRuns")") != std::string::npos);
  CHECK(json.find(R"("worstFailures")") != std::string::npos);
  CHECK(json.find(R"("lower")") != std::string::npos);
}

TEST_CASE("a laboratory trace serializes provenance and replayable evidence") {
  NetworkLaboratoryConfig config;
  config.code_revision = "0123456789abcdef";
  const LaboratoryRun run = runNetworkLaboratory(config, 99U, {"baseline", ControllerConfig()});
  const std::string json = serializeLaboratoryRun(config, run);

  CHECK(json.find(R"("schemaVersion":1)") != std::string::npos);
  CHECK(json.find(R"("traceVersion":6)") != std::string::npos);
  CHECK(json.find(R"("codeRevision":"0123456789abcdef")") != std::string::npos);
  CHECK(json.find(R"("seed":99)") != std::string::npos);
  CHECK(json.find(R"("delivery-decision")") != std::string::npos);
  CHECK(json.find(R"("contact-observed")") != std::string::npos);
  CHECK(json.find(R"("resource-sample")") != std::string::npos);
  CHECK(json.find(R"("metrics")") != std::string::npos);
}

TEST_CASE("optional laboratory faults can all be disabled") {
  NetworkLaboratoryConfig config;
  config.include_stale_contacts = false;
  config.include_partition = false;
  config.include_asymmetric_partition = false;
  config.include_crash_and_reset = false;
  config.include_storage_pressure = false;
  config.include_mixed_protocol_versions = false;
  config.delivery_faults.enabled = false;

  const LaboratoryRun run = runNetworkLaboratory(config, 5U, {"plain", ControllerConfig()});
  for (const NodeConfiguration& node : run.trace.nodes) {
    CHECK(node.protocol_version == 1U);
  }
  for (const SimulationEvent& event : run.result.events) {
    CHECK(event.type != SimulationEventType::ContactObserved);
    CHECK(event.type != SimulationEventType::NodeCrashed);
    CHECK(event.type != SimulationEventType::StoragePressureChanged);
  }
}

TEST_CASE("laboratory and batch inputs reject incomplete contracts") {
  NetworkLaboratoryConfig config;

  SECTION("scenario version") {
    config.version = 0U;
    CHECK_THROWS_AS(makeNetworkLaboratoryTrace(config, 1U), std::invalid_argument);
  }
  SECTION("zero time step") {
    config.step_ms = 0U;
    CHECK_THROWS_AS(makeNetworkLaboratoryTrace(config, 1U), std::invalid_argument);
  }
  SECTION("short scenario") {
    config.duration_ms = 190U;
    CHECK_THROWS_AS(makeNetworkLaboratoryTrace(config, 1U), std::invalid_argument);
  }
  SECTION("partial final frame") {
    config.duration_ms = 305U;
    CHECK_THROWS_AS(makeNetworkLaboratoryTrace(config, 1U), std::invalid_argument);
  }
  SECTION("missing variant ID") {
    CHECK_THROWS_AS(runNetworkLaboratory(config, 1U, ExperimentVariant()), std::invalid_argument);
  }
  SECTION("missing variants") {
    CHECK_THROWS_AS(runPairedBatch(config, {}, {1U}), std::invalid_argument);
  }
  SECTION("missing seeds") {
    CHECK_THROWS_AS(runPairedBatch(config, {{"baseline", ControllerConfig()}}, {}),
                    std::invalid_argument);
  }
}

TEST_CASE("extended simulation faults reject malformed inputs") {
  SECTION("probabilities exceed one") {
    SimulationTrace trace = twoNodeTrace({true, 5001U, 5000U, 0U, 0U, 1U, 2U});
    CHECK_THROWS_AS(runSimulationTrace(trace), std::invalid_argument);
  }
  SECTION("zero minimum delay") {
    SimulationTrace trace = twoNodeTrace({true, 0U, 1U, 0U, 0U, 0U, 2U});
    CHECK_THROWS_AS(runSimulationTrace(trace), std::invalid_argument);
  }
  SECTION("backward delay range") {
    SimulationTrace trace = twoNodeTrace({true, 0U, 1U, 0U, 0U, 2U, 1U});
    CHECK_THROWS_AS(runSimulationTrace(trace), std::invalid_argument);
  }
  SECTION("ambiguous delay") {
    SimulationTrace trace =
        twoNodeTrace({true, 0U, 1U, 0U, 0U, 1U,
                      static_cast<uint32_t>(std::numeric_limits<int32_t>::max()) + 1U});
    CHECK_THROWS_AS(runSimulationTrace(trace), std::invalid_argument);
  }
  SECTION("zero protocol version") {
    SimulationTrace trace = twoNodeTrace(SeededDeliveryFaults());
    trace.nodes[1].protocol_version = 0U;
    CHECK_THROWS_AS(runSimulationTrace(trace), std::invalid_argument);
  }
  SECTION("contact targets sender") {
    SimulationTrace trace = twoNodeTrace(SeededDeliveryFaults());
    trace.frames.front().contact_updates.push_back({0U, 0U, true, true});
    CHECK_THROWS_AS(runSimulationTrace(trace), std::invalid_argument);
  }
  SECTION("pressure references unknown node") {
    SimulationTrace trace = twoNodeTrace(SeededDeliveryFaults());
    trace.frames.front().storage_pressure_updates.push_back({9U, 1U});
    CHECK_THROWS_AS(runSimulationTrace(trace), std::invalid_argument);
  }
  SECTION("crash references unknown node") {
    SimulationTrace trace = twoNodeTrace(SeededDeliveryFaults());
    trace.frames.front().node_crashes.push_back({9U});
    CHECK_THROWS_AS(runSimulationTrace(trace), std::invalid_argument);
  }
}

TEST_CASE("extended trace validation rejects malformed lifecycle inputs") {
  SECTION("unsupported trace version") {
    SimulationTrace trace = twoNodeTrace(SeededDeliveryFaults());
    trace.version = 0U;
    CHECK_THROWS_AS(runSimulationTrace(trace), std::invalid_argument);
  }
  SECTION("missing nodes") {
    SimulationTrace trace = twoNodeTrace(SeededDeliveryFaults());
    trace.nodes.clear();
    CHECK_THROWS_AS(runSimulationTrace(trace), std::invalid_argument);
  }
  SECTION("unordered nodes") {
    SimulationTrace trace = twoNodeTrace(SeededDeliveryFaults());
    trace.nodes[1].node_id = 0U;
    CHECK_THROWS_AS(runSimulationTrace(trace), std::invalid_argument);
  }
  SECTION("invalid initial satellite") {
    SimulationTrace trace = twoNodeTrace(SeededDeliveryFaults());
    trace.nodes[0].satellite.mass_kilograms = 0.0F;
    CHECK_THROWS_AS(runSimulationTrace(trace), std::invalid_argument);
  }
  SECTION("zero boot epoch") {
    SimulationTrace trace = twoNodeTrace(SeededDeliveryFaults());
    trace.nodes[0].boot_epoch = 0U;
    CHECK_THROWS_AS(runSimulationTrace(trace), std::invalid_argument);
  }
  SECTION("unknown safe-state result") {
    SimulationTrace trace = twoNodeTrace(SeededDeliveryFaults());
    trace.nodes[0].safe_state_request_result = static_cast<SafeStateResult>(255U);
    CHECK_THROWS_AS(runSimulationTrace(trace), std::invalid_argument);
  }
  SECTION("invalid satellite update") {
    SimulationTrace trace = twoNodeTrace(SeededDeliveryFaults());
    SatelliteSnapshot invalid;
    invalid.mass_kilograms = 0.0F;
    trace.frames.front().satellite_updates.push_back({0U, invalid});
    CHECK_THROWS_AS(runSimulationTrace(trace), std::invalid_argument);
  }
  SECTION("unknown health update") {
    SimulationTrace trace = twoNodeTrace(SeededDeliveryFaults());
    trace.frames.front().health_updates.push_back({0U, static_cast<HealthStatus>(255U)});
    CHECK_THROWS_AS(runSimulationTrace(trace), std::invalid_argument);
  }
  SECTION("unknown safe-state status") {
    SimulationTrace trace = twoNodeTrace(SeededDeliveryFaults());
    trace.frames.front().safe_state_status_updates.push_back(
        {0U, static_cast<SafeStateExecutionStatus>(255U)});
    CHECK_THROWS_AS(runSimulationTrace(trace), std::invalid_argument);
  }
  SECTION("self-directed link") {
    SimulationTrace trace = twoNodeTrace(SeededDeliveryFaults());
    trace.frames.front().link_updates.push_back({0U, 0U, false});
    CHECK_THROWS_AS(runSimulationTrace(trace), std::invalid_argument);
  }
  SECTION("invalid mission objective") {
    SimulationTrace trace = twoNodeTrace(SeededDeliveryFaults());
    trace.frames.front().mission_commands.front().objective = Coordinate(181.0F, 0.0F);
    CHECK_THROWS_AS(runSimulationTrace(trace), std::invalid_argument);
  }
  SECTION("unmatched scripted fault") {
    SimulationTrace trace = twoNodeTrace(SeededDeliveryFaults());
    trace.frames.front().mission_commands.clear();
    trace.frames.front().delivery_faults.push_back(
        {0U, 1U, MessageType::MissionRequest, DeliveryFaultType::Drop, 0U});
    CHECK_THROWS_AS(runSimulationTrace(trace), std::invalid_argument);
  }
}

TEST_CASE("a fixed seeded delay remains replayable") {
  const SimulationResult result =
      runSimulationTrace(twoNodeTrace({true, 0U, 10000U, 0U, 0U, 10U, 10U}));
  CHECK(hasDecision(result, DeliveryDecisionType::Delay));
}

TEST_CASE("a delayed delivery records a recipient crash at release time") {
  SimulationTrace trace = twoNodeTrace(SeededDeliveryFaults());
  trace.frames.front().delivery_faults.push_back(
      {0U, 1U, MessageType::MissionRequest, DeliveryFaultType::Delay, 10U});
  trace.frames[1].node_crashes.push_back({1U});
  const SimulationResult result = runSimulationTrace(trace);

  bool crash_drop = false;
  for (const SimulationEvent& event : result.events) {
    crash_drop = crash_drop || (event.type == SimulationEventType::MessageDropped &&
                                event.drop_reason == MessageDropReason::NodeCrashed);
  }
  CHECK(crash_drop);
}

TEST_CASE("one paired seed produces zero-width confidence intervals") {
  NetworkLaboratoryConfig config;
  const BatchReport report = runPairedBatch(config, {{"baseline", ControllerConfig()}}, {3U});
  REQUIRE(report.summaries.size() == 1U);
  const VariantSummary& summary = report.summaries.front();
  CHECK(summary.mission_completion_rate.lower == summary.mission_completion_rate.mean);
  CHECK(summary.mission_completion_rate.upper == summary.mission_completion_rate.mean);
}

TEST_CASE("run measurement keeps unsafe and empty outcomes separate") {
  SimulationTrace trace;
  trace.nodes = {{0U, SatelliteSnapshot()}, {1U, SatelliteSnapshot()}};
  SimulationResult result;
  FrameObservation frame;
  frame.nodes = {
      {0U, ControllerState::Active, SatelliteSnapshot(), 1U, MissionKey(0U, 1U, 1U), 0U},
      {1U, ControllerState::Active, SatelliteSnapshot(), 1U, MissionKey(0U, 1U, 1U), 1U},
  };
  result.frames.push_back(frame);
  SimulationEvent command;
  command.type = SimulationEventType::MissionCommand;
  command.accepted = true;
  result.events.push_back(command);
  SimulationEvent delivered;
  delivered.type = SimulationEventType::MessageDelivered;
  result.events.push_back(delivered);
  SimulationEvent sample;
  sample.type = SimulationEventType::ResourceSample;
  sample.node_id = 0U;
  sample.bytes_sent = 18U;
  sample.estimated_energy_millijoules = 1.44;
  result.events.push_back(sample);

  const RunMetrics metrics = measureRun(trace, result);
  CHECK(metrics.safety_violations == 1U);
  CHECK(metrics.liveness_failures == 1U);
  CHECK(metrics.deliveries == 1U);
  CHECK(metrics.bytes_sent == 18U);
  CHECK(metrics.energy_per_delivered_byte_millijoules == 0.0);
}

TEST_CASE("run measurement identifies malformed active claims without a command history") {
  SimulationTrace trace;
  trace.nodes = {{0U, SatelliteSnapshot()}, {1U, SatelliteSnapshot()}};
  SimulationResult result;
  FrameObservation frame;
  frame.nodes = {
      {0U, ControllerState::Active, SatelliteSnapshot(), 1U, MissionKey(), 0U},
      {1U, ControllerState::Active, SatelliteSnapshot(), 1U, MissionKey(0U, 1U, 2U), 0U},
  };
  result.frames.push_back(frame);
  SimulationEvent active;
  active.type = SimulationEventType::StateChanged;
  active.current_state = ControllerState::Active;
  active.now_ms = 25U;
  active.mission_key = MissionKey(0U, 1U, 2U);
  result.events.push_back(active);

  const RunMetrics metrics = measureRun(trace, result);
  CHECK(metrics.safety_violations == 2U);
  CHECK(metrics.missions_completed == 1U);
  CHECK(metrics.mean_assignment_latency_ms == 0.0);
}

TEST_CASE("laboratory serialization names every evidence branch") {
  NetworkLaboratoryConfig config;
  config.scenario_id = "quoted-\"scenario\\id";
  LaboratoryRun run;
  run.variant_id = "synthetic";
  run.trace.provenance = {config.scenario_id, "test", "synthetic", 8U};
  run.trace.nodes = {{0U, SatelliteSnapshot()}, {1U, SatelliteSnapshot()}};

  const std::vector<SimulationEventType> simple_types = {
      SimulationEventType::MissionCompletion, SimulationEventType::MessageSent,
      SimulationEventType::LinkChanged, SimulationEventType::StateChanged,
      SimulationEventType::ControllerTelemetry};
  for (const SimulationEventType type : simple_types) {
    SimulationEvent event;
    event.type = type;
    run.result.events.push_back(event);
  }
  for (uint8_t value = 0U; value <= static_cast<uint8_t>(DeliveryDecisionType::Reorder); ++value) {
    SimulationEvent event;
    event.type = SimulationEventType::DeliveryDecision;
    event.delivery_decision = static_cast<DeliveryDecisionType>(value);
    event.deliver_at_ms = 10U;
    run.result.events.push_back(event);
  }
  const std::vector<SimulationEventType> delivery_types = {
      SimulationEventType::MessageDelivered, SimulationEventType::DelayedMessageDelivered,
      SimulationEventType::MessageDelayed, SimulationEventType::MessageDuplicated};
  for (const SimulationEventType type : delivery_types) {
    SimulationEvent event;
    event.type = type;
    run.result.events.push_back(event);
  }
  for (uint8_t value = 0U; value <= static_cast<uint8_t>(MessageDropReason::IncompatibleProtocol);
       ++value) {
    SimulationEvent event;
    event.type = SimulationEventType::MessageDropped;
    event.drop_reason = static_cast<MessageDropReason>(value);
    run.result.events.push_back(event);
  }
  SimulationEvent contact;
  contact.type = SimulationEventType::ContactObserved;
  contact.connected = false;
  run.result.events.push_back(contact);
  SimulationEvent sample;
  sample.type = SimulationEventType::ResourceSample;
  run.result.events.push_back(sample);
  SimulationEvent pressure;
  pressure.type = SimulationEventType::StoragePressureChanged;
  run.result.events.push_back(pressure);
  SimulationEvent crash;
  crash.type = SimulationEventType::NodeCrashed;
  crash.running = false;
  run.result.events.push_back(crash);
  SimulationEvent reset;
  reset.type = SimulationEventType::NodeReset;
  run.result.events.push_back(reset);
  SimulationEvent command;
  command.type = SimulationEventType::MissionCommand;
  run.result.events.push_back(command);
  SimulationEvent unknown_event;
  unknown_event.type = static_cast<SimulationEventType>(255U);
  run.result.events.push_back(unknown_event);
  SimulationEvent unknown_decision;
  unknown_decision.type = SimulationEventType::DeliveryDecision;
  unknown_decision.delivery_decision = static_cast<DeliveryDecisionType>(255U);
  run.result.events.push_back(unknown_decision);
  SimulationEvent unknown_reason;
  unknown_reason.type = SimulationEventType::MessageDropped;
  unknown_reason.drop_reason = static_cast<MessageDropReason>(255U);
  run.result.events.push_back(unknown_reason);

  const std::string json = serializeLaboratoryRun(config, run);
  CHECK(json.find(R"(quoted-\"scenario\\id)") != std::string::npos);
  CHECK(json.find(R"("decision":"reorder")") != std::string::npos);
  CHECK(json.find(R"("reason":"storage-pressure")") != std::string::npos);
  CHECK(json.find(R"("type":"node-crashed")") != std::string::npos);
  CHECK(json.find(R"("type":"unknown")") != std::string::npos);
  CHECK(json.find(R"("decision":"unknown")") != std::string::npos);
  CHECK(json.find(R"("reason":"unknown")") != std::string::npos);
}
