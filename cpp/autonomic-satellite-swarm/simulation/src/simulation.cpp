#include "satellite_swarm/simulation.hpp"

#include "satellite_swarm/historical_orbital_scorer.hpp"
#include "satellite_swarm/wire_codec.hpp"

#include <algorithm>
#include <array>
#include <cmath>
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

using EncodedPacket = std::array<uint8_t, WireCodec::kPacketSize>;

struct SimulatedPacket {
  uint64_t id = 0U;
  NodeId current_sender = 0U;
  NodeId next_hop = 0U;
  NodeId final_recipient = 0U;
  uint8_t hop_count = 0U;
  Message message;
  EncodedPacket bytes{};
};

class SimulationBus {
public:
  SimulationBus(std::vector<SimulationEvent>& events, const SimulationTrace& trace)
      : events_(events), seeded_faults_(trace.seeded_delivery_faults),
        packet_network_(trace.packet_network), routes_(trace.routes),
        record_delivery_decisions_(trace.record_delivery_decisions),
        record_resource_samples_(trace.record_resource_samples),
        random_state_(trace.provenance.seed) {
    if (random_state_ == 0U) {
      random_state_ = 0x9e3779b97f4a7c15ULL;
    }
    for (auto& sender_links : links_) {
      sender_links.fill(true);
    }
    for (const NodeConfiguration& node : trace.nodes) {
      const auto index = static_cast<std::size_t>(node.node_id);
      protocol_versions_[index] = node.protocol_version;
      buffer_capacities_[index] = node.receive_buffer_capacity;
      transmit_queue_capacities_[index] = node.transmit_queue_capacity;
      running_[index] = true;
    }
  }

  void attach(SimulationTransport& transport);
  void beginFrame(const SimulationFrame& frame);
  void releasePending();
  void endFrame();
  bool broadcast(NodeId sender, const Message& message, const EncodedPacket& bytes);
  void reset(NodeId node_id);
  void crash(NodeId node_id);
  void setBufferCapacity(NodeId node_id, uint16_t capacity);
  void recordResourceSamples();
  bool running(NodeId node_id) const { return running_[node_id]; }
  uint16_t protocolVersion(NodeId node_id) const { return protocol_versions_[node_id]; }
  uint16_t bufferCapacity(NodeId node_id) const { return buffer_capacities_[node_id]; }
  uint16_t bufferOccupancy(NodeId node_id) const;
  uint16_t transmitQueueCapacity(NodeId node_id) const {
    return transmit_queue_capacities_[node_id];
  }
  uint16_t transmitQueueOccupancy(NodeId node_id) const {
    return static_cast<uint16_t>(transmit_queues_[node_id].size());
  }

private:
  struct PendingDelivery {
    PendingDelivery(uint32_t delivery_time_ms, const SimulatedPacket& delivery_packet,
                    bool delivery_is_forwarding)
        : deliver_at_ms(delivery_time_ms), packet(delivery_packet),
          forwarding(delivery_is_forwarding) {}

    uint32_t deliver_at_ms;
    SimulatedPacket packet;
    bool forwarding;
  };

  struct ActiveTransmission {
    SimulatedPacket packet;
    uint32_t started_at_ms = 0U;
    uint32_t completes_at_ms = 0U;
    uint64_t airtime_microseconds = 0U;
  };

  using DeliveryFaultIterator = std::vector<DeliveryFault>::iterator;

  void deliverLegacy(const SimulatedPacket& packet);
  void deliverNow(const SimulatedPacket& packet,
                  SimulationEventType event_type = SimulationEventType::MessageDelivered);
  void recordDeliveryEvent(SimulationEventType type, NodeId sender, NodeId recipient,
                           const SimulatedPacket& packet, uint32_t deliver_at_ms = 0U,
                           MessageDropReason drop_reason = MessageDropReason::Scripted);
  void recordPacketEvent(SimulationEventType type, const SimulatedPacket& packet,
                         uint32_t transmission_end_ms = 0U, uint64_t airtime_microseconds = 0U);
  DeliveryFaultIterator matchingFault(NodeId sender, NodeId recipient, MessageType message_type);
  uint32_t nextRandomPermyriad();
  DeliveryDecisionType seededDecision(uint32_t sample) const;
  void recordDecision(const SimulatedPacket& packet, uint32_t sample, DeliveryDecisionType decision,
                      uint32_t deliver_at_ms = 0U);
  bool enqueuePacket(const SimulatedPacket& packet);
  NodeId nextHop(NodeId sender, NodeId destination) const;
  void startTransmissionIfIdle();
  void completeTransmission(const ActiveTransmission& transmission);
  void scheduleArrival(const SimulatedPacket& packet, uint32_t delay_ms, bool forwarding);
  void processArrival(const PendingDelivery& delivery);
  void advancePacketNetwork(uint32_t target_ms, bool include_target);
  uint64_t packetAirtimeMicroseconds() const;
  uint32_t packetTransmissionMilliseconds() const;

  std::vector<SimulationTransport*> transports_;
  std::vector<SimulationEvent>& events_;
  std::array<std::array<bool, kMaximumNodes>, kMaximumNodes> links_{};
  std::array<uint16_t, kMaximumNodes> protocol_versions_{};
  std::array<uint16_t, kMaximumNodes> buffer_capacities_{};
  std::array<uint16_t, kMaximumNodes> transmit_queue_capacities_{};
  std::array<bool, kMaximumNodes> running_{};
  std::array<uint64_t, kMaximumNodes> bytes_sent_{};
  std::array<uint64_t, kMaximumNodes> bytes_received_{};
  std::array<uint64_t, kMaximumNodes> bytes_dropped_{};
  std::array<uint16_t, kMaximumNodes> peak_buffer_occupancy_{};
  std::array<uint16_t, kMaximumNodes> peak_transmit_queue_occupancy_{};
  std::array<uint64_t, kMaximumNodes> airtime_microseconds_{};
  std::array<std::deque<SimulatedPacket>, kMaximumNodes> transmit_queues_{};
  std::vector<DeliveryFault> delivery_faults_;
  std::vector<PendingDelivery> pending_deliveries_;
  std::optional<ActiveTransmission> active_transmission_;
  SeededDeliveryFaults seeded_faults_{};
  PacketNetworkConfig packet_network_{};
  std::vector<RouteEntry> routes_;
  bool record_delivery_decisions_ = false;
  bool record_resource_samples_ = false;
  uint64_t random_state_ = 0U;
  uint64_t next_packet_id_ = 1U;
  std::size_t next_medium_sender_ = 0U;
  uint32_t now_ms_ = 0U;
};

class SimulationTransport : public Transport {
public:
  SimulationTransport(NodeId node_id, SimulationBus& bus) : node_id_(node_id), bus_(bus) {
    bus_.attach(*this);
  }

  bool send(const Message& message) override {
    EncodedPacket packet{};
    if (!WireCodec::encode(message, packet.data(), packet.size())) {
      return false;
    }
    return bus_.broadcast(node_id_, message, packet);
  }

  bool receive(Message& message) override {
    while (!inbox_.empty()) {
      const EncodedPacket packet = inbox_.front();
      inbox_.pop_front();
      if (WireCodec::decode(packet.data(), packet.size(), message)) {
        return true;
      }
    }
    return false;
  }

  bool deliver(const EncodedPacket& packet, uint16_t capacity) {
    if (inbox_.size() >= static_cast<std::size_t>(capacity)) {
      return false;
    }
    inbox_.push_back(packet);
    return true;
  }
  void reset() { inbox_.clear(); }
  uint16_t occupancy() const { return static_cast<uint16_t>(inbox_.size()); }

private:
  NodeId node_id_;
  SimulationBus& bus_;
  std::deque<EncodedPacket> inbox_;
};

void SimulationBus::attach(SimulationTransport& transport) { transports_.push_back(&transport); }

void SimulationBus::beginFrame(const SimulationFrame& frame) {
  if (packet_network_.enabled) {
    advancePacketNetwork(frame.now_ms, false);
  }
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
  for (const ContactUpdate& update : frame.contact_updates) {
    links_[update.sender][update.recipient] = update.connected;
    SimulationEvent event;
    event.type = SimulationEventType::ContactObserved;
    event.now_ms = now_ms_;
    event.node_id = update.sender;
    event.recipient_node = update.recipient;
    event.planned_connected = update.planned_connected;
    event.connected = update.connected;
    events_.push_back(event);
  }
}

void SimulationBus::endFrame() {
  if (!delivery_faults_.empty()) {
    throw std::invalid_argument("simulation delivery fault did not match a message");
  }
  if (packet_network_.enabled) {
    startTransmissionIfIdle();
  }
}

void SimulationBus::reset(NodeId node_id) {
  transports_.at(static_cast<std::size_t>(node_id))->reset();
  running_[node_id] = true;
}

void SimulationBus::crash(NodeId node_id) {
  transports_.at(static_cast<std::size_t>(node_id))->reset();
  running_[node_id] = false;
  auto& queue = transmit_queues_[node_id];
  for (const SimulatedPacket& packet : queue) {
    bytes_dropped_[node_id] += packet.bytes.size();
    recordDeliveryEvent(SimulationEventType::MessageDropped, packet.current_sender, packet.next_hop,
                        packet, 0U, MessageDropReason::NodeCrashed);
  }
  queue.clear();
  if (active_transmission_.has_value() && active_transmission_->packet.current_sender == node_id) {
    const SimulatedPacket packet = active_transmission_->packet;
    bytes_dropped_[node_id] += packet.bytes.size();
    recordDeliveryEvent(SimulationEventType::MessageDropped, packet.current_sender, packet.next_hop,
                        packet, 0U, MessageDropReason::NodeCrashed);
    active_transmission_.reset();
  }
}

void SimulationBus::setBufferCapacity(NodeId node_id, uint16_t capacity) {
  buffer_capacities_[node_id] = capacity;
  SimulationEvent event;
  event.type = SimulationEventType::StoragePressureChanged;
  event.now_ms = now_ms_;
  event.node_id = node_id;
  event.buffer_occupancy = bufferOccupancy(node_id);
  event.buffer_capacity = capacity;
  events_.push_back(event);
}

uint16_t SimulationBus::bufferOccupancy(NodeId node_id) const {
  return transports_.at(static_cast<std::size_t>(node_id))->occupancy();
}

void SimulationBus::recordDeliveryEvent(SimulationEventType type, NodeId sender, NodeId recipient,
                                        const SimulatedPacket& packet, uint32_t deliver_at_ms,
                                        MessageDropReason drop_reason) {
  SimulationEvent event;
  event.type = type;
  event.now_ms = now_ms_;
  event.node_id = sender;
  event.recipient_node = recipient;
  event.final_recipient_node = packet.final_recipient;
  event.packet_id = packet.id;
  event.packet_size = static_cast<uint16_t>(packet.bytes.size());
  event.message = packet.message;
  event.deliver_at_ms = deliver_at_ms;
  event.drop_reason = drop_reason;
  events_.push_back(event);
}

void SimulationBus::recordPacketEvent(SimulationEventType type, const SimulatedPacket& packet,
                                      uint32_t transmission_end_ms, uint64_t airtime_microseconds) {
  SimulationEvent event;
  event.type = type;
  event.now_ms = now_ms_;
  event.node_id = packet.current_sender;
  event.recipient_node = packet.next_hop;
  event.final_recipient_node = packet.final_recipient;
  event.packet_id = packet.id;
  event.packet_size = static_cast<uint16_t>(packet.bytes.size());
  event.transmission_end_ms = transmission_end_ms;
  event.airtime_microseconds = airtime_microseconds;
  event.message = packet.message;
  const auto sender = static_cast<std::size_t>(packet.current_sender);
  event.transmit_queue_occupancy = static_cast<uint16_t>(transmit_queues_[sender].size());
  event.transmit_queue_capacity = transmit_queue_capacities_[sender];
  events_.push_back(event);
}

uint32_t SimulationBus::nextRandomPermyriad() {
  random_state_ ^= random_state_ >> 12U;
  random_state_ ^= random_state_ << 25U;
  random_state_ ^= random_state_ >> 27U;
  const uint64_t value = random_state_ * 2685821657736338717ULL;
  return static_cast<uint32_t>(value % 10000U);
}

DeliveryDecisionType SimulationBus::seededDecision(uint32_t sample) const {
  uint32_t boundary = seeded_faults_.loss_permyriad;
  if (sample < boundary) {
    return DeliveryDecisionType::Drop;
  }
  boundary += seeded_faults_.delay_permyriad;
  if (sample < boundary) {
    return DeliveryDecisionType::Delay;
  }
  boundary += seeded_faults_.duplicate_permyriad;
  if (sample < boundary) {
    return DeliveryDecisionType::Duplicate;
  }
  boundary += seeded_faults_.reorder_permyriad;
  return sample < boundary ? DeliveryDecisionType::Reorder : DeliveryDecisionType::Deliver;
}

void SimulationBus::recordDecision(const SimulatedPacket& packet, uint32_t sample,
                                   DeliveryDecisionType decision, uint32_t deliver_at_ms) {
  if (!record_delivery_decisions_) {
    return;
  }
  SimulationEvent event;
  event.type = SimulationEventType::DeliveryDecision;
  event.now_ms = now_ms_;
  event.node_id = packet.current_sender;
  event.recipient_node = packet.next_hop;
  event.final_recipient_node = packet.final_recipient;
  event.packet_id = packet.id;
  event.packet_size = static_cast<uint16_t>(packet.bytes.size());
  event.message = packet.message;
  event.random_value = sample;
  event.delivery_decision = decision;
  event.deliver_at_ms = deliver_at_ms;
  events_.push_back(event);
}

void SimulationBus::deliverNow(const SimulatedPacket& packet, SimulationEventType event_type) {
  if (!transports_.at(static_cast<std::size_t>(packet.final_recipient))
           ->deliver(packet.bytes, buffer_capacities_[packet.final_recipient])) {
    bytes_dropped_[packet.final_recipient] += packet.bytes.size();
    recordDeliveryEvent(SimulationEventType::MessageDropped, packet.current_sender,
                        packet.final_recipient, packet, 0U, MessageDropReason::StoragePressure);
    return;
  }
  bytes_received_[packet.final_recipient] += packet.bytes.size();
  peak_buffer_occupancy_[packet.final_recipient] = std::max(
      peak_buffer_occupancy_[packet.final_recipient], bufferOccupancy(packet.final_recipient));
  if (record_delivery_decisions_ || event_type == SimulationEventType::DelayedMessageDelivered) {
    recordDeliveryEvent(event_type, packet.current_sender, packet.final_recipient, packet);
  }
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

void SimulationBus::deliverLegacy(const SimulatedPacket& packet) {
  const NodeId sender = packet.current_sender;
  const NodeId recipient = packet.final_recipient;
  const DeliveryFaultIterator fault = matchingFault(sender, recipient, packet.message.type);
  const bool has_fault = fault != delivery_faults_.end();
  DeliveryFault selected;
  if (has_fault) {
    selected = *fault;
    delivery_faults_.erase(fault);
  }

  if (!running_[sender] || !running_[recipient]) {
    bytes_dropped_[recipient] += packet.bytes.size();
    recordDeliveryEvent(SimulationEventType::MessageDropped, sender, recipient, packet, 0U,
                        MessageDropReason::NodeCrashed);
    return;
  }
  if (!links_[sender][recipient]) {
    bytes_dropped_[recipient] += packet.bytes.size();
    recordDeliveryEvent(SimulationEventType::MessageDropped, sender, recipient, packet, 0U,
                        MessageDropReason::LinkUnavailable);
    return;
  }
  if (protocol_versions_[sender] != protocol_versions_[recipient]) {
    bytes_dropped_[recipient] += packet.bytes.size();
    recordDeliveryEvent(SimulationEventType::MessageDropped, sender, recipient, packet, 0U,
                        MessageDropReason::IncompatibleProtocol);
    return;
  }

  DeliveryDecisionType decision = DeliveryDecisionType::Deliver;
  uint32_t sample = 0U;
  if (!has_fault && seeded_faults_.enabled) {
    sample = nextRandomPermyriad();
    decision = seededDecision(sample);
  }

  if (!has_fault && decision == DeliveryDecisionType::Deliver) {
    recordDecision(packet, sample, decision);
    deliverNow(packet);
    return;
  }
  if (!has_fault) {
    const uint32_t delay_span = seeded_faults_.maximum_delay_ms - seeded_faults_.minimum_delay_ms;
    const uint32_t delay =
        seeded_faults_.minimum_delay_ms + (delay_span == 0U ? 0U : sample % (delay_span + 1U));
    if (decision == DeliveryDecisionType::Drop) {
      recordDecision(packet, sample, decision);
      bytes_dropped_[recipient] += packet.bytes.size();
      recordDeliveryEvent(SimulationEventType::MessageDropped, sender, recipient, packet);
      return;
    }
    if (decision == DeliveryDecisionType::Delay || decision == DeliveryDecisionType::Reorder) {
      const uint32_t effective_delay =
          decision == DeliveryDecisionType::Reorder ? seeded_faults_.maximum_delay_ms : delay;
      const uint32_t deliver_at_ms = now_ms_ + effective_delay;
      recordDecision(packet, sample, decision, deliver_at_ms);
      pending_deliveries_.emplace_back(deliver_at_ms, packet, false);
      recordDeliveryEvent(SimulationEventType::MessageDelayed, sender, recipient, packet,
                          deliver_at_ms);
      return;
    }
    recordDecision(packet, sample, decision);
    deliverNow(packet);
    deliverNow(packet);
    recordDeliveryEvent(SimulationEventType::MessageDuplicated, sender, recipient, packet);
    return;
  }

  switch (selected.type) {
  case DeliveryFaultType::Drop:
    bytes_dropped_[recipient] += packet.bytes.size();
    recordDeliveryEvent(SimulationEventType::MessageDropped, sender, recipient, packet);
    break;
  case DeliveryFaultType::Delay: {
    const uint32_t deliver_at_ms = now_ms_ + selected.delay_ms;
    pending_deliveries_.emplace_back(deliver_at_ms, packet, false);
    recordDeliveryEvent(SimulationEventType::MessageDelayed, sender, recipient, packet,
                        deliver_at_ms);
    break;
  }
  case DeliveryFaultType::Duplicate:
    deliverNow(packet);
    deliverNow(packet);
    recordDeliveryEvent(SimulationEventType::MessageDuplicated, sender, recipient, packet);
    break;
  }
}

void SimulationBus::releasePending() {
  if (packet_network_.enabled) {
    advancePacketNetwork(now_ms_, true);
    return;
  }
  auto pending = pending_deliveries_.begin();
  while (pending != pending_deliveries_.end()) {
    const uint32_t elapsed_since_delivery = now_ms_ - pending->deliver_at_ms;
    const auto maximum_unambiguous_step =
        static_cast<uint32_t>(std::numeric_limits<int32_t>::max());
    if (elapsed_since_delivery > maximum_unambiguous_step) {
      ++pending;
      continue;
    }

    const SimulatedPacket& packet = pending->packet;
    if (running_[packet.final_recipient] && links_[packet.current_sender][packet.final_recipient]) {
      deliverNow(packet, SimulationEventType::DelayedMessageDelivered);
    } else {
      bytes_dropped_[packet.final_recipient] += packet.bytes.size();
      recordDeliveryEvent(SimulationEventType::MessageDropped, packet.current_sender,
                          packet.final_recipient, packet, 0U,
                          running_[packet.final_recipient] ? MessageDropReason::LinkUnavailable
                                                           : MessageDropReason::NodeCrashed);
    }
    pending = pending_deliveries_.erase(pending);
  }
}

bool SimulationBus::broadcast(NodeId sender, const Message& message, const EncodedPacket& bytes) {
  SimulationEvent event;
  event.type = SimulationEventType::MessageSent;
  event.now_ms = now_ms_;
  event.node_id = sender;
  event.message = message;
  event.packet_size = static_cast<uint16_t>(bytes.size());
  events_.push_back(event);

  if (!running_[sender]) {
    return false;
  }
  if (!packet_network_.enabled) {
    bytes_sent_[sender] += bytes.size();
  }

  bool admitted = true;
  for (std::size_t recipient = 0U; recipient < transports_.size(); ++recipient) {
    const auto recipient_id = static_cast<NodeId>(recipient);
    if (recipient_id != sender) {
      SimulatedPacket packet;
      packet.id = next_packet_id_++;
      packet.current_sender = sender;
      packet.next_hop = recipient_id;
      packet.final_recipient = recipient_id;
      packet.message = message;
      packet.bytes = bytes;
      if (!packet_network_.enabled) {
        deliverLegacy(packet);
        continue;
      }

      packet.next_hop = nextHop(sender, recipient_id);
      admitted = enqueuePacket(packet) && admitted;
    }
  }
  return admitted;
}

NodeId SimulationBus::nextHop(NodeId sender, NodeId destination) const {
  for (const RouteEntry& route : routes_) {
    if (route.sender == sender && route.destination == destination) {
      return route.next_hop;
    }
  }
  return destination;
}

bool SimulationBus::enqueuePacket(const SimulatedPacket& packet) {
  const auto sender = static_cast<std::size_t>(packet.current_sender);
  if (packet.hop_count >= packet_network_.maximum_hops) {
    bytes_dropped_[sender] += packet.bytes.size();
    recordDeliveryEvent(SimulationEventType::MessageDropped, packet.current_sender, packet.next_hop,
                        packet, 0U, MessageDropReason::RoutingLoop);
    return false;
  }
  if (transmit_queues_[sender].size() >=
      static_cast<std::size_t>(transmit_queue_capacities_[sender])) {
    bytes_dropped_[sender] += packet.bytes.size();
    recordDeliveryEvent(SimulationEventType::MessageDropped, packet.current_sender, packet.next_hop,
                        packet, 0U, MessageDropReason::TransmitQueueFull);
    return false;
  }
  transmit_queues_[sender].push_back(packet);
  peak_transmit_queue_occupancy_[sender] =
      std::max(peak_transmit_queue_occupancy_[sender],
               static_cast<uint16_t>(transmit_queues_[sender].size()));
  recordPacketEvent(SimulationEventType::PacketQueued, packet);
  return true;
}

uint64_t SimulationBus::packetAirtimeMicroseconds() const {
  const uint64_t packet_bits = static_cast<uint64_t>(WireCodec::kPacketSize) * 8U;
  const uint64_t numerator = packet_bits * 1000000U;
  return (numerator + packet_network_.bitrate_bits_per_second - 1U) /
         packet_network_.bitrate_bits_per_second;
}

uint32_t SimulationBus::packetTransmissionMilliseconds() const {
  const uint64_t airtime = packetAirtimeMicroseconds();
  return static_cast<uint32_t>((airtime + 999U) / 1000U);
}

void SimulationBus::startTransmissionIfIdle() {
  if (active_transmission_.has_value()) {
    return;
  }
  for (std::size_t offset = 0U; offset < transports_.size(); ++offset) {
    const std::size_t sender = (next_medium_sender_ + offset) % transports_.size();
    if (transmit_queues_[sender].empty()) {
      continue;
    }
    next_medium_sender_ = (sender + 1U) % transports_.size();
    SimulatedPacket packet = transmit_queues_[sender].front();
    transmit_queues_[sender].pop_front();
    ActiveTransmission transmission;
    transmission.packet = packet;
    transmission.started_at_ms = now_ms_;
    transmission.completes_at_ms = now_ms_ + packetTransmissionMilliseconds();
    transmission.airtime_microseconds = packetAirtimeMicroseconds();
    active_transmission_ = transmission;
    bytes_sent_[sender] += packet.bytes.size();
    airtime_microseconds_[sender] += transmission.airtime_microseconds;
    recordPacketEvent(SimulationEventType::TransmissionStarted, packet,
                      transmission.completes_at_ms, transmission.airtime_microseconds);
    return;
  }
}

void SimulationBus::scheduleArrival(const SimulatedPacket& packet, uint32_t delay_ms,
                                    bool forwarding) {
  pending_deliveries_.emplace_back(now_ms_ + packet_network_.propagation_delay_ms + delay_ms,
                                   packet, forwarding);
}

void SimulationBus::completeTransmission(const ActiveTransmission& transmission) {
  const SimulatedPacket& packet = transmission.packet;
  recordPacketEvent(SimulationEventType::TransmissionCompleted, packet,
                    transmission.completes_at_ms, transmission.airtime_microseconds);

  if (!running_[packet.next_hop]) {
    bytes_dropped_[packet.next_hop] += packet.bytes.size();
    recordDeliveryEvent(SimulationEventType::MessageDropped, packet.current_sender, packet.next_hop,
                        packet, 0U, MessageDropReason::NodeCrashed);
    return;
  }
  if (!links_[packet.current_sender][packet.next_hop]) {
    bytes_dropped_[packet.next_hop] += packet.bytes.size();
    recordDeliveryEvent(SimulationEventType::MessageDropped, packet.current_sender, packet.next_hop,
                        packet, 0U, MessageDropReason::LinkUnavailable);
    return;
  }
  if (protocol_versions_[packet.current_sender] != protocol_versions_[packet.next_hop]) {
    bytes_dropped_[packet.next_hop] += packet.bytes.size();
    recordDeliveryEvent(SimulationEventType::MessageDropped, packet.current_sender, packet.next_hop,
                        packet, 0U, MessageDropReason::IncompatibleProtocol);
    return;
  }

  uint32_t sample = 0U;
  DeliveryDecisionType decision = DeliveryDecisionType::Deliver;
  if (seeded_faults_.enabled) {
    sample = nextRandomPermyriad();
    decision = seededDecision(sample);
  }
  uint32_t fault_delay_ms = 0U;
  if (decision == DeliveryDecisionType::Delay || decision == DeliveryDecisionType::Reorder) {
    const uint32_t span = seeded_faults_.maximum_delay_ms - seeded_faults_.minimum_delay_ms;
    fault_delay_ms =
        decision == DeliveryDecisionType::Reorder
            ? seeded_faults_.maximum_delay_ms
            : seeded_faults_.minimum_delay_ms + (span == 0U ? 0U : sample % (span + 1U));
  }
  recordDecision(packet, sample, decision,
                 now_ms_ + packet_network_.propagation_delay_ms + fault_delay_ms);
  if (decision == DeliveryDecisionType::Drop) {
    bytes_dropped_[packet.next_hop] += packet.bytes.size();
    recordDeliveryEvent(SimulationEventType::MessageDropped, packet.current_sender, packet.next_hop,
                        packet);
    return;
  }

  const bool forwarding = packet.next_hop != packet.final_recipient;
  scheduleArrival(packet, fault_delay_ms, forwarding);
  if (decision == DeliveryDecisionType::Duplicate) {
    scheduleArrival(packet, fault_delay_ms, forwarding);
    recordDeliveryEvent(SimulationEventType::MessageDuplicated, packet.current_sender,
                        packet.next_hop, packet);
  } else if (decision == DeliveryDecisionType::Delay || decision == DeliveryDecisionType::Reorder) {
    recordDeliveryEvent(SimulationEventType::MessageDelayed, packet.current_sender, packet.next_hop,
                        packet, now_ms_ + packet_network_.propagation_delay_ms + fault_delay_ms);
  }
}

void SimulationBus::processArrival(const PendingDelivery& delivery) {
  SimulatedPacket packet = delivery.packet;
  if (!running_[packet.next_hop]) {
    bytes_dropped_[packet.next_hop] += packet.bytes.size();
    recordDeliveryEvent(SimulationEventType::MessageDropped, packet.current_sender, packet.next_hop,
                        packet, 0U, MessageDropReason::NodeCrashed);
    return;
  }
  if (!delivery.forwarding) {
    deliverNow(packet, packet_network_.propagation_delay_ms == 0U
                           ? SimulationEventType::MessageDelivered
                           : SimulationEventType::DelayedMessageDelivered);
    return;
  }

  bytes_received_[packet.next_hop] += packet.bytes.size();
  recordPacketEvent(SimulationEventType::PacketForwarded, packet);
  packet.current_sender = packet.next_hop;
  ++packet.hop_count;
  packet.next_hop = nextHop(packet.current_sender, packet.final_recipient);
  enqueuePacket(packet);
}

void SimulationBus::advancePacketNetwork(uint32_t target_ms, bool include_target) {
  while (true) {
    const uint32_t target_delta = target_ms - now_ms_;
    bool found = false;
    uint32_t next_delta = 0U;
    if (active_transmission_.has_value()) {
      const uint32_t delta = active_transmission_->completes_at_ms - now_ms_;
      if (delta < target_delta || (include_target && delta == target_delta)) {
        found = true;
        next_delta = delta;
      }
    }
    for (const PendingDelivery& pending : pending_deliveries_) {
      const uint32_t delta = pending.deliver_at_ms - now_ms_;
      if ((delta < target_delta || (include_target && delta == target_delta)) &&
          (!found || delta < next_delta)) {
        found = true;
        next_delta = delta;
      }
    }
    if (!found) {
      break;
    }

    now_ms_ += next_delta;
    if (active_transmission_.has_value() && active_transmission_->completes_at_ms == now_ms_) {
      const ActiveTransmission completed = *active_transmission_;
      active_transmission_.reset();
      completeTransmission(completed);
    }

    while (true) {
      auto selected = pending_deliveries_.end();
      for (auto pending = pending_deliveries_.begin(); pending != pending_deliveries_.end();
           ++pending) {
        if (pending->deliver_at_ms == now_ms_ &&
            (selected == pending_deliveries_.end() || pending->packet.id < selected->packet.id)) {
          selected = pending;
        }
      }
      if (selected == pending_deliveries_.end()) {
        break;
      }
      const PendingDelivery delivery = *selected;
      pending_deliveries_.erase(selected);
      processArrival(delivery);
    }
    startTransmissionIfIdle();
  }
  now_ms_ = target_ms;
}

void SimulationBus::recordResourceSamples() {
  if (!record_resource_samples_) {
    return;
  }
  for (std::size_t index = 0U; index < transports_.size(); ++index) {
    SimulationEvent event;
    event.type = SimulationEventType::ResourceSample;
    event.now_ms = now_ms_;
    event.node_id = static_cast<NodeId>(index);
    event.buffer_occupancy = transports_[index]->occupancy();
    event.buffer_capacity = buffer_capacities_[index];
    event.peak_buffer_occupancy = peak_buffer_occupancy_[index];
    event.transmit_queue_occupancy = static_cast<uint16_t>(transmit_queues_[index].size());
    event.transmit_queue_capacity = transmit_queue_capacities_[index];
    event.peak_transmit_queue_occupancy = peak_transmit_queue_occupancy_[index];
    event.bytes_sent = bytes_sent_[index];
    event.bytes_received = bytes_received_[index];
    event.bytes_dropped = bytes_dropped_[index];
    event.airtime_microseconds = airtime_microseconds_[index];
    event.estimated_energy_millijoules = static_cast<double>(bytes_sent_[index]) *
                                             packet_network_.transmit_energy_millijoules_per_byte +
                                         static_cast<double>(bytes_received_[index]) *
                                             packet_network_.receive_energy_millijoules_per_byte;
    events_.push_back(event);
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
  for (const ContactUpdate& update : frame.contact_updates) {
    validateNodeId(update.sender, node_count);
    validateNodeId(update.recipient, node_count);
    if (update.sender == update.recipient) {
      throw std::invalid_argument("simulation contact update cannot target its sender");
    }
  }
  for (const StoragePressureUpdate& update : frame.storage_pressure_updates) {
    validateNodeId(update.node_id, node_count);
  }
  for (const DeliveryFault& fault : frame.delivery_faults) {
    validateDeliveryFault(fault, node_count);
  }
  for (const NodeReset& reset : frame.node_resets) {
    validateNodeId(reset.node_id, node_count);
  }
  for (const NodeCrash& crash : frame.node_crashes) {
    validateNodeId(crash.node_id, node_count);
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
    if (node.protocol_version == 0U) {
      throw std::invalid_argument("simulation node protocol versions must be nonzero");
    }
  }

  const PacketNetworkConfig& network = trace.packet_network;
  if (network.enabled &&
      (network.bitrate_bits_per_second == 0U || network.maximum_hops == 0U ||
       network.propagation_delay_ms > static_cast<uint32_t>(std::numeric_limits<int32_t>::max()) ||
       !std::isfinite(network.transmit_energy_millijoules_per_byte) ||
       network.transmit_energy_millijoules_per_byte < 0.0 ||
       !std::isfinite(network.receive_energy_millijoules_per_byte) ||
       network.receive_energy_millijoules_per_byte < 0.0)) {
    throw std::invalid_argument("simulation packet network configuration is invalid");
  }
  for (std::size_t index = 0U; index < trace.routes.size(); ++index) {
    const RouteEntry& route = trace.routes[index];
    validateNodeId(route.sender, trace.nodes.size());
    validateNodeId(route.destination, trace.nodes.size());
    validateNodeId(route.next_hop, trace.nodes.size());
    if (route.sender == route.destination || route.sender == route.next_hop) {
      throw std::invalid_argument("simulation route has an invalid hop");
    }
    for (std::size_t previous = 0U; previous < index; ++previous) {
      if (trace.routes[previous].sender == route.sender &&
          trace.routes[previous].destination == route.destination) {
        throw std::invalid_argument("simulation routes contain a duplicate source and destination");
      }
    }
  }

  const SeededDeliveryFaults& faults = trace.seeded_delivery_faults;
  const uint32_t total_probability = static_cast<uint32_t>(faults.loss_permyriad) +
                                     static_cast<uint32_t>(faults.delay_permyriad) +
                                     static_cast<uint32_t>(faults.duplicate_permyriad) +
                                     static_cast<uint32_t>(faults.reorder_permyriad);
  if (total_probability > 10000U || faults.minimum_delay_ms == 0U ||
      faults.maximum_delay_ms < faults.minimum_delay_ms ||
      faults.maximum_delay_ms > static_cast<uint32_t>(std::numeric_limits<int32_t>::max())) {
    throw std::invalid_argument("simulation seeded delivery fault configuration is invalid");
  }
  if (network.enabled) {
    const uint64_t packet_bits = static_cast<uint64_t>(WireCodec::kPacketSize) * 8U;
    const uint64_t transmission_ms = (packet_bits * 1000U + network.bitrate_bits_per_second - 1U) /
                                     network.bitrate_bits_per_second;
    const uint64_t maximum_event_delay =
        transmission_ms + network.propagation_delay_ms +
        (faults.enabled && (faults.delay_permyriad != 0U || faults.reorder_permyriad != 0U)
             ? faults.maximum_delay_ms
             : 0U);
    if (maximum_event_delay > static_cast<uint64_t>(std::numeric_limits<int32_t>::max())) {
      throw std::invalid_argument("simulation packet event delay is ambiguous");
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
    if (network.enabled && !frame.delivery_faults.empty()) {
      throw std::invalid_argument(
          "packet network traces use seeded decisions instead of frame delivery faults");
    }
  }
}

void recordStateChange(std::vector<SimulationEvent>& events, uint32_t now_ms, NodeId node_id,
                       ControllerState previous, ControllerState current,
                       MissionKey mission_key = MissionKey()) {
  if (previous == current) {
    return;
  }
  SimulationEvent event;
  event.type = SimulationEventType::StateChanged;
  event.now_ms = now_ms;
  event.node_id = node_id;
  event.previous_state = previous;
  event.current_state = current;
  event.mission_key = mission_key;
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
                        const std::optional<PropagationResult>& orbit, const SimulationBus& bus) {
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
  observation.running = bus.running(controller.nodeId());
  observation.protocol_version = bus.protocolVersion(controller.nodeId());
  observation.buffer_occupancy = bus.bufferOccupancy(controller.nodeId());
  observation.buffer_capacity = bus.bufferCapacity(controller.nodeId());
  observation.transmit_queue_occupancy = bus.transmitQueueOccupancy(controller.nodeId());
  observation.transmit_queue_capacity = bus.transmitQueueCapacity(controller.nodeId());
  return observation;
}

} // namespace

SimulationResult runSimulationTrace(const SimulationTrace& trace) {
  validateTrace(trace);

  SimulationResult result;
  SimulationBus bus(result.events, trace);
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
    for (const StoragePressureUpdate& update : frame.storage_pressure_updates) {
      bus.setBufferCapacity(update.node_id, update.receive_buffer_capacity);
    }
    for (const NodeCrash& crash : frame.node_crashes) {
      const auto index = static_cast<std::size_t>(crash.node_id);
      bus.crash(crash.node_id);
      SimulationEvent event;
      event.type = SimulationEventType::NodeCrashed;
      event.now_ms = frame.now_ms;
      event.node_id = crash.node_id;
      event.running = false;
      event.previous_state = controllers[index]->state();
      event.current_state = controllers[index]->state();
      result.events.push_back(event);
    }
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
      event.running = true;
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
      result.events[event_index].accepted =
          bus.running(completion.node_id) && previous == ControllerState::Active;
      if (bus.running(completion.node_id)) {
        controller.completeMission(frame.now_ms);
        drainTelemetry(result.events, controller);
        recordStateChange(result.events, frame.now_ms, completion.node_id, previous,
                          controller.state(), controller.currentMissionKey());
      }
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
          bus.running(command.leader) &&
          controller.initiateMission(command.objective, frame.now_ms);
      if (bus.running(command.leader)) {
        drainTelemetry(result.events, controller);
        recordStateChange(result.events, frame.now_ms, command.leader, previous, controller.state(),
                          controller.currentMissionKey());
      }
    }

    for (const std::unique_ptr<SwarmController>& controller : controllers) {
      if (!bus.running(controller->nodeId())) {
        continue;
      }
      const ControllerState previous = controller->state();
      controller->update(frame.now_ms);
      drainTelemetry(result.events, *controller);
      recordStateChange(result.events, frame.now_ms, controller->nodeId(), previous,
                        controller->state(), controller->currentMissionKey());
    }
    bus.endFrame();
    bus.recordResourceSamples();

    FrameObservation observation;
    observation.now_ms = frame.now_ms;
    observation.nodes.reserve(controllers.size());
    for (const std::unique_ptr<SwarmController>& controller : controllers) {
      const auto index = static_cast<std::size_t>(controller->nodeId());
      observation.nodes.push_back(observe(*controller, orbits[index], bus));
    }
    result.frames.push_back(std::move(observation));
  }

  return result;
}

} // namespace satellite_swarm::simulation
