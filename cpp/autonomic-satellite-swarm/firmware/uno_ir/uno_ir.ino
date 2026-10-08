#include "src/uno_ir_transport.hpp"

#include <satellite_swarm/satellite_swarm.hpp>

#ifndef SATELLITE_SWARM_NODE_ID
#error "Define SATELLITE_SWARM_NODE_ID through the firmware build task"
#endif
#ifndef SATELLITE_SWARM_BOOT_EPOCH
#error "Define SATELLITE_SWARM_BOOT_EPOCH through the firmware build task"
#endif

namespace {

static_assert(SATELLITE_SWARM_NODE_ID >= 0 &&
                  SATELLITE_SWARM_NODE_ID < satellite_swarm::kMaximumNodes,
              "SATELLITE_SWARM_NODE_ID must identify a configured swarm node");
constexpr uint8_t kNodeId = SATELLITE_SWARM_NODE_ID;
constexpr satellite_swarm::BootEpoch kBootEpoch = SATELLITE_SWARM_BOOT_EPOCH;
static_assert(kBootEpoch != 0U, "SATELLITE_SWARM_BOOT_EPOCH must be nonzero");
const uint8_t kReceivePin = A4;
const uint8_t kSendPin = 3;
const uint8_t kMissionButtonPin = 2;
const uint32_t kButtonDebounceMs = 250U;
const uint32_t kTelemetryIntervalMs = 1000U;

class NominalHealthMonitor : public satellite_swarm::HealthMonitor {
public:
  satellite_swarm::HealthStatus poll() override { return satellite_swarm::HealthStatus::Nominal; }
};

class SerialTelemetrySink : public satellite_swarm::TelemetrySink {
public:
  bool publish(const satellite_swarm::TelemetryEvent& event) override {
    if (Serial.availableForWrite() <
        static_cast<int>(satellite_swarm::TelemetryCodec::kFrameSize)) {
      return false;
    }
    uint8_t frame[satellite_swarm::TelemetryCodec::kFrameSize]{};
    if (!satellite_swarm::TelemetryCodec::encode(event, frame, sizeof(frame))) {
      return false;
    }
    return Serial.write(frame, sizeof(frame)) == sizeof(frame);
  }
};

UnoInfraredTransport transport(kReceivePin, kSendPin);
NominalHealthMonitor health_monitor;
satellite_swarm::HistoricalOrbitalScorer scorer;
satellite_swarm::SatelliteSnapshot makeSatellite() {
  satellite_swarm::SatelliteSnapshot value;
  value.coordinate = satellite_swarm::Coordinate(0.0F, 90.0F);
  return value;
}
satellite_swarm::ControllerConfig makeConfig() {
  satellite_swarm::ControllerConfig value;
  value.node_capacity = 3U;
  return value;
}
satellite_swarm::TelemetryTransmitterConfig makeTelemetryConfig() {
  satellite_swarm::TelemetryTransmitterConfig value;
  value.minimum_interval_ms = kTelemetryIntervalMs;
  return value;
}
satellite_swarm::SatelliteSnapshot satellite = makeSatellite();
satellite_swarm::ControllerConfig config = makeConfig();
satellite_swarm::SwarmController controller(kNodeId, kBootEpoch, satellite, transport,
                                            health_monitor, scorer, config);
SerialTelemetrySink telemetry_sink;
satellite_swarm::TelemetryTransmitterConfig telemetry_config = makeTelemetryConfig();
satellite_swarm::TelemetryTransmitter telemetry_transmitter(controller, telemetry_sink,
                                                            telemetry_config);
uint32_t last_button_press_ms = 0;

void updateStatusLed() {
  const bool on = controller.state() == satellite_swarm::ControllerState::Active ||
                  controller.state() == satellite_swarm::ControllerState::SafeDisabled;
  digitalWrite(LED_BUILTIN, on ? HIGH : LOW);
}

} // namespace

void setup() {
  Serial.begin(115200);
  pinMode(LED_BUILTIN, OUTPUT);
  pinMode(kMissionButtonPin, INPUT_PULLUP);
  transport.begin();
  Serial.println(F("Autonomic Satellite Swarm: Arduino Uno/IR ready"));
}

void loop() {
  const uint32_t now_ms = millis();
  if (digitalRead(kMissionButtonPin) == LOW &&
      static_cast<uint32_t>(now_ms - last_button_press_ms) >= kButtonDebounceMs) {
    controller.initiateMission(satellite_swarm::Coordinate(0.0F, -90.0F), now_ms);
    last_button_press_ms = now_ms;
  }

  controller.update(now_ms);
  updateStatusLed();
  telemetry_transmitter.update(now_ms, true);
}
