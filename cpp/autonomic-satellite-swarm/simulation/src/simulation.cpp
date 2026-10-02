#include "satellite_swarm/simulation.hpp"

#include "satellite_swarm/historical_orbital_scorer.hpp"

#include <array>
#include <cstddef>
#include <deque>
#include <limits>
#include <memory>
#include <stdexcept>
#include <utility>
#include <vector>

namespace satellite_swarm::simulation {
namespace {

class SimulationTransport;

class SimulationBus {
public:
  explicit SimulationBus(std::vector<SimulationEvent>& events) : events_(events) {
    for (auto& sender_links : links_) {
      sender_links.fill(true);
    }
  }

  void attach(SimulationTransport& transport);
  void beginFrame(const SimulationFrame& frame);
  void releasePending();
  void endFrame() const;
  void broadcast(NodeId sender, const Message& message);
  void reset(NodeId node_id);

private:
  struct PendingDelivery {
    PendingDelivery(uint32_t delivery_time_ms, NodeId delivery_sender, NodeId delivery_recipient,
                    const Message& delivery_message)
        : deliver_at_ms(delivery_time_ms), sender(delivery_sender), recipient(delivery_recipient),
          message(delivery_message) {}

    uint32_t deliver_at_ms;
    NodeId sender;
    NodeId recipient;
    Message message;
  };

  using DeliveryFaultIterator = std::vector<DeliveryFault>::iterator;

  void deliver(NodeId sender, NodeId recipient, const Message& message);
  void recordDeliveryEvent(SimulationEventType type, NodeId sender, NodeId recipient,
                           const Message& message, uint32_t deliver_at_ms = 0U,
                           MessageDropReason drop_reason = MessageDropReason::Scripted);
  DeliveryFaultIterator matchingFault(NodeId sender, NodeId recipient, MessageType message_type);

  std::vector<SimulationTransport*> transports_;
  std::vector<SimulationEvent>& events_;
  std::array<std::array<bool, kMaximumNodes>, kMaximumNodes> links_{};
  std::vector<DeliveryFault> delivery_faults_;
  std::vector<PendingDelivery> pending_deliveries_;
  uint32_t now_ms_ = 0U;
};

class SimulationTransport : public Transport {
public:
  SimulationTransport(NodeId node_id, SimulationBus& bus) : node_id_(node_id), bus_(bus) {
    bus_.attach(*this);
  }

  bool send(const Message& message) override {
    bus_.broadcast(node_id_, message);
    return true;
  }

  bool receive(Message& message) override {
    if (inbox_.empty()) {
      return false;
    }
    message = inbox_.front();
    inbox_.pop_front();
    return true;
  }

  void deliver(const Message& message) { inbox_.push_back(message); }
  void reset() { inbox_.clear(); }

private:
  NodeId node_id_;
  SimulationBus& bus_;
  std::deque<Message> inbox_;
};

void SimulationBus::attach(SimulationTransport& transport) { transports_.push_back(&transport); }

void SimulationBus::beginFrame(const SimulationFrame& frame) {
  now_ms_ = frame.now_ms;
  delivery_faults_ = frame.delivery_faults;
  for (const LinkUpdate& update : frame.link_updates) {
    links_[update.sender][update.recipient] = update.connected;
    SimulationEvent event;
    event.type = SimulationEventType::LinkChanged;
    event.now_ms = now_ms_;
    event.node_id = update.sender;
    event.recipient_node = update.recipient;
    event.connected = update.connected;
    events_.push_back(event);
  }
}

void SimulationBus::endFrame() const {
  if (!delivery_faults_.empty()) {
    throw std::invalid_argument("simulation delivery fault did not match a message");
  }
}

void SimulationBus::reset(NodeId node_id) {
  transports_.at(static_cast<std::size_t>(node_id))->reset();
}

void SimulationBus::recordDeliveryEvent(SimulationEventType type, NodeId sender, NodeId recipient,
                                        const Message& message, uint32_t deliver_at_ms,
                                        MessageDropReason drop_reason) {
  SimulationEvent event;
  event.type = type;
  event.now_ms = now_ms_;
  event.node_id = sender;
  event.recipient_node = recipient;
  event.message = message;
  event.deliver_at_ms = deliver_at_ms;
  event.drop_reason = drop_reason;
  events_.push_back(event);
}

SimulationBus::DeliveryFaultIterator SimulationBus::matchingFault(NodeId sender, NodeId recipient,
                                                                  MessageType message_type) {
  for (auto fault = delivery_faults_.begin(); fault != delivery_faults_.end(); ++fault) {
    if (fault->sender == sender && fault->recipient == recipient &&
        fault->message_type == message_type) {
      return fault;
    }
  }
  return delivery_faults_.end();
}

void SimulationBus::deliver(NodeId sender, NodeId recipient, const Message& message) {
  const DeliveryFaultIterator fault = matchingFault(sender, recipient, message.type);
  const bool has_fault = fault != delivery_faults_.end();
  DeliveryFault selected;
  if (has_fault) {
    selected = *fault;
    delivery_faults_.erase(fault);
  }

  if (!links_[sender][recipient]) {
    recordDeliveryEvent(SimulationEventType::MessageDropped, sender, recipient, message, 0U,
                        MessageDropReason::LinkUnavailable);
    return;
  }

  if (!has_fault) {
    transports_.at(static_cast<std::size_t>(recipient))->deliver(message);
    return;
  }

  switch (selected.type) {
  case DeliveryFaultType::Drop:
    recordDeliveryEvent(SimulationEventType::MessageDropped, sender, recipient, message);
    break;
  case DeliveryFaultType::Delay: {
    const uint32_t deliver_at_ms = now_ms_ + selected.delay_ms;
    pending_deliveries_.emplace_back(deliver_at_ms, sender, recipient, message);
    recordDeliveryEvent(SimulationEventType::MessageDelayed, sender, recipient, message,
                        deliver_at_ms);
    break;
  }
  case DeliveryFaultType::Duplicate:
    transports_.at(static_cast<std::size_t>(recipient))->deliver(message);
    transports_.at(static_cast<std::size_t>(recipient))->deliver(message);
    recordDeliveryEvent(SimulationEventType::MessageDuplicated, sender, recipient, message);
    break;
  }
}

void SimulationBus::releasePending() {
  auto pending = pending_deliveries_.begin();
  while (pending != pending_deliveries_.end()) {
    const uint32_t elapsed_since_delivery = now_ms_ - pending->deliver_at_ms;
    const auto maximum_unambiguous_step =
        static_cast<uint32_t>(std::numeric_limits<int32_t>::max());
    if (elapsed_since_delivery > maximum_unambiguous_step) {
      ++pending;
      continue;
    }

    if (links_[pending->sender][pending->recipient]) {
      transports_.at(static_cast<std::size_t>(pending->recipient))->deliver(pending->message);
      recordDeliveryEvent(SimulationEventType::DelayedMessageDelivered, pending->sender,
                          pending->recipient, pending->message);
    } else {
      recordDeliveryEvent(SimulationEventType::MessageDropped, pending->sender, pending->recipient,
                          pending->message, 0U, MessageDropReason::LinkUnavailable);
    }
    pending = pending_deliveries_.erase(pending);
  }
}

void SimulationBus::broadcast(NodeId sender, const Message& message) {
  SimulationEvent event;
  event.type = SimulationEventType::MessageSent;
  event.now_ms = now_ms_;
  event.node_id = sender;
  event.message = message;
  events_.push_back(event);

  for (std::size_t recipient = 0U; recipient < transports_.size(); ++recipient) {
    const auto recipient_id = static_cast<NodeId>(recipient);
    if (recipient_id != sender) {
      deliver(sender, recipient_id, message);
    }
  }
}

class SimulationHealth : public HealthMonitor {
public:
  HealthStatus poll() override { return health_; }
  void set(HealthStatus health) { health_ = health; }

private:
  HealthStatus health_ = HealthStatus::Nominal;
};

class SimulationSafeStateActuator : public SafeStateActuator {
public:
  explicit SimulationSafeStateActuator(SafeStateResult request_result)
      : request_result_(request_result) {}

  SafeStateResult request(const SafeStateRequest&) override { return request_result_; }
  SafeStateExecutionStatus status(const SafeStateRequestId&) override { return status_; }
  void setStatus(SafeStateExecutionStatus status) { status_ = status; }
  void reset() { status_ = SafeStateExecutionStatus::Pending; }

private:
  SafeStateResult request_result_;
  SafeStateExecutionStatus status_ = SafeStateExecutionStatus::Pending;
};

bool isKnown(HealthStatus health) {
  return health == HealthStatus::Nominal || health == HealthStatus::Quiescent ||
         health == HealthStatus::Fatal;
}

bool isKnown(SafeStateResult result) {
  return result == SafeStateResult::Rejected || result == SafeStateResult::Accepted;
}

bool isKnown(SafeStateExecutionStatus status) {
  return status == SafeStateExecutionStatus::Pending ||
         status == SafeStateExecutionStatus::Succeeded ||
         status == SafeStateExecutionStatus::Failed;
}

bool isKnown(MessageType type) {
  return type == MessageType::MissionRequest || type == MessageType::Candidacy ||
         type == MessageType::Acknowledgement || type == MessageType::MissionAssignment;
}

bool isKnown(DeliveryFaultType type) {
  return type == DeliveryFaultType::Drop || type == DeliveryFaultType::Delay ||
         type == DeliveryFaultType::Duplicate;
}

void validateNodeId(NodeId node_id, std::size_t node_count) {
  if (static_cast<std::size_t>(node_id) >= node_count) {
    throw std::invalid_argument("simulation input references an unknown node");
  }
}

void validateDeliveryFault(const DeliveryFault& fault, std::size_t node_count) {
  validateNodeId(fault.sender, node_count);
  validateNodeId(fault.recipient, node_count);
  if (fault.sender == fault.recipient || !isKnown(fault.message_type) || !isKnown(fault.type)) {
    throw std::invalid_argument("simulation frame has an invalid delivery fault");
  }
  const auto maximum_unambiguous_delay = static_cast<uint32_t>(std::numeric_limits<int32_t>::max());
  if ((fault.type == DeliveryFaultType::Delay &&
       (fault.delay_ms == 0U || fault.delay_ms > maximum_unambiguous_delay)) ||
      (fault.type != DeliveryFaultType::Delay && fault.delay_ms != 0U)) {
    throw std::invalid_argument("simulation delivery fault has an invalid delay");
  }
}

void validateFrame(const SimulationFrame& frame, std::size_t node_count) {
  for (const SatelliteUpdate& update : frame.satellite_updates) {
    validateNodeId(update.node_id, node_count);
    if (!isValid(update.satellite)) {
      throw std::invalid_argument("simulation frame has an invalid satellite snapshot");
    }
  }
  for (const OrbitUpdate& update : frame.orbit_updates) {
    validateNodeId(update.node_id, node_count);
    if (!isValid(update.orbit.teme) || !isValid(update.orbit.earth_fixed) ||
        update.orbit.teme.frame != OrbitalCoordinateFrame::Teme ||
        update.orbit.earth_fixed.frame != OrbitalCoordinateFrame::EarthFixed ||
        update.orbit.teme.epoch_unix_milliseconds !=
            update.orbit.earth_fixed.epoch_unix_milliseconds) {
      throw std::invalid_argument("simulation frame has an invalid orbit update");
    }
  }
  for (const HealthUpdate& update : frame.health_updates) {
    validateNodeId(update.node_id, node_count);
    if (!isKnown(update.health)) {
      throw std::invalid_argument("simulation frame has an invalid health state");
    }
  }
  for (const SafeStateStatusUpdate& update : frame.safe_state_status_updates) {
    validateNodeId(update.node_id, node_count);
    if (!isKnown(update.status)) {
      throw std::invalid_argument("simulation frame has an invalid safe-state status");
    }
  }
  for (const LinkUpdate& update : frame.link_updates) {
    validateNodeId(update.sender, node_count);
    validateNodeId(update.recipient, node_count);
    if (update.sender == update.recipient) {
      throw std::invalid_argument("simulation link update cannot target its sender");
    }
  }
  for (const DeliveryFault& fault : frame.delivery_faults) {
    validateDeliveryFault(fault, node_count);
  }
  for (const NodeReset& reset : frame.node_resets) {
    validateNodeId(reset.node_id, node_count);
  }
  for (const MissionCommand& command : frame.mission_commands) {
    validateNodeId(command.leader, node_count);
    if (!isValid(command.objective)) {
      throw std::invalid_argument("simulation frame has an invalid mission objective");
    }
  }
  for (const MissionCompletion& completion : frame.mission_completions) {
    validateNodeId(completion.node_id, node_count);
  }
}

void validateTrace(const SimulationTrace& trace) {
  if (trace.version != kSimulationTraceVersion) {
    throw std::invalid_argument("unsupported simulation trace version");
  }
  if (trace.nodes.empty() || trace.nodes.size() > kMaximumNodes) {
    throw std::invalid_argument("simulation trace must configure between 1 and 16 nodes");
  }
  for (std::size_t index = 0; index < trace.nodes.size(); ++index) {
    const NodeConfiguration& node = trace.nodes[index];
    if (static_cast<std::size_t>(node.node_id) != index) {
      throw std::invalid_argument("simulation node IDs must be contiguous and ordered");
    }
    if (!isValid(node.satellite)) {
      throw std::invalid_argument("simulation node has an invalid satellite snapshot");
    }
    if (node.boot_epoch == 0U) {
      throw std::invalid_argument("simulation node boot epochs must be nonzero");
    }
    if (!isKnown(node.safe_state_request_result)) {
      throw std::invalid_argument("simulation node has an invalid safe-state request result");
    }
  }

  uint32_t previous_time = 0U;
  bool first_frame = true;
  for (const SimulationFrame& frame : trace.frames) {
    const uint32_t elapsed = frame.now_ms - previous_time;
    const auto maximum_unambiguous_step =
        static_cast<uint32_t>(std::numeric_limits<int32_t>::max());
    if (!first_frame && (elapsed == 0U || elapsed > maximum_unambiguous_step)) {
      throw std::invalid_argument("simulation frame time must advance monotonically");
    }
    first_frame = false;
    previous_time = frame.now_ms;
    validateFrame(frame, trace.nodes.size());
  }
}

void recordStateChange(std::vector<SimulationEvent>& events, uint32_t now_ms, NodeId node_id,
                       ControllerState previous, ControllerState current) {
  if (previous == current) {
    return;
  }
  SimulationEvent event;
  event.type = SimulationEventType::StateChanged;
  event.now_ms = now_ms;
  event.node_id = node_id;
  event.previous_state = previous;
  event.current_state = current;
  events.push_back(event);
}

void drainTelemetry(std::vector<SimulationEvent>& events, SwarmController& controller) {
  TelemetryEvent telemetry;
  while (controller.readTelemetry(telemetry)) {
    SimulationEvent event;
    event.type = SimulationEventType::ControllerTelemetry;
    event.now_ms = telemetry.timestamp_ms;
    event.node_id = telemetry.node_id;
    event.telemetry = telemetry;
    events.push_back(event);
  }
}

void applyOrbitUpdates(const SimulationFrame& frame,
                       std::vector<std::unique_ptr<SwarmController>>& controllers,
                       std::vector<std::optional<PropagationResult>>& orbits) {
  for (const OrbitUpdate& update : frame.orbit_updates) {
    const auto index = static_cast<std::size_t>(update.node_id);
    const SatelliteSnapshot satellite = satelliteSnapshotFrom(update.orbit);
    if (!controllers.at(index)->updateSatelliteSnapshot(satellite)) {
      throw std::invalid_argument("validated orbit update was rejected");
    }
    orbits[index] = update.orbit;
  }
}

NodeObservation observe(const SwarmController& controller,
                        const std::optional<PropagationResult>& orbit) {
  NodeObservation observation;
  observation.node_id = controller.nodeId();
  observation.state = controller.state();
  observation.satellite = controller.satelliteSnapshot();
  observation.boot_epoch = controller.bootEpoch();
  observation.mission_key = controller.currentMissionKey();
  observation.assigned_node = controller.assignedNode();
  observation.candidacy_score = controller.currentCandidacyScore();
  observation.communication_failures = controller.consecutiveCommunicationFailures();
  observation.telemetry_drops = controller.droppedTelemetryEvents();
  observation.orbit = orbit;
  return observation;
}

} // namespace

SimulationResult runSimulationTrace(const SimulationTrace& trace) {
  validateTrace(trace);

  SimulationResult result;
  SimulationBus bus(result.events);
  HistoricalOrbitalScorer scorer;
  ControllerConfig controller_config = trace.controller;
  controller_config.node_capacity = static_cast<uint8_t>(trace.nodes.size());

  std::vector<std::unique_ptr<SimulationTransport>> transports;
  std::vector<std::unique_ptr<SimulationHealth>> health_monitors;
  std::vector<std::unique_ptr<SimulationSafeStateActuator>> safe_state_actuators;
  std::vector<std::unique_ptr<SwarmController>> controllers;
  std::vector<BootEpoch> boot_epochs;
  std::vector<std::optional<PropagationResult>> orbits;
  transports.reserve(trace.nodes.size());
  health_monitors.reserve(trace.nodes.size());
  safe_state_actuators.reserve(trace.nodes.size());
  controllers.reserve(trace.nodes.size());
  boot_epochs.reserve(trace.nodes.size());
  orbits.resize(trace.nodes.size());

  for (const NodeConfiguration& node : trace.nodes) {
    transports.push_back(std::make_unique<SimulationTransport>(node.node_id, bus));
    health_monitors.push_back(std::make_unique<SimulationHealth>());
    safe_state_actuators.push_back(
        std::make_unique<SimulationSafeStateActuator>(node.safe_state_request_result));
    boot_epochs.push_back(node.boot_epoch);
  }
  for (const NodeConfiguration& node : trace.nodes) {
    const auto index = static_cast<std::size_t>(node.node_id);
    controllers.push_back(std::make_unique<SwarmController>(
        node.node_id, node.boot_epoch, node.satellite,
        ControllerDependencies{*transports[index], *health_monitors[index], scorer,
                               safe_state_actuators[index].get()},
        controller_config));
  }

  for (const SimulationFrame& frame : trace.frames) {
    bus.beginFrame(frame);

    for (const HealthUpdate& update : frame.health_updates) {
      health_monitors.at(static_cast<std::size_t>(update.node_id))->set(update.health);
    }
    for (const SafeStateStatusUpdate& update : frame.safe_state_status_updates) {
      safe_state_actuators.at(static_cast<std::size_t>(update.node_id))->setStatus(update.status);
    }
    for (const SatelliteUpdate& update : frame.satellite_updates) {
      if (!controllers.at(static_cast<std::size_t>(update.node_id))
               ->updateSatelliteSnapshot(update.satellite)) {
        throw std::invalid_argument("validated satellite update was rejected");
      }
    }
    applyOrbitUpdates(frame, controllers, orbits);
    for (const NodeReset& reset : frame.node_resets) {
      const auto index = static_cast<std::size_t>(reset.node_id);
      const ControllerState previous = controllers[index]->state();
      const auto satellite = controllers[index]->satelliteSnapshot();
      if (boot_epochs[index] == std::numeric_limits<BootEpoch>::max()) {
        throw std::invalid_argument("simulation node boot epoch exhausted");
      }
      ++boot_epochs[index];
      bus.reset(reset.node_id);
      safe_state_actuators[index]->reset();
      controllers[index] = std::make_unique<SwarmController>(
          reset.node_id, boot_epochs[index], satellite,
          ControllerDependencies{*transports[index], *health_monitors[index], scorer,
                                 safe_state_actuators[index].get()},
          controller_config);

      SimulationEvent event;
      event.type = SimulationEventType::NodeReset;
      event.now_ms = frame.now_ms;
      event.node_id = reset.node_id;
      event.previous_state = previous;
      event.current_state = controllers[index]->state();
      result.events.push_back(event);
      drainTelemetry(result.events, *controllers[index]);
    }
    bus.releasePending();
    for (const MissionCompletion& completion : frame.mission_completions) {
      SimulationEvent event;
      event.type = SimulationEventType::MissionCompletion;
      event.now_ms = frame.now_ms;
      event.node_id = completion.node_id;
      result.events.push_back(event);
      const std::size_t event_index = result.events.size() - 1U;
      SwarmController& controller = *controllers.at(static_cast<std::size_t>(completion.node_id));
      const ControllerState previous = controller.state();
      result.events[event_index].accepted = previous == ControllerState::Active;
      controller.completeMission(frame.now_ms);
      drainTelemetry(result.events, controller);
      recordStateChange(result.events, frame.now_ms, completion.node_id, previous,
                        controller.state());
    }
    for (const MissionCommand& command : frame.mission_commands) {
      SimulationEvent event;
      event.type = SimulationEventType::MissionCommand;
      event.now_ms = frame.now_ms;
      event.node_id = command.leader;
      event.objective = command.objective;
      result.events.push_back(event);
      const std::size_t event_index = result.events.size() - 1U;
      SwarmController& controller = *controllers.at(static_cast<std::size_t>(command.leader));
      const ControllerState previous = controller.state();
      result.events[event_index].accepted =
          controller.initiateMission(command.objective, frame.now_ms);
      drainTelemetry(result.events, controller);
      recordStateChange(result.events, frame.now_ms, command.leader, previous, controller.state());
    }

    for (const std::unique_ptr<SwarmController>& controller : controllers) {
      const ControllerState previous = controller->state();
      controller->update(frame.now_ms);
      drainTelemetry(result.events, *controller);
      recordStateChange(result.events, frame.now_ms, controller->nodeId(), previous,
                        controller->state());
    }
    bus.endFrame();

    FrameObservation observation;
    observation.now_ms = frame.now_ms;
    observation.nodes.reserve(controllers.size());
    for (const std::unique_ptr<SwarmController>& controller : controllers) {
      const auto index = static_cast<std::size_t>(controller->nodeId());
      observation.nodes.push_back(observe(*controller, orbits[index]));
    }
    result.frames.push_back(std::move(observation));
  }

  return result;
}

} // namespace satellite_swarm::simulation
