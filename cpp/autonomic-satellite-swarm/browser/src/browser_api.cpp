#include "satellite_swarm/browser_api.hpp"

#include "satellite_swarm/browser_simulation.hpp"
#include "satellite_swarm/fair_allocation_simulation.hpp"

#include <array>
#include <cstddef>
#include <exception>
#include <stdexcept>
#include <string>

#ifdef __EMSCRIPTEN__
#include <emscripten/emscripten.h>
#define SATELLITE_SWARM_KEEPALIVE EMSCRIPTEN_KEEPALIVE
#else
#define SATELLITE_SWARM_KEEPALIVE
#endif

#ifndef SATELLITE_SWARM_SOURCE_REVISION
#define SATELLITE_SWARM_SOURCE_REVISION "unknown"
#endif

namespace {

constexpr uint32_t kBrowserApiVersion = 8U;
constexpr std::size_t kBrowserErrorCapacity = 256U;

satellite_swarm::simulation::BrowserScenario parseScenario(uint32_t scenario) {
  if (scenario == static_cast<uint32_t>(satellite_swarm::simulation::BrowserScenario::Nominal)) {
    return satellite_swarm::simulation::BrowserScenario::Nominal;
  }
  if (scenario ==
      static_cast<uint32_t>(satellite_swarm::simulation::BrowserScenario::LostAssignment)) {
    return satellite_swarm::simulation::BrowserScenario::LostAssignment;
  }
  if (scenario ==
      static_cast<uint32_t>(satellite_swarm::simulation::BrowserScenario::SafeStateSuccess)) {
    return satellite_swarm::simulation::BrowserScenario::SafeStateSuccess;
  }
  throw std::invalid_argument("unknown browser simulation scenario");
}

struct BrowserState {
  std::string result;
  std::array<char, kBrowserErrorCapacity> error{};
};

BrowserState& browserState() {
  static BrowserState state;
  return state;
}

void clearBrowserError(BrowserState& state) noexcept { state.error.front() = '\0'; }

void setBrowserError(BrowserState& state, const char* message) noexcept {
  std::size_t index = 0U;
  while (index + 1U < state.error.size() && message[index] != '\0') {
    state.error[index] = message[index];
    ++index;
  }
  state.error[index] = '\0';
}

} // namespace

extern "C" SATELLITE_SWARM_KEEPALIVE uint32_t satellite_swarm_browser_api_version() noexcept {
  return kBrowserApiVersion;
}

extern "C" SATELLITE_SWARM_KEEPALIVE const char* satellite_swarm_source_revision() noexcept {
  return SATELLITE_SWARM_SOURCE_REVISION;
}

extern "C" SATELLITE_SWARM_KEEPALIVE const char*
satellite_swarm_run_demonstration(float longitude_degrees, float latitude_degrees,
                                  uint32_t scenario) noexcept {
  auto& state = browserState();
  try {
    state.result = satellite_swarm::simulation::runBrowserDemonstration(
        satellite_swarm::Coordinate(longitude_degrees, latitude_degrees), parseScenario(scenario));
    clearBrowserError(state);
    return state.result.c_str();
  } catch (const std::exception& error) {
    state.result.clear();
    setBrowserError(state, error.what());
    return nullptr;
  } catch (...) {
    state.result.clear();
    setBrowserError(state, "unknown simulation error");
    return nullptr;
  }
}

extern "C" SATELLITE_SWARM_KEEPALIVE const char*
satellite_swarm_run_fair_allocation_evidence() noexcept {
  auto& state = browserState();
  try {
    state.result = satellite_swarm::simulation::runFairAllocationEvidence();
    clearBrowserError(state);
    return state.result.c_str();
  } catch (const std::exception& error) {
    state.result.clear();
    setBrowserError(state, error.what());
    return nullptr;
  } catch (...) {
    state.result.clear();
    setBrowserError(state, "unknown simulation error");
    return nullptr;
  }
}

extern "C" SATELLITE_SWARM_KEEPALIVE const char* satellite_swarm_last_error() noexcept {
  return browserState().error.data();
}
