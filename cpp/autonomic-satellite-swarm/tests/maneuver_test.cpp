#include "satellite_swarm/maneuver.hpp"

#include <catch2/catch_approx.hpp>
#include <catch2/catch_test_macros.hpp>
#include <cmath>
#include <cstdint>
#include <limits>
#include <string>

using namespace satellite_swarm;
using namespace satellite_swarm::simulation;

namespace {

const TwoLineElementSet kReferenceElements{
    "1 00005U 58002B   00179.78495062  .00000023  00000-0  28098-4 0  4753",
    "2 00005  34.2682 348.7242 1859667 331.7664  19.3264 10.82419157413667"};

double magnitude(const CartesianVector& vector) {
  return std::sqrt(vector.x * vector.x + vector.y * vector.y + vector.z * vector.z);
}

double distance(const CartesianVector& left, const CartesianVector& right) {
  return magnitude({left.x - right.x, left.y - right.y, left.z - right.z});
}

double specificEnergy(const OrbitalStateVector& state) {
  const double speed = magnitude(state.velocity_metres_per_second);
  return speed * speed / 2.0 -
         kEarthGravitationalParameterMetresCubedPerSecondSquared / magnitude(state.position_metres);
}

ManeuverScenario referenceScenario(const Sgp4Orbit& orbit) {
  ManeuverScenario scenario;
  scenario.departure_epoch_unix_milliseconds = orbit.epochUnixMilliseconds() + 600'000;
  scenario.arrival_epoch_unix_milliseconds = orbit.epochUnixMilliseconds() + 4'200'000;
  scenario.end_epoch_unix_milliseconds = orbit.epochUnixMilliseconds() + 8'040'000;
  return scenario;
}

} // namespace

TEST_CASE("the pinned TEME to GCRF transform matches the scenario reference vector") {
  const Sgp4Orbit orbit(kReferenceElements);
  const OrbitalStateVector gcrf =
      temeToGcrf(orbit.propagate(orbit.epochUnixMilliseconds()).teme, {});

  CHECK(gcrf.frame == OrbitalCoordinateFrame::Gcrf);
  CHECK(gcrf.epoch_unix_milliseconds == 962'131'819'734);
  CHECK(gcrf.position_metres.x == Catch::Approx(7'022'312.0).margin(1.0));
  CHECK(gcrf.position_metres.y == Catch::Approx(-1'400'849.0).margin(1.0));
  CHECK(gcrf.position_metres.z == Catch::Approx(-112.0).margin(1.0));
  CHECK(gcrf.velocity_metres_per_second.x == Catch::Approx(1'894.619).margin(0.001));
  CHECK(gcrf.velocity_metres_per_second.y == Catch::Approx(6'405.588).margin(0.001));
  CHECK(gcrf.velocity_metres_per_second.z == Catch::Approx(4'534.914).margin(0.001));
}

TEST_CASE("frame transforms reject invalid frame, time, and objective inputs") {
  const Sgp4Orbit orbit(kReferenceElements);
  OrbitalStateVector state = orbit.propagate(orbit.epochUnixMilliseconds()).teme;
  state.frame = OrbitalCoordinateFrame::Gcrf;
  CHECK_THROWS_AS(temeToGcrf(state, {}), ManeuverPlanningError);

  state.frame = OrbitalCoordinateFrame::Teme;
  EarthOrientationInputs invalid_time;
  invalid_time.tai_minus_utc_seconds = 0;
  CHECK_THROWS_AS(temeToGcrf(state, invalid_time), ManeuverPlanningError);

  CHECK_THROWS_AS(objectivePositionInGcrf(Coordinate(0.0F, 91.0F), 550'000.0,
                                          orbit.epochUnixMilliseconds(), {}),
                  ManeuverPlanningError);
  CHECK_THROWS_AS(
      objectivePositionInGcrf(Coordinate(0.0F, 0.0F), -1.0, orbit.epochUnixMilliseconds(), {}),
      ManeuverPlanningError);
}

TEST_CASE("the WGS84 objective transform uses the pinned arrival epoch and GCRF frame") {
  const CartesianVector south_pole =
      objectivePositionInGcrf(Coordinate(0.0F, -90.0F), 550'000.0, 962'136'019'734, {});

  CHECK(south_pole.x == Catch::Approx(-120.0).margin(1.0));
  CHECK(south_pole.y == Catch::Approx(150.0).margin(1.0));
  CHECK(south_pole.z == Catch::Approx(-6'906'752.0).margin(1.0));
  CHECK(magnitude(south_pole) == Catch::Approx(6'906'752.314).margin(1.0));
}

TEST_CASE("two-body propagation conserves circular-orbit energy over one revolution") {
  constexpr double kRadiusMetres = 7'000'000.0;
  const double circular_speed =
      std::sqrt(kEarthGravitationalParameterMetresCubedPerSecondSquared / kRadiusMetres);
  const double period_seconds = 2.0 * 3.14159265358979323846 *
                                std::sqrt(kRadiusMetres * kRadiusMetres * kRadiusMetres /
                                          kEarthGravitationalParameterMetresCubedPerSecondSquared);
  OrbitalStateVector initial;
  initial.frame = OrbitalCoordinateFrame::Gcrf;
  initial.epoch_unix_milliseconds = 1'000'000;
  initial.position_metres = {kRadiusMetres, 0.0, 0.0};
  initial.velocity_metres_per_second = {0.0, circular_speed, 0.0};

  CHECK(propagateTwoBody(initial, initial.epoch_unix_milliseconds).position_metres.x ==
        kRadiusMetres);

  const OrbitalStateVector propagated =
      propagateTwoBody(initial, initial.epoch_unix_milliseconds +
                                    static_cast<int64_t>(std::llround(period_seconds * 1'000.0)));

  CHECK(distance(propagated.position_metres, initial.position_metres) < 5.0);
  CHECK(distance(propagated.velocity_metres_per_second, initial.velocity_metres_per_second) < 0.01);
  CHECK(specificEnergy(propagated) == Catch::Approx(specificEnergy(initial)).epsilon(1e-12));
}

TEST_CASE("maneuver planning joins coast, transfer, burns, and target orbit at fixed epochs") {
  const Sgp4Orbit orbit(kReferenceElements);
  const ManeuverScenario scenario = referenceScenario(orbit);
  const ManeuverPlan plan = planManeuver(orbit, Coordinate(0.0F, -90.0F), scenario);

  REQUIRE(plan.current_coast.size() == 11U);
  REQUIRE(plan.transfer.size() == 61U);
  REQUIRE(plan.target_orbit.size() == 65U);
  REQUIRE(plan.events.size() == 2U);
  CHECK(plan.current_coast.front().role == TrajectoryRole::CurrentCoast);
  CHECK(plan.transfer.front().role == TrajectoryRole::Transfer);
  CHECK(plan.target_orbit.front().role == TrajectoryRole::TargetOrbit);
  CHECK(plan.events.front().role == ManeuverEventRole::DepartureBurn);
  CHECK(plan.events.front().epoch_unix_milliseconds == scenario.departure_epoch_unix_milliseconds);
  CHECK(plan.events.back().role == ManeuverEventRole::ArrivalBurn);
  CHECK(plan.events.back().epoch_unix_milliseconds == scenario.arrival_epoch_unix_milliseconds);
  CHECK(distance(plan.current_coast.back().state.position_metres,
                 plan.transfer.front().state.position_metres) < 1e-6);
  CHECK(distance(plan.transfer.back().state.position_metres,
                 plan.target_orbit.front().state.position_metres) < 10.0);
  CHECK(plan.total_delta_velocity_metres_per_second > 0.0);
  CHECK(plan.total_delta_velocity_metres_per_second <
        scenario.maximum_total_delta_velocity_metres_per_second);
}

TEST_CASE("maneuver failures have stable typed error codes") {
  const Sgp4Orbit orbit(kReferenceElements);
  ManeuverScenario scenario = referenceScenario(orbit);

  scenario.arrival_epoch_unix_milliseconds = scenario.departure_epoch_unix_milliseconds;
  try {
    static_cast<void>(planManeuver(orbit, Coordinate(0.0F, -90.0F), scenario));
    FAIL("an invalid event order must fail");
  } catch (const ManeuverPlanningError& error) {
    CHECK(error.code() == ManeuverPlanningError::Code::InvalidScenario);
    CHECK(std::string(error.what()) == "maneuver scenario is invalid");
  }

  scenario = referenceScenario(orbit);
  scenario.maximum_total_delta_velocity_metres_per_second = 1.0;
  try {
    static_cast<void>(planManeuver(orbit, Coordinate(0.0F, -90.0F), scenario));
    FAIL("a burn beyond the fixed limit must fail");
  } catch (const ManeuverPlanningError& error) {
    CHECK(error.code() == ManeuverPlanningError::Code::DeltaVelocityLimitExceeded);
    CHECK(std::string(error.what()) == "maneuver exceeds the scenario delta-velocity limit");
  }

  OrbitalStateVector invalid;
  invalid.frame = OrbitalCoordinateFrame::Gcrf;
  invalid.position_metres.x = std::numeric_limits<double>::quiet_NaN();
  try {
    static_cast<void>(propagateTwoBody(invalid, 1'000));
    FAIL("a non-finite state must fail");
  } catch (const ManeuverPlanningError& error) {
    CHECK(error.code() == ManeuverPlanningError::Code::InvalidInitialState);
  }
}
