#ifndef SATELLITE_SWARM_MANEUVER_HPP
#define SATELLITE_SWARM_MANEUVER_HPP

#include "satellite_swarm/orbit.hpp"

#include <stdexcept>
#include <stdint.h>
#include <vector>

namespace satellite_swarm::simulation {

constexpr double kEarthGravitationalParameterMetresCubedPerSecondSquared = 3.986004418e14;

struct EarthOrientationInputs {
  int32_t tai_minus_utc_seconds = 32;
  double ut1_minus_utc_seconds = 0.0;
  double polar_motion_x_radians = 0.0;
  double polar_motion_y_radians = 0.0;
};

enum class TrajectoryRole : uint8_t { CurrentCoast, Transfer, TargetOrbit };
enum class ManeuverEventRole : uint8_t { DepartureBurn, ArrivalBurn };

struct TrajectorySample {
  TrajectoryRole role = TrajectoryRole::CurrentCoast;
  OrbitalStateVector state{};
};

struct ManeuverEvent {
  ManeuverEventRole role = ManeuverEventRole::DepartureBurn;
  int64_t epoch_unix_milliseconds = 0;
  OrbitalCoordinateFrame frame = OrbitalCoordinateFrame::Gcrf;
  CartesianVector position_metres{};
  CartesianVector delta_velocity_metres_per_second{};
};

struct ManeuverScenario {
  int64_t departure_epoch_unix_milliseconds = 0;
  int64_t arrival_epoch_unix_milliseconds = 0;
  int64_t end_epoch_unix_milliseconds = 0;
  uint32_t sample_interval_milliseconds = 60'000U;
  double target_altitude_metres = 550'000.0;
  double maximum_total_delta_velocity_metres_per_second = 20'000.0;
  EarthOrientationInputs earth_orientation{};
};

struct ManeuverPlan {
  std::vector<TrajectorySample> current_coast;
  std::vector<TrajectorySample> transfer;
  std::vector<TrajectorySample> target_orbit;
  std::vector<ManeuverEvent> events;
  double total_delta_velocity_metres_per_second = 0.0;
};

class ManeuverPlanningError final : public std::runtime_error {
public:
  enum class Code : uint8_t {
    InvalidScenario,
    InvalidInitialState,
    TransformFailure,
    LambertFailure,
    PropagationFailure,
    DeltaVelocityLimitExceeded
  };

  ManeuverPlanningError(Code code, const char* message)
      : std::runtime_error(message), code_(code) {}
  Code code() const noexcept { return code_; }

private:
  Code code_;
};

OrbitalStateVector temeToGcrf(const OrbitalStateVector& teme,
                              const EarthOrientationInputs& earth_orientation);
CartesianVector objectivePositionInGcrf(Coordinate objective, double altitude_metres,
                                        int64_t epoch_unix_milliseconds,
                                        const EarthOrientationInputs& earth_orientation);
OrbitalStateVector propagateTwoBody(const OrbitalStateVector& initial,
                                    int64_t epoch_unix_milliseconds);
ManeuverPlan planManeuver(const Sgp4Orbit& current_orbit, Coordinate objective,
                          const ManeuverScenario& scenario);

} // namespace satellite_swarm::simulation

#endif
