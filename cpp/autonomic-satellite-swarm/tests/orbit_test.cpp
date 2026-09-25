#include "satellite_swarm/orbit.hpp"

#include <algorithm>
#include <catch2/catch_approx.hpp>
#include <catch2/catch_test_macros.hpp>
#include <cmath>
#include <cstdint>
#include <stdexcept>

using namespace satellite_swarm;
using namespace satellite_swarm::simulation;

namespace {

const TwoLineElementSet kNearEarthReference{
    "1 00005U 58002B   00179.78495062  .00000023  00000-0  28098-4 0  4753",
    "2 00005  34.2682 348.7242 1859667 331.7664  19.3264 10.82419157413667"};

const TwoLineElementSet kBeforeEpochReference{
    "1 04632U 70093B   04031.91070959 -.00000084  00000-0  10000-3 0  9955",
    "2 04632  11.4628 273.1101 1450506 207.6000 143.9350  1.20231981 44145"};

const TwoLineElementSet kPolarReference{
    "1 28057U 03049A   06177.78615833  .00000060  00000-0  35940-4 0  1836",
    "2 28057  98.4283 247.6961 0000884  88.1964 271.9322 14.35478080140550"};

void checkTemePosition(const PropagationResult& result, double x_kilometres, double y_kilometres,
                       double z_kilometres) {
  constexpr double kOneMetre = 1.0;
  CHECK(result.teme.position_metres.x == Catch::Approx(x_kilometres * 1'000.0).margin(kOneMetre));
  CHECK(result.teme.position_metres.y == Catch::Approx(y_kilometres * 1'000.0).margin(kOneMetre));
  CHECK(result.teme.position_metres.z == Catch::Approx(z_kilometres * 1'000.0).margin(kOneMetre));
}

double distanceBetween(const CartesianVector& left, const CartesianVector& right) {
  const double x = left.x - right.x;
  const double y = left.y - right.y;
  const double z = left.z - right.z;
  return std::sqrt((x * x) + (y * y) + (z * z));
}

} // namespace

TEST_CASE("SGP4 matches CelesTrak TEME reference vectors on both sides of an element epoch") {
  const Sgp4Orbit near_earth(kNearEarthReference);
  checkTemePosition(near_earth.propagate(near_earth.epochUnixMilliseconds()), 7022.46529266,
                    -1400.08296755, 0.03995155);
  checkTemePosition(near_earth.propagate(near_earth.epochUnixMilliseconds() + 21'600'000),
                    -7154.03120202, -3783.17682504, -3536.19412294);

  const Sgp4Orbit before_epoch(kBeforeEpochReference);
  checkTemePosition(before_epoch.propagate(before_epoch.epochUnixMilliseconds() - 311'040'000),
                    -29020.02587128, 13819.84419063, -5713.33679183);
}

TEST_CASE("TLE validation rejects corrupt checksums, mismatched catalogs, and malformed lines") {
  TwoLineElementSet elements = kNearEarthReference;
  elements.line1.back() = '0';
  CHECK_THROWS_AS(Sgp4Orbit(elements), std::invalid_argument);

  elements = kNearEarthReference;
  elements.line2.replace(2U, 5U, "00006");
  elements.line2.back() = '8';
  CHECK_THROWS_AS(Sgp4Orbit(elements), std::invalid_argument);

  elements = kNearEarthReference;
  elements.line2.pop_back();
  CHECK_THROWS_AS(Sgp4Orbit(elements), std::invalid_argument);

  elements = kNearEarthReference;
  elements.line1.front() = '2';
  CHECK_THROWS_AS(Sgp4Orbit(elements), std::invalid_argument);

  elements = kNearEarthReference;
  elements.line1[1] = 'X';
  CHECK_THROWS_AS(Sgp4Orbit(elements), std::invalid_argument);

  elements = kNearEarthReference;
  elements.line2.front() = '1';
  CHECK_THROWS_AS(Sgp4Orbit(elements), std::invalid_argument);

  elements = kNearEarthReference;
  elements.line2.back() = 'X';
  CHECK_THROWS_AS(Sgp4Orbit(elements), std::invalid_argument);

  elements = kNearEarthReference;
  elements.line2.back() = '/';
  CHECK_THROWS_AS(Sgp4Orbit(elements), std::invalid_argument);

  elements = kNearEarthReference;
  elements.line1[10] = static_cast<char>(0x1f);
  CHECK_THROWS_AS(Sgp4Orbit(elements), std::invalid_argument);

  elements = kNearEarthReference;
  elements.line1[62] = '1';
  elements.line1.back() = '4';
  CHECK_THROWS_AS(Sgp4Orbit(elements), std::invalid_argument);
}

TEST_CASE("orbital state validation rejects unknown frames and non-finite vectors") {
  OrbitalStateVector state;
  CHECK(isValid(state));

  state.frame = static_cast<OrbitalCoordinateFrame>(255U);
  CHECK_FALSE(isValid(state));

  state.frame = OrbitalCoordinateFrame::EarthFixed;
  state.position_metres.y = std::numeric_limits<double>::quiet_NaN();
  CHECK_FALSE(isValid(state));

  state.position_metres.y = 0.0;
  state.velocity_metres_per_second.z = std::numeric_limits<double>::infinity();
  CHECK_FALSE(isValid(state));

  state.velocity_metres_per_second.z = 0.0;
  constexpr std::array<double CartesianVector::*, 3> kComponents = {
      &CartesianVector::x, &CartesianVector::y, &CartesianVector::z};
  for (double CartesianVector::* component : kComponents) {
    state.position_metres.*component = std::numeric_limits<double>::quiet_NaN();
    CHECK_FALSE(isValid(state));
    state.position_metres.*component = 0.0;

    state.velocity_metres_per_second.*component = std::numeric_limits<double>::infinity();
    CHECK_FALSE(isValid(state));
    state.velocity_metres_per_second.*component = 0.0;
  }
}

TEST_CASE("snapshot adaptation rejects invalid and degenerate Earth-fixed results") {
  PropagationResult result;
  result.earth_fixed.frame = OrbitalCoordinateFrame::Teme;
  CHECK_THROWS_AS(satelliteSnapshotFrom(result), std::invalid_argument);

  result.earth_fixed.frame = OrbitalCoordinateFrame::EarthFixed;
  result.earth_fixed.position_metres.x = std::numeric_limits<double>::quiet_NaN();
  CHECK_THROWS_AS(satelliteSnapshotFrom(result), std::invalid_argument);

  result.earth_fixed.position_metres.x = 0.0;
  CHECK_THROWS_AS(satelliteSnapshotFrom(result), std::invalid_argument);

  result.earth_fixed.position_metres.z = 1.0;
  CHECK_THROWS_AS(satelliteSnapshotFrom(result), std::invalid_argument);

  result.earth_fixed.position_metres = {7'000'000.0, 0.0, 0.0};
  result.earth_fixed.velocity_metres_per_second = {0.0, 0.0, -1.0};
  CHECK(satelliteSnapshotFrom(result).travel_direction == TravelDirection::Southbound);

  result.earth_fixed.velocity_metres_per_second.z = 1.0;
  CHECK(satelliteSnapshotFrom(result).travel_direction == TravelDirection::Northbound);

  result.earth_fixed.position_metres.x = 1.0e100;
  CHECK_THROWS_AS(satelliteSnapshotFrom(result), std::invalid_argument);
}

TEST_CASE("SGP4 rejects propagation outside its supported numerical range") {
  const Sgp4Orbit orbit(kNearEarthReference);
  CHECK_THROWS_AS(orbit.propagate(std::numeric_limits<int64_t>::max()), OrbitPropagationError);
}

TEST_CASE(
    "Earth-fixed adaptation crosses high latitude and longitude wrap without invalid snapshots") {
  const Sgp4Orbit orbit(kPolarReference);
  double previous_longitude = 0.0;
  bool first = true;
  bool crossed_wrap = false;
  double maximum_absolute_latitude = 0.0;

  for (int64_t offset = 0; offset <= 7'200'000; offset += 60'000) {
    const PropagationResult result = orbit.propagate(orbit.epochUnixMilliseconds() + offset);
    const SatelliteSnapshot snapshot = satelliteSnapshotFrom(result);
    REQUIRE(isValid(snapshot));
    maximum_absolute_latitude =
        std::max(maximum_absolute_latitude,
                 std::abs(static_cast<double>(snapshot.coordinate.latitude_degrees)));
    if (!first && std::abs(static_cast<double>(snapshot.coordinate.longitude_degrees) -
                           previous_longitude) > 300.0) {
      crossed_wrap = true;
    }
    first = false;
    previous_longitude = snapshot.coordinate.longitude_degrees;
  }

  CHECK(maximum_absolute_latitude > 80.0);
  CHECK(crossed_wrap);
}

TEST_CASE("sixty-second Earth-fixed samples bound linear interpolation error") {
  const Sgp4Orbit orbit(kNearEarthReference);
  constexpr int64_t kSampleIntervalMilliseconds = 60'000;
  constexpr int64_t kOrbitDurationMilliseconds = 8'040'000;
  constexpr double kMaximumInterpolationErrorMetres = 3'300.0;
  double maximum_error_metres = 0.0;

  for (int64_t offset = 0; offset < kOrbitDurationMilliseconds;
       offset += kSampleIntervalMilliseconds) {
    const CartesianVector start =
        orbit.propagate(orbit.epochUnixMilliseconds() + offset).earth_fixed.position_metres;
    const CartesianVector end =
        orbit.propagate(orbit.epochUnixMilliseconds() + offset + kSampleIntervalMilliseconds)
            .earth_fixed.position_metres;
    const CartesianVector actual_midpoint =
        orbit.propagate(orbit.epochUnixMilliseconds() + offset + (kSampleIntervalMilliseconds / 2))
            .earth_fixed.position_metres;
    const CartesianVector linear_midpoint{
        .x = (start.x + end.x) / 2.0,
        .y = (start.y + end.y) / 2.0,
        .z = (start.z + end.z) / 2.0,
    };
    maximum_error_metres =
        std::max(maximum_error_metres, distanceBetween(actual_midpoint, linear_midpoint));
  }

  INFO("maximum midpoint interpolation error: " << maximum_error_metres << " metres");
  CHECK(maximum_error_metres < kMaximumInterpolationErrorMetres);
}
