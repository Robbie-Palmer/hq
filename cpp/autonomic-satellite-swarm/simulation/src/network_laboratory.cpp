#include "satellite_swarm/network_laboratory.hpp"

#include <algorithm>
#include <array>
#include <cmath>
#include <cstddef>
#include <limits>
#include <set>
#include <sstream>
#include <stdexcept>

namespace satellite_swarm::simulation {
namespace {

SatelliteSnapshot satelliteAt(float longitude, float latitude) {
  SatelliteSnapshot satellite;
  satellite.coordinate = Coordinate(longitude, latitude);
  return satellite;
}

uint64_t missionId(const MissionKey& key) {
  return (static_cast<uint64_t>(key.origin_node) << 48U) |
         (static_cast<uint64_t>(key.boot_epoch) << 16U) | key.sequence;
}

const char* eventName(SimulationEventType type) {
  switch (type) {
  case SimulationEventType::MissionCommand:
    return "mission-command";
  case SimulationEventType::MissionCompletion:
    return "mission-completion";
  case SimulationEventType::MessageSent:
    return "message-sent";
  case SimulationEventType::MessageDropped:
    return "message-dropped";
  case SimulationEventType::MessageDelayed:
    return "message-delayed";
  case SimulationEventType::MessageDuplicated:
    return "message-duplicated";
  case SimulationEventType::MessageDelivered:
    return "message-delivered";
  case SimulationEventType::DeliveryDecision:
    return "delivery-decision";
  case SimulationEventType::PacketQueued:
    return "packet-queued";
  case SimulationEventType::TransmissionStarted:
    return "transmission-started";
  case SimulationEventType::TransmissionCompleted:
    return "transmission-completed";
  case SimulationEventType::PacketForwarded:
    return "packet-forwarded";
  case SimulationEventType::DelayedMessageDelivered:
    return "delayed-message-delivered";
  case SimulationEventType::LinkChanged:
    return "link-changed";
  case SimulationEventType::ContactObserved:
    return "contact-observed";
  case SimulationEventType::StoragePressureChanged:
    return "storage-pressure-changed";
  case SimulationEventType::NodeCrashed:
    return "node-crashed";
  case SimulationEventType::NodeReset:
    return "node-reset";
  case SimulationEventType::ResourceSample:
    return "resource-sample";
  case SimulationEventType::StateChanged:
    return "state-changed";
  case SimulationEventType::ControllerTelemetry:
    return "controller-telemetry";
  }
  return "unknown";
}

const char* decisionName(DeliveryDecisionType decision) {
  switch (decision) {
  case DeliveryDecisionType::Deliver:
    return "deliver";
  case DeliveryDecisionType::Drop:
    return "drop";
  case DeliveryDecisionType::Delay:
    return "delay";
  case DeliveryDecisionType::Duplicate:
    return "duplicate";
  case DeliveryDecisionType::Reorder:
    return "reorder";
  }
  return "unknown";
}

const char* dropReasonName(MessageDropReason reason) {
  switch (reason) {
  case MessageDropReason::Scripted:
    return "scripted";
  case MessageDropReason::LinkUnavailable:
    return "link-unavailable";
  case MessageDropReason::NodeCrashed:
    return "node-crashed";
  case MessageDropReason::StoragePressure:
    return "storage-pressure";
  case MessageDropReason::IncompatibleProtocol:
    return "incompatible-protocol";
  case MessageDropReason::TransmitQueueFull:
    return "transmit-queue-full";
  case MessageDropReason::RoutingLoop:
    return "routing-loop";
  }
  return "unknown";
}

std::string jsonString(const std::string& value) {
  std::ostringstream output;
  output << '"';
  for (const char character : value) {
    const auto byte = static_cast<unsigned char>(character);
    if (character == '"' || character == '\\') {
      output << '\\' << character;
    } else if (byte < 0x20U) {
      static constexpr char kHex[] = "0123456789abcdef";
      output << "\\u00" << kHex[byte >> 4U] << kHex[byte & 0x0FU];
    } else {
      output << character;
    }
  }
  output << '"';
  return output.str();
}

ConfidenceInterval interval(const std::vector<double>& values) {
  ConfidenceInterval result;
  if (values.empty()) {
    return result;
  }
  for (const double value : values) {
    result.mean += value;
  }
  result.mean /= static_cast<double>(values.size());
  if (values.size() == 1U) {
    result.lower = result.mean;
    result.upper = result.mean;
    return result;
  }
  double squared_error = 0.0;
  for (const double value : values) {
    const double difference = value - result.mean;
    squared_error += difference * difference;
  }
  const double variance = squared_error / static_cast<double>(values.size() - 1U);
  const double margin = 1.96 * std::sqrt(variance / static_cast<double>(values.size()));
  result.lower = result.mean - margin;
  result.upper = result.mean + margin;
  return result;
}

// Stream insertion exposes implementation exception edges, but these formatting helpers contain no
// domain decisions. Keep their line coverage while excluding those synthetic branches.
// GCOVR_EXCL_BR_START
void writeInterval(std::ostream& output, const ConfidenceInterval& value) {
  output << R"({"mean":)" << value.mean << R"(,"lower":)" << value.lower << R"(,"upper":)"
         << value.upper << '}';
}

void writeMetrics(std::ostream& output, const RunMetrics& metrics) {
  output << R"({"safetyViolations":)" << metrics.safety_violations << R"(,"livenessFailures":)"
         << metrics.liveness_failures << R"(,"missionsStarted":)" << metrics.missions_started
         << R"(,"missionsCompleted":)" << metrics.missions_completed
         << R"(,"meanAssignmentLatencyMs":)" << metrics.mean_assignment_latency_ms
         << R"(,"deliveries":)" << metrics.deliveries << R"(,"deliveryFailures":)"
         << metrics.delivery_failures << R"(,"bytesSent":)" << metrics.bytes_sent
         << R"(,"bytesReceived":)" << metrics.bytes_received << R"(,"bytesDropped":)"
         << metrics.bytes_dropped << R"(,"usefulBytesDelivered":)" << metrics.useful_bytes_delivered
         << R"(,"peakBufferOccupancy":)" << metrics.peak_buffer_occupancy
         << R"(,"peakTransmitQueueOccupancy":)" << metrics.peak_transmit_queue_occupancy
         << R"(,"airtimeMicroseconds":)" << metrics.airtime_microseconds
         << R"(,"estimatedEnergyMillijoules":)" << metrics.estimated_energy_millijoules
         << R"(,"energyPerDeliveredByteMillijoules":)"
         << metrics.energy_per_delivered_byte_millijoules << '}';
}

void writeControllerConfig(std::ostream& output, const ControllerConfig& config) {
  output << R"({"responseWindowMs":)" << config.response_window_ms << R"(,"retryIntervalMs":)"
         << config.retry_interval_ms << R"(,"maximumAttempts":)"
         << static_cast<unsigned int>(config.maximum_attempts)
         << R"(,"failedMissionsBeforeSafeDisable":)"
         << static_cast<unsigned int>(config.failed_missions_before_safe_disable)
         << R"(,"maximumMessagesPerUpdate":)"
         << static_cast<unsigned int>(config.maximum_messages_per_update) << '}';
}
// GCOVR_EXCL_BR_STOP

double failureScore(const RunMetrics& metrics) {
  return static_cast<double>(metrics.safety_violations) * 1000000.0 +
         static_cast<double>(metrics.liveness_failures) * 10000.0 +
         static_cast<double>(metrics.delivery_failures);
}

} // namespace

SimulationTrace makeNetworkLaboratoryTrace(const NetworkLaboratoryConfig& config, uint64_t seed,
                                           const ControllerConfig& controller) {
  if (config.version != kNetworkScenarioVersion || config.step_ms == 0U ||
      config.duration_ms < 200U || config.duration_ms % config.step_ms != 0U ||
      config.scenario_id.empty() || config.configuration_id.empty() ||
      config.code_revision.empty()) {
    throw std::invalid_argument("invalid network laboratory scenario");
  }

  SimulationTrace trace;
  trace.provenance = {config.scenario_id, config.code_revision, config.configuration_id, seed};
  trace.seeded_delivery_faults = config.delivery_faults;
  trace.packet_network = config.packet_network;
  trace.routes = {{0U, 2U, 1U}, {2U, 0U, 1U}};
  trace.record_delivery_decisions = true;
  trace.record_resource_samples = true;
  trace.controller = controller;
  trace.controller.response_window_ms = config.response_window_ms;
  trace.nodes = {
      {0U, satelliteAt(3.0F, 60.0F)},
      {1U, satelliteAt(0.0F, 10.0F)},
      {2U, satelliteAt(1.0F, 0.0F)},
  };
  if (config.include_mixed_protocol_versions) {
    trace.nodes[2].protocol_version = 2U;
  }

  for (uint32_t now_ms = 0U; now_ms <= config.duration_ms; now_ms += config.step_ms) {
    SimulationFrame frame;
    frame.now_ms = now_ms;
    if (now_ms == 0U || now_ms == 130U) {
      frame.mission_commands.push_back({0U, Coordinate(0.0F, -90.0F)});
    }
    if (now_ms == 120U || now_ms == 260U) {
      for (NodeId node = 0U; node < 3U; ++node) {
        frame.mission_completions.push_back({node});
      }
    }
    if (config.include_stale_contacts && now_ms == 130U) {
      frame.contact_updates.push_back({0U, 2U, true, false});
    }
    if (config.include_stale_contacts && now_ms == 170U) {
      frame.contact_updates.push_back({0U, 2U, true, true});
    }
    if (config.include_asymmetric_partition && now_ms == 140U) {
      frame.contact_updates.push_back({1U, 0U, true, false});
      frame.contact_updates.push_back({0U, 1U, true, true});
    }
    if (config.include_asymmetric_partition && now_ms == 180U) {
      frame.contact_updates.push_back({1U, 0U, true, true});
    }
    if (config.include_crash_and_reset && now_ms == 150U) {
      frame.node_crashes.push_back({2U});
    }
    if (config.include_crash_and_reset && now_ms == 190U) {
      frame.node_resets.push_back({2U});
    }
    if (config.include_storage_pressure && now_ms == 150U) {
      frame.storage_pressure_updates.push_back({1U, 0U});
    }
    if (config.include_storage_pressure && now_ms == 190U) {
      frame.storage_pressure_updates.push_back({1U, 64U});
    }
    if (config.include_partition && (now_ms == 210U || now_ms == 230U)) {
      const bool connected = now_ms == 230U;
      frame.contact_updates.push_back({0U, 2U, true, connected});
      frame.contact_updates.push_back({2U, 0U, true, connected});
      frame.contact_updates.push_back({1U, 2U, true, connected});
      frame.contact_updates.push_back({2U, 1U, true, connected});
    }
    trace.frames.push_back(std::move(frame));
  }
  return trace;
}

RunMetrics measureRun(const SimulationTrace& trace, const SimulationResult& result) {
  RunMetrics metrics;
  std::set<uint64_t> completed_missions;
  std::set<uint64_t> delivered_packets;
  std::vector<uint32_t> command_times;
  std::vector<double> latencies;
  std::array<uint64_t, kMaximumNodes> last_sent{};
  std::array<uint64_t, kMaximumNodes> last_received{};
  std::array<uint64_t, kMaximumNodes> last_dropped{};
  std::array<uint64_t, kMaximumNodes> last_airtime{};
  std::array<double, kMaximumNodes> last_energy{};

  for (const FrameObservation& frame : result.frames) {
    std::set<uint64_t> active_missions;
    for (const NodeObservation& node : frame.nodes) {
      metrics.peak_buffer_occupancy =
          std::max(metrics.peak_buffer_occupancy, node.buffer_occupancy);
      metrics.peak_transmit_queue_occupancy =
          std::max(metrics.peak_transmit_queue_occupancy, node.transmit_queue_occupancy);
      if (node.running && node.state == ControllerState::Active) {
        if (!isValid(node.mission_key) || node.assigned_node != node.node_id ||
            !active_missions.insert(missionId(node.mission_key)).second) {
          ++metrics.safety_violations;
        }
      }
    }
  }

  for (const SimulationEvent& event : result.events) {
    if (event.type == SimulationEventType::MissionCommand && event.accepted) {
      ++metrics.missions_started;
      command_times.push_back(event.now_ms);
    } else if (event.type == SimulationEventType::StateChanged &&
               event.current_state == ControllerState::Active &&
               completed_missions.insert(missionId(event.mission_key)).second) {
      const uint32_t start = command_times.empty() ? event.now_ms : command_times.back();
      latencies.push_back(static_cast<double>(event.now_ms - start));
    } else if (event.type == SimulationEventType::MessageDelivered ||
               event.type == SimulationEventType::DelayedMessageDelivered) {
      ++metrics.deliveries;
      if (event.packet_size != 0U && delivered_packets.insert(event.packet_id).second) {
        metrics.useful_bytes_delivered += event.packet_size;
      }
    } else if (event.type == SimulationEventType::MessageDropped) {
      ++metrics.delivery_failures;
    } else if (event.type == SimulationEventType::ResourceSample) {
      const auto node = static_cast<std::size_t>(event.node_id);
      last_sent[node] = event.bytes_sent;
      last_received[node] = event.bytes_received;
      last_dropped[node] = event.bytes_dropped;
      last_airtime[node] = event.airtime_microseconds;
      last_energy[node] = event.estimated_energy_millijoules;
      metrics.peak_buffer_occupancy =
          std::max(metrics.peak_buffer_occupancy, event.peak_buffer_occupancy);
      metrics.peak_transmit_queue_occupancy =
          std::max(metrics.peak_transmit_queue_occupancy, event.peak_transmit_queue_occupancy);
    }
  }

  metrics.missions_completed = static_cast<uint32_t>(completed_missions.size());
  metrics.liveness_failures = metrics.missions_started > metrics.missions_completed
                                  ? metrics.missions_started - metrics.missions_completed
                                  : 0U;
  for (const double latency : latencies) {
    metrics.mean_assignment_latency_ms += latency;
  }
  if (!latencies.empty()) {
    metrics.mean_assignment_latency_ms /= static_cast<double>(latencies.size());
  }
  for (std::size_t node = 0U; node < trace.nodes.size(); ++node) {
    metrics.bytes_sent += last_sent[node];
    metrics.bytes_received += last_received[node];
    metrics.bytes_dropped += last_dropped[node];
    metrics.airtime_microseconds += last_airtime[node];
    metrics.estimated_energy_millijoules += last_energy[node];
  }
  if (metrics.useful_bytes_delivered != 0U) {
    metrics.energy_per_delivered_byte_millijoules =
        metrics.estimated_energy_millijoules / static_cast<double>(metrics.useful_bytes_delivered);
  }
  return metrics;
}

LaboratoryRun runNetworkLaboratory(const NetworkLaboratoryConfig& config, uint64_t seed,
                                   const ExperimentVariant& variant) {
  if (variant.id.empty()) {
    throw std::invalid_argument("network laboratory variant ID cannot be empty");
  }
  LaboratoryRun run;
  run.variant_id = variant.id;
  run.trace = makeNetworkLaboratoryTrace(config, seed, variant.controller);
  run.result = runSimulationTrace(run.trace);
  run.metrics = measureRun(run.trace, run.result);
  return run;
}

BatchReport runPairedBatch(const NetworkLaboratoryConfig& config,
                           const std::vector<ExperimentVariant>& variants,
                           const std::vector<uint64_t>& seeds) {
  if (variants.empty() || seeds.empty()) {
    throw std::invalid_argument("paired batch requires variants and seeds");
  }
  std::set<std::string> variant_ids;
  for (const ExperimentVariant& variant : variants) {
    if (variant.id.empty() || !variant_ids.insert(variant.id).second) {
      throw std::invalid_argument("paired batch variant IDs must be nonempty and unique");
    }
  }
  BatchReport report;
  for (const uint64_t seed : seeds) {
    for (const ExperimentVariant& variant : variants) {
      report.runs.push_back(runNetworkLaboratory(config, seed, variant));
    }
  }

  for (const ExperimentVariant& variant : variants) {
    std::vector<double> completions;
    std::vector<double> latencies;
    std::vector<double> delivery_ratios;
    std::vector<double> energy_costs;
    const LaboratoryRun* worst = nullptr;
    for (const LaboratoryRun& run : report.runs) {
      if (run.variant_id != variant.id) {
        continue;
      }
      const RunMetrics& metrics = run.metrics;
      completions.push_back(metrics.missions_started == 0U
                                ? 0.0
                                : static_cast<double>(metrics.missions_completed) /
                                      static_cast<double>(metrics.missions_started));
      latencies.push_back(metrics.mean_assignment_latency_ms);
      const uint64_t delivery_attempts = metrics.deliveries + metrics.delivery_failures;
      delivery_ratios.push_back(delivery_attempts == 0U
                                    ? 0.0
                                    : static_cast<double>(metrics.deliveries) /
                                          static_cast<double>(delivery_attempts));
      energy_costs.push_back(metrics.energy_per_delivered_byte_millijoules);
      if (worst == nullptr || failureScore(metrics) > failureScore(worst->metrics)) {
        worst = &run;
      }
    }
    report.summaries.push_back({variant.id, interval(completions), interval(latencies),
                                interval(delivery_ratios), interval(energy_costs)});
    if (worst != nullptr) {
      report.worst_failures.push_back(
          {variant.id, worst->trace.provenance.seed, worst->trace, worst->metrics});
    }
  }
  return report;
}

std::string serializeLaboratoryRun(const NetworkLaboratoryConfig& config,
                                   const LaboratoryRun& run) {
  std::ostringstream output;
  // LLVM exposes stream exception edges on these decision-free formatting lines.
  // GCOVR_EXCL_BR_START
  output << R"({"schemaVersion":)" << static_cast<unsigned int>(kLaboratoryTraceSchemaVersion)
         << R"(,"traceVersion":)" << static_cast<unsigned int>(run.trace.version)
         << R"(,"scenario":{"version":)" << static_cast<unsigned int>(config.version) << R"(,"id":)"
         << jsonString(config.scenario_id) << R"(,"configuration":)"
         << jsonString(config.configuration_id) << R"(},"provenance":{"codeRevision":)"
         << jsonString(config.code_revision) << R"(,"seed":)" << run.trace.provenance.seed
         << R"(,"variant":)" << jsonString(run.variant_id) << R"(},"inputs":{"durationMs":)"
         << config.duration_ms << R"(,"stepMs":)" << config.step_ms << R"(,"responseWindowMs":)"
         << config.response_window_ms
         << R"(,"includeStaleContacts":)"
         // GCOVR_EXCL_BR_STOP
         << (config.include_stale_contacts ? "true" : "false") << R"(,"includePartition":)"
         << (config.include_partition ? "true" : "false") << R"(,"includeAsymmetricPartition":)"
         << (config.include_asymmetric_partition ? "true" : "false")
         << R"(,"includeCrashAndReset":)" << (config.include_crash_and_reset ? "true" : "false")
         << R"(,"includeStoragePressure":)" << (config.include_storage_pressure ? "true" : "false")
         << R"(,"includeMixedProtocolVersions":)"
         << (config.include_mixed_protocol_versions ? "true" : "false")
         << R"(,"seededDeliveryFaults":{"enabled":)"
         << (config.delivery_faults.enabled ? "true" : "false") << R"(,"lossPermyriad":)"
         << config.delivery_faults.loss_permyriad << R"(,"delayPermyriad":)"
         << config.delivery_faults.delay_permyriad << R"(,"duplicatePermyriad":)"
         << config.delivery_faults.duplicate_permyriad << R"(,"reorderPermyriad":)"
         << config.delivery_faults.reorder_permyriad << R"(,"minimumDelayMs":)"
         << config.delivery_faults.minimum_delay_ms << R"(,"maximumDelayMs":)"
         << config.delivery_faults.maximum_delay_ms << R"(},"packetNetwork":{"enabled":)"
         << (config.packet_network.enabled ? "true" : "false") << R"(,"bitrateBitsPerSecond":)"
         << config.packet_network.bitrate_bits_per_second << R"(,"propagationDelayMs":)"
         << config.packet_network.propagation_delay_ms << R"(,"maximumHops":)"
         << static_cast<unsigned int>(config.packet_network.maximum_hops)
         << R"(,"transmitEnergyMillijoulesPerByte":)"
         << config.packet_network.transmit_energy_millijoules_per_byte
         << R"(,"receiveEnergyMillijoulesPerByte":)"
         << config.packet_network.receive_energy_millijoules_per_byte << R"(},"controller":)";
  writeControllerConfig(output, run.trace.controller);
  output << R"(,"nodes":[)";
  for (std::size_t index = 0U; index < run.trace.nodes.size(); ++index) {
    const NodeConfiguration& node = run.trace.nodes[index];
    output << R"({"id":)" << static_cast<unsigned int>(node.node_id) << R"(,"protocolVersion":)"
           << node.protocol_version << R"(,"bufferCapacity":)" << node.receive_buffer_capacity
           << R"(,"transmitQueueCapacity":)" << node.transmit_queue_capacity << '}';
    if (index + 1U != run.trace.nodes.size()) {
      output << ',';
    }
  }
  output << R"(],"routes":[)";
  for (std::size_t index = 0U; index < run.trace.routes.size(); ++index) {
    const RouteEntry& route = run.trace.routes[index];
    output << R"({"sender":)" << static_cast<unsigned int>(route.sender) << R"(,"destination":)"
           << static_cast<unsigned int>(route.destination) << R"(,"nextHop":)"
           << static_cast<unsigned int>(route.next_hop) << '}';
    if (index + 1U != run.trace.routes.size()) {
      output << ',';
    }
  }
  output << R"(],"frameCount":)" << run.trace.frames.size() << R"(},"events":[)";
  for (std::size_t index = 0U; index < run.result.events.size(); ++index) {
    const SimulationEvent& event = run.result.events[index];
    output << R"({"timeMs":)" << event.now_ms << R"(,"type":)" << jsonString(eventName(event.type))
           << R"(,"nodeId":)" << static_cast<unsigned int>(event.node_id);
    if (event.packet_id != 0U) {
      output << R"(,"packetId":)" << event.packet_id << R"(,"packetSize":)" << event.packet_size
             << R"(,"finalRecipientNode":)"
             << static_cast<unsigned int>(event.final_recipient_node);
    }
    if (event.type == SimulationEventType::DeliveryDecision) {
      output << R"(,"recipientNode":)" << static_cast<unsigned int>(event.recipient_node)
             << R"(,"randomValue":)" << event.random_value << R"(,"decision":)"
             << jsonString(decisionName(event.delivery_decision));
      if (event.deliver_at_ms != 0U) {
        output << R"(,"deliverAtMs":)" << event.deliver_at_ms;
      }
    } else if (event.type == SimulationEventType::MessageDelivered ||
               event.type == SimulationEventType::DelayedMessageDelivered ||
               event.type == SimulationEventType::MessageDelayed ||
               event.type == SimulationEventType::MessageDuplicated ||
               event.type == SimulationEventType::MessageDropped) {
      output << R"(,"recipientNode":)" << static_cast<unsigned int>(event.recipient_node);
      if (event.type == SimulationEventType::MessageDropped) {
        output << R"(,"reason":)" << jsonString(dropReasonName(event.drop_reason));
      }
    } else if (event.type == SimulationEventType::PacketQueued ||
               event.type == SimulationEventType::TransmissionStarted ||
               event.type == SimulationEventType::TransmissionCompleted ||
               event.type == SimulationEventType::PacketForwarded) {
      output << R"(,"recipientNode":)" << static_cast<unsigned int>(event.recipient_node)
             << R"(,"transmitQueueOccupancy":)" << event.transmit_queue_occupancy
             << R"(,"transmitQueueCapacity":)" << event.transmit_queue_capacity;
      if (event.transmission_end_ms != 0U) {
        output << R"(,"transmissionEndMs":)" << event.transmission_end_ms
               << R"(,"airtimeMicroseconds":)" << event.airtime_microseconds;
      }
    } else if (event.type == SimulationEventType::ContactObserved) {
      output << R"(,"recipientNode":)" << static_cast<unsigned int>(event.recipient_node)
             << R"(,"plannedConnected":)" << (event.planned_connected ? "true" : "false")
             << R"(,"connected":)" << (event.connected ? "true" : "false");
    } else if (event.type == SimulationEventType::ResourceSample) {
      output << R"(,"bufferOccupancy":)" << event.buffer_occupancy << R"(,"bufferCapacity":)"
             << event.buffer_capacity << R"(,"peakBufferOccupancy":)" << event.peak_buffer_occupancy
             << R"(,"transmitQueueOccupancy":)" << event.transmit_queue_occupancy
             << R"(,"transmitQueueCapacity":)" << event.transmit_queue_capacity
             << R"(,"peakTransmitQueueOccupancy":)" << event.peak_transmit_queue_occupancy
             << R"(,"bytesSent":)" << event.bytes_sent << R"(,"bytesReceived":)"
             << event.bytes_received << R"(,"bytesDropped":)" << event.bytes_dropped
             << R"(,"airtimeMicroseconds":)" << event.airtime_microseconds
             << R"(,"estimatedEnergyMillijoules":)" << event.estimated_energy_millijoules;
    } else if (event.type == SimulationEventType::StoragePressureChanged) {
      output << R"(,"bufferOccupancy":)" << event.buffer_occupancy << R"(,"bufferCapacity":)"
             << event.buffer_capacity;
    } else if (event.type == SimulationEventType::NodeCrashed ||
               event.type == SimulationEventType::NodeReset) {
      output << R"(,"running":)" << (event.running ? "true" : "false");
    } else if (event.type == SimulationEventType::MissionCommand) {
      output << R"(,"accepted":)" << (event.accepted ? "true" : "false")
             << R"(,"objective":{"longitudeDegrees":)" << event.objective.longitude_degrees
             << R"(,"latitudeDegrees":)" << event.objective.latitude_degrees << '}';
    }
    output << '}';
    if (index + 1U != run.result.events.size()) {
      output << ',';
    }
  }
  output << R"(],"metrics":)";
  writeMetrics(output, run.metrics);
  output << '}';
  return output.str();
}

std::string serializeBatchReport(const NetworkLaboratoryConfig& config, const BatchReport& report) {
  std::ostringstream output;
  output << R"({"schemaVersion":)" << static_cast<unsigned int>(kBatchReportSchemaVersion)
         << R"(,"scenarioId":)" << jsonString(config.scenario_id) << R"(,"configurationId":)"
         << jsonString(config.configuration_id) << R"(,"codeRevision":)"
         << jsonString(config.code_revision) << R"(,"pairedSeeds":true)"
         << R"(,"rawRuns":[)";
  for (std::size_t index = 0U; index < report.runs.size(); ++index) {
    const LaboratoryRun& run = report.runs[index];
    output << R"({"variant":)" << jsonString(run.variant_id) << R"(,"seed":)"
           << run.trace.provenance.seed << R"(,"traceVersion":)"
           << static_cast<unsigned int>(run.trace.version) << R"(,"controller":)";
    writeControllerConfig(output, run.trace.controller);
    output << R"(,"metrics":)";
    writeMetrics(output, run.metrics);
    output << '}';
    if (index + 1U != report.runs.size()) {
      output << ',';
    }
  }
  output << R"(],"summaries":[)";
  for (std::size_t index = 0U; index < report.summaries.size(); ++index) {
    const VariantSummary& summary = report.summaries[index];
    output << R"({"variant":)" << jsonString(summary.variant_id) << R"(,"missionCompletionRate":)";
    writeInterval(output, summary.mission_completion_rate);
    output << R"(,"assignmentLatencyMs":)";
    writeInterval(output, summary.assignment_latency_ms);
    output << R"(,"deliveryRatio":)";
    writeInterval(output, summary.delivery_ratio);
    output << R"(,"energyPerDeliveredByteMillijoules":)";
    writeInterval(output, summary.energy_per_delivered_byte_millijoules);
    output << '}';
    if (index + 1U != report.summaries.size()) {
      output << ',';
    }
  }
  output << R"(],"worstFailures":[)";
  for (std::size_t index = 0U; index < report.worst_failures.size(); ++index) {
    const RegressionFixture& fixture = report.worst_failures[index];
    output << R"({"variant":)" << jsonString(fixture.variant_id) << R"(,"seed":)" << fixture.seed
           << R"(,"scenarioId":)" << jsonString(fixture.trace.provenance.scenario_id)
           << R"(,"configurationId":)" << jsonString(fixture.trace.provenance.configuration_id)
           << R"(,"codeRevision":)" << jsonString(fixture.trace.provenance.code_revision)
           << R"(,"traceVersion":)" << static_cast<unsigned int>(fixture.trace.version)
           << R"(,"controller":)";
    writeControllerConfig(output, fixture.trace.controller);
    output << R"(,"metrics":)";
    writeMetrics(output, fixture.metrics);
    output << '}';
    if (index + 1U != report.worst_failures.size()) {
      output << ',';
    }
  }
  output << "]}";
  return output.str();
}

} // namespace satellite_swarm::simulation
