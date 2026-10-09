#include "satellite_swarm/network_laboratory.hpp"
#include "satellite_swarm/wire_codec.hpp"

#include <catch2/catch_test_macros.hpp>
#include <limits>
#include <stdexcept>
#include <string>
#include <utility>
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

SimulationTrace packetNetworkTrace() {
  SimulationTrace trace;
  trace.provenance = {"packet-network-unit", "test", "packet-network", 23U};
  trace.packet_network = {true, 14400U, 0U, 8U, 0.08, 0.04};
  trace.record_delivery_decisions = true;
  trace.record_resource_samples = true;
  trace.controller.response_window_ms = 100U;
  trace.nodes = {
      {0U, SatelliteSnapshot()},
      {1U, SatelliteSnapshot()},
      {2U, SatelliteSnapshot()},
  };
  for (uint32_t now_ms = 0U; now_ms <= 200U; now_ms += 10U) {
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

NodeObservation activeObservation(NodeId node_id, MissionKey mission_key, NodeId assigned_node) {
  NodeObservation observation;
  observation.node_id = node_id;
  observation.state = ControllerState::Active;
  observation.boot_epoch = 1U;
  observation.mission_key = mission_key;
  observation.assigned_node = assigned_node;
  return observation;
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

TEST_CASE("the packet network serializes wire packets on one deterministic shared medium") {
  const SimulationTrace trace = packetNetworkTrace();
  const SimulationResult result = runSimulationTrace(trace);

  std::vector<const SimulationEvent*> transmissions;
  for (const SimulationEvent& event : result.events) {
    if (event.type == SimulationEventType::TransmissionStarted) {
      transmissions.push_back(&event);
      CHECK(event.packet_id != 0U);
      CHECK(event.packet_size == WireCodec::kPacketSize);
      CHECK(event.airtime_microseconds == 10000U);
      CHECK(event.transmission_end_ms == event.now_ms + 10U);
    }
  }

  REQUIRE(transmissions.size() >= 2U);
  CHECK(transmissions.front()->node_id == 0U);
  for (std::size_t index = 1U; index < transmissions.size(); ++index) {
    CHECK(transmissions[index]->now_ms >= transmissions[index - 1U]->transmission_end_ms);
  }
  const RunMetrics metrics = measureRun(trace, result);
  CHECK(metrics.peak_buffer_occupancy >= 1U);
  CHECK(metrics.peak_transmit_queue_occupancy >= 1U);
  CHECK(metrics.useful_bytes_delivered > 0U);
  CHECK(metrics.energy_per_delivered_byte_millijoules > 0.0);
}

TEST_CASE("a frame link change applies before a transmission completing on the same tick") {
  SimulationTrace trace = twoNodeTrace(SeededDeliveryFaults());
  trace.packet_network.enabled = true;
  trace.packet_network.propagation_delay_ms = 0U;
  trace.frames[1].link_updates.push_back({0U, 1U, false});

  const SimulationResult result = runSimulationTrace(trace);

  bool completion_drop = false;
  for (const SimulationEvent& event : result.events) {
    completion_drop = completion_drop ||
                      (event.type == SimulationEventType::MessageDropped && event.now_ms == 10U &&
                       event.node_id == 0U && event.recipient_node == 1U &&
                       event.drop_reason == MessageDropReason::LinkUnavailable);
  }
  CHECK(completion_drop);
}

TEST_CASE("packet transmission completion remains ordered across clock rollover") {
  SimulationTrace trace;
  trace.packet_network.enabled = true;
  trace.record_delivery_decisions = true;
  trace.nodes = {{0U, SatelliteSnapshot()}, {1U, SatelliteSnapshot()}};
  SimulationFrame start;
  start.now_ms = std::numeric_limits<uint32_t>::max() - 5U;
  start.mission_commands.push_back({0U, Coordinate(0.0F, -90.0F)});
  trace.frames.push_back(start);
  SimulationFrame finish;
  finish.now_ms = 4U;
  trace.frames.push_back(finish);

  const SimulationResult result = runSimulationTrace(trace);

  bool completed = false;
  bool delivered = false;
  for (const SimulationEvent& event : result.events) {
    completed = completed ||
                (event.type == SimulationEventType::TransmissionCompleted && event.now_ms == 4U);
    delivered =
        delivered || (event.type == SimulationEventType::MessageDelivered && event.now_ms == 4U);
  }
  CHECK(completed);
  CHECK(delivered);
}

TEST_CASE("a receiver crash wins over a packet arriving on the same tick") {
  SimulationTrace trace = twoNodeTrace(SeededDeliveryFaults());
  trace.packet_network.enabled = true;
  trace.packet_network.propagation_delay_ms = 10U;
  trace.frames[2].node_crashes.push_back({1U});

  const SimulationResult result = runSimulationTrace(trace);

  bool arrival_drop = false;
  for (const SimulationEvent& event : result.events) {
    arrival_drop = arrival_drop || (event.type == SimulationEventType::MessageDropped &&
                                    event.now_ms == 20U && event.recipient_node == 1U &&
                                    event.drop_reason == MessageDropReason::NodeCrashed);
  }
  CHECK(arrival_drop);
}

TEST_CASE("a receiver crash wins over a transmission completing on the same tick") {
  SimulationTrace trace = twoNodeTrace(SeededDeliveryFaults());
  trace.packet_network.enabled = true;
  trace.frames[1].node_crashes.push_back({1U});

  const SimulationResult result = runSimulationTrace(trace);

  bool completion_drop = false;
  for (const SimulationEvent& event : result.events) {
    completion_drop = completion_drop || (event.type == SimulationEventType::MessageDropped &&
                                          event.now_ms == 10U && event.recipient_node == 1U &&
                                          event.drop_reason == MessageDropReason::NodeCrashed);
  }
  CHECK(completion_drop);
}

TEST_CASE("a sender crash clears its active transmission and queued packets") {
  SimulationTrace trace = packetNetworkTrace();
  trace.frames[1].node_crashes.push_back({0U});

  const SimulationResult result = runSimulationTrace(trace);

  uint32_t crash_drops = 0U;
  for (const SimulationEvent& event : result.events) {
    if (event.type == SimulationEventType::MessageDropped && event.now_ms == 10U &&
        event.node_id == 0U && event.drop_reason == MessageDropReason::NodeCrashed) {
      ++crash_drops;
    }
  }
  CHECK(crash_drops == 2U);
}

TEST_CASE("packet delivery choices replay every seeded fault branch") {
  const std::vector<std::pair<SeededDeliveryFaults, DeliveryDecisionType>> cases = {
      {{true, 10000U, 0U, 0U, 0U, 10U, 20U}, DeliveryDecisionType::Drop},
      {{true, 0U, 10000U, 0U, 0U, 10U, 20U}, DeliveryDecisionType::Delay},
      {{true, 0U, 0U, 10000U, 0U, 10U, 20U}, DeliveryDecisionType::Duplicate},
      {{true, 0U, 0U, 0U, 10000U, 10U, 20U}, DeliveryDecisionType::Reorder},
  };

  for (const auto& [faults, expected] : cases) {
    SimulationTrace trace = packetNetworkTrace();
    trace.seeded_delivery_faults = faults;
    CHECK(hasDecision(runSimulationTrace(trace), expected));
  }
}

TEST_CASE("bounded transmit queues reject excess packets before radio service") {
  SimulationTrace trace = packetNetworkTrace();
  trace.nodes[0].transmit_queue_capacity = 1U;
  const SimulationResult result = runSimulationTrace(trace);

  bool queue_drop = false;
  for (const SimulationEvent& event : result.events) {
    queue_drop =
        queue_drop || (event.type == SimulationEventType::MessageDropped && event.node_id == 0U &&
                       event.drop_reason == MessageDropReason::TransmitQueueFull &&
                       event.packet_size == WireCodec::kPacketSize);
  }
  CHECK(queue_drop);
  CHECK(result.frames.front().nodes[0].transmit_queue_capacity == 1U);
}

TEST_CASE("an explicit route forwards the same packet through the configured next hop") {
  SimulationTrace trace = packetNetworkTrace();
  trace.routes.push_back({0U, 2U, 1U});
  const SimulationResult result = runSimulationTrace(trace);

  uint64_t forwarded_packet = 0U;
  bool forwarded = false;
  bool second_hop = false;
  bool delivered = false;
  for (const SimulationEvent& event : result.events) {
    if (event.type == SimulationEventType::PacketForwarded && event.node_id == 0U &&
        event.recipient_node == 1U && event.final_recipient_node == 2U) {
      forwarded_packet = event.packet_id;
      forwarded = true;
    } else if (forwarded_packet != 0U && event.packet_id == forwarded_packet &&
               event.type == SimulationEventType::TransmissionStarted && event.node_id == 1U &&
               event.recipient_node == 2U) {
      second_hop = true;
    } else if (forwarded_packet != 0U && event.packet_id == forwarded_packet &&
               event.type == SimulationEventType::MessageDelivered && event.recipient_node == 2U) {
      delivered = true;
    }
  }

  CHECK(forwarded);
  CHECK(second_hop);
  CHECK(delivered);
}

TEST_CASE("the packet hop limit terminates a forwarding loop") {
  SimulationTrace trace = packetNetworkTrace();
  trace.packet_network.maximum_hops = 2U;
  trace.routes = {{0U, 2U, 1U}, {1U, 2U, 0U}};
  const SimulationResult result = runSimulationTrace(trace);

  bool loop_drop = false;
  for (const SimulationEvent& event : result.events) {
    loop_drop = loop_drop || (event.type == SimulationEventType::MessageDropped &&
                              event.final_recipient_node == 2U &&
                              event.drop_reason == MessageDropReason::RoutingLoop);
  }
  CHECK(loop_drop);
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
  CHECK(json.find(R"("traceVersion":6)") != std::string::npos);
  CHECK(json.find(R"("maximumAttempts":6)") != std::string::npos);
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
  CHECK(json.find(R"("packetNetwork":{"enabled":true)") != std::string::npos);
  CHECK(json.find(R"("minimumDelayMs":10)") != std::string::npos);
  CHECK(json.find(R"("controller":{"responseWindowMs":100)") != std::string::npos);
  CHECK(json.find(R"("routes":[{"sender":0,"destination":2,"nextHop":1})") != std::string::npos);
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
  config.packet_network.enabled = false;

  const LaboratoryRun run = runNetworkLaboratory(config, 5U, {"plain", ControllerConfig()});
  for (const NodeConfiguration& node : run.trace.nodes) {
    CHECK(node.protocol_version == 1U);
  }
  for (const SimulationEvent& event : run.result.events) {
    CHECK(event.type != SimulationEventType::ContactObserved);
    CHECK(event.type != SimulationEventType::NodeCrashed);
    CHECK(event.type != SimulationEventType::StoragePressureChanged);
  }
  const std::string json = serializeLaboratoryRun(config, run);
  CHECK(json.find(R"("includeStaleContacts":false)") != std::string::npos);
  CHECK(json.find(R"("includePartition":false)") != std::string::npos);
  CHECK(json.find(R"("seededDeliveryFaults":{"enabled":false)") != std::string::npos);
  CHECK(json.find(R"("packetNetwork":{"enabled":false)") != std::string::npos);
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
  SECTION("missing provenance") {
    config.code_revision.clear();
    CHECK_THROWS_AS(makeNetworkLaboratoryTrace(config, 1U), std::invalid_argument);
  }
  SECTION("missing scenario ID") {
    config.scenario_id.clear();
    CHECK_THROWS_AS(makeNetworkLaboratoryTrace(config, 1U), std::invalid_argument);
  }
  SECTION("missing configuration ID") {
    config.configuration_id.clear();
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
  SECTION("duplicate variant IDs") {
    CHECK_THROWS_AS(
        runPairedBatch(config, {{"baseline", ControllerConfig()}, {"baseline", ControllerConfig()}},
                       {1U}),
        std::invalid_argument);
  }
  SECTION("empty paired variant ID") {
    CHECK_THROWS_AS(runPairedBatch(config, {{"", ControllerConfig()}}, {1U}),
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
  SECTION("zero packet bitrate") {
    SimulationTrace trace = packetNetworkTrace();
    trace.packet_network.bitrate_bits_per_second = 0U;
    CHECK_THROWS_AS(runSimulationTrace(trace), std::invalid_argument);
  }
  SECTION("zero packet hop limit") {
    SimulationTrace trace = packetNetworkTrace();
    trace.packet_network.maximum_hops = 0U;
    CHECK_THROWS_AS(runSimulationTrace(trace), std::invalid_argument);
  }
  SECTION("ambiguous packet propagation") {
    SimulationTrace trace = packetNetworkTrace();
    trace.packet_network.propagation_delay_ms =
        static_cast<uint32_t>(std::numeric_limits<int32_t>::max()) + 1U;
    CHECK_THROWS_AS(runSimulationTrace(trace), std::invalid_argument);
  }
  SECTION("negative transmit energy") {
    SimulationTrace trace = packetNetworkTrace();
    trace.packet_network.transmit_energy_millijoules_per_byte = -1.0;
    CHECK_THROWS_AS(runSimulationTrace(trace), std::invalid_argument);
  }
  SECTION("non-finite transmit energy") {
    SimulationTrace trace = packetNetworkTrace();
    trace.packet_network.transmit_energy_millijoules_per_byte =
        std::numeric_limits<double>::infinity();
    CHECK_THROWS_AS(runSimulationTrace(trace), std::invalid_argument);
  }
  SECTION("negative receive energy") {
    SimulationTrace trace = packetNetworkTrace();
    trace.packet_network.receive_energy_millijoules_per_byte = -1.0;
    CHECK_THROWS_AS(runSimulationTrace(trace), std::invalid_argument);
  }
  SECTION("non-finite receive energy") {
    SimulationTrace trace = packetNetworkTrace();
    trace.packet_network.receive_energy_millijoules_per_byte =
        std::numeric_limits<double>::infinity();
    CHECK_THROWS_AS(runSimulationTrace(trace), std::invalid_argument);
  }
  SECTION("ambiguous combined packet delay") {
    SimulationTrace trace = packetNetworkTrace();
    trace.packet_network.propagation_delay_ms =
        static_cast<uint32_t>(std::numeric_limits<int32_t>::max()) - 10U;
    trace.seeded_delivery_faults.enabled = true;
    trace.seeded_delivery_faults.delay_permyriad = 1U;
    trace.seeded_delivery_faults.maximum_delay_ms = 10U;
    CHECK_THROWS_AS(runSimulationTrace(trace), std::invalid_argument);
  }
  SECTION("loss-only faults do not extend the packet event horizon") {
    SimulationTrace trace = packetNetworkTrace();
    trace.packet_network.propagation_delay_ms =
        static_cast<uint32_t>(std::numeric_limits<int32_t>::max()) - 10U;
    trace.seeded_delivery_faults = {true, 1U, 0U, 0U, 0U, 10U, 40U};
    CHECK_NOTHROW(runSimulationTrace(trace));
  }
  SECTION("self-directed route hop") {
    SimulationTrace trace = packetNetworkTrace();
    trace.routes.push_back({0U, 2U, 0U});
    CHECK_THROWS_AS(runSimulationTrace(trace), std::invalid_argument);
  }
  SECTION("self-directed route destination") {
    SimulationTrace trace = packetNetworkTrace();
    trace.routes.push_back({0U, 0U, 1U});
    CHECK_THROWS_AS(runSimulationTrace(trace), std::invalid_argument);
  }
  SECTION("duplicate route") {
    SimulationTrace trace = packetNetworkTrace();
    trace.routes = {{0U, 2U, 1U}, {0U, 2U, 2U}};
    CHECK_THROWS_AS(runSimulationTrace(trace), std::invalid_argument);
  }
  SECTION("scripted and packet faults cannot share one trace") {
    SimulationTrace trace = packetNetworkTrace();
    trace.frames.front().delivery_faults.push_back(
        {0U, 1U, MessageType::MissionRequest, DeliveryFaultType::Drop, 0U});
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

TEST_CASE("delivery fault validation recognizes every supported message type") {
  for (const MessageType type :
       {MessageType::Candidacy, MessageType::Acknowledgement, MessageType::MissionAssignment}) {
    SimulationTrace trace = twoNodeTrace(SeededDeliveryFaults());
    trace.frames.front().mission_commands.clear();
    trace.frames.front().delivery_faults.push_back({0U, 1U, type, DeliveryFaultType::Drop, 0U});
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
      activeObservation(0U, MissionKey(0U, 1U, 1U), 0U),
      activeObservation(1U, MissionKey(0U, 1U, 1U), 1U),
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
      activeObservation(0U, MissionKey(), 0U),
      activeObservation(1U, MissionKey(0U, 1U, 2U), 0U),
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

TEST_CASE("run measurement deduplicates packet and mission evidence") {
  SimulationTrace trace;
  trace.nodes = {{0U, SatelliteSnapshot()}};
  SimulationResult result;
  FrameObservation frame;
  NodeObservation stopped = activeObservation(0U, MissionKey(0U, 1U, 1U), 0U);
  stopped.running = false;
  frame.nodes.push_back(stopped);
  result.frames.push_back(frame);

  SimulationEvent rejected;
  rejected.type = SimulationEventType::MissionCommand;
  rejected.accepted = false;
  result.events.push_back(rejected);
  for (uint8_t index = 0U; index < 2U; ++index) {
    SimulationEvent active;
    active.type = SimulationEventType::StateChanged;
    active.current_state = ControllerState::Active;
    active.mission_key = MissionKey(0U, 1U, 1U);
    result.events.push_back(active);

    SimulationEvent delivered;
    delivered.type = SimulationEventType::MessageDelivered;
    delivered.packet_id = 7U;
    delivered.packet_size = static_cast<uint16_t>(WireCodec::kPacketSize);
    result.events.push_back(delivered);
  }

  const RunMetrics metrics = measureRun(trace, result);
  CHECK(metrics.missions_started == 0U);
  CHECK(metrics.missions_completed == 1U);
  CHECK(metrics.deliveries == 2U);
  CHECK(metrics.useful_bytes_delivered == WireCodec::kPacketSize);
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
  for (uint8_t value = 0U; value <= static_cast<uint8_t>(MessageDropReason::RoutingLoop); ++value) {
    SimulationEvent event;
    event.type = SimulationEventType::MessageDropped;
    event.drop_reason = static_cast<MessageDropReason>(value);
    run.result.events.push_back(event);
  }
  for (const SimulationEventType type :
       {SimulationEventType::PacketQueued, SimulationEventType::TransmissionStarted,
        SimulationEventType::TransmissionCompleted, SimulationEventType::PacketForwarded}) {
    SimulationEvent event;
    event.type = type;
    event.packet_id = 1U;
    event.packet_size = static_cast<uint16_t>(WireCodec::kPacketSize);
    event.transmission_end_ms = type == SimulationEventType::PacketQueued ? 0U : 10U;
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
