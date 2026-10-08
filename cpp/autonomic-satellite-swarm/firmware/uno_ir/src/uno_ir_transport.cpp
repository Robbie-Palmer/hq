#define DECODE_NEC
#include "uno_ir_transport.hpp"

#include <IRremote.hpp>

UnoInfraredTransport::UnoInfraredTransport(uint8_t receive_pin, uint8_t send_pin)
    : receive_pin_(receive_pin), send_pin_(send_pin) {}

void UnoInfraredTransport::begin() {
  IrReceiver.begin(receive_pin_, DISABLE_LED_FEEDBACK);
  IrSender.begin(send_pin_, DISABLE_LED_FEEDBACK);
}

bool UnoInfraredTransport::send(const satellite_swarm::Message& message) {
  uint8_t packet[satellite_swarm::WireCodec::kPacketSize]{};
  if (!satellite_swarm::WireCodec::encode(message, packet, sizeof(packet))) {
    return false;
  }

  IrReceiver.stop();
  for (uint8_t chunk = 0; chunk < kChunkCount; ++chunk) {
    const auto offset = static_cast<uint8_t>(chunk * kChunkBytes);
    const auto frame = (static_cast<uint32_t>(kFramePrefix | chunk) << 24U) |
                       (static_cast<uint32_t>(packet[offset]) << 16U) |
                       (static_cast<uint32_t>(packet[offset + 1U]) << 8U) |
                       static_cast<uint32_t>(packet[offset + 2U]);
    IrSender.sendNECRaw(frame, 0);
    delay(10U);
  }
  IrReceiver.start();
  return true;
}

bool UnoInfraredTransport::receive(satellite_swarm::Message& message) {
  const uint32_t now_ms = millis();
  if (received_chunks_ != 0U && now_ms - last_chunk_at_ms_ >= kAssemblyTimeoutMs) {
    resetAssembly();
  }
  if (!IrReceiver.decode()) {
    return false;
  }

  const auto frame = static_cast<uint32_t>(IrReceiver.decodedIRData.decodedRawData);
  IrReceiver.resume();
  const auto header = static_cast<uint8_t>(frame >> 24U);
  if ((header & 0xF8U) != kFramePrefix) {
    return false;
  }

  const uint8_t chunk = header & 0x07U;
  if (chunk >= kChunkCount) {
    return false;
  }
  if (chunk == 0U) {
    resetAssembly();
  }
  const auto offset = static_cast<uint8_t>(chunk * kChunkBytes);
  packet_[offset] = static_cast<uint8_t>(frame >> 16U);
  packet_[offset + 1U] = static_cast<uint8_t>(frame >> 8U);
  packet_[offset + 2U] = static_cast<uint8_t>(frame);
  received_chunks_ |= static_cast<uint8_t>(1U << chunk);
  last_chunk_at_ms_ = now_ms;

  constexpr auto kCompleteAssembly = static_cast<uint8_t>((1U << kChunkCount) - 1U);
  if (received_chunks_ != kCompleteAssembly) {
    return false;
  }
  const bool decoded = satellite_swarm::WireCodec::decode(packet_, sizeof(packet_), message);
  resetAssembly();
  return decoded;
}

void UnoInfraredTransport::resetAssembly() { received_chunks_ = 0U; }
