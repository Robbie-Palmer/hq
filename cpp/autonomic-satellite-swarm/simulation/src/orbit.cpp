#include "satellite_swarm/orbit.hpp"

#include "SGP4.h"

#include <algorithm>
#include <array>
#include <cmath>
#include <cstddef>
#include <cstring>
#include <limits>
#include <stdexcept>
#include <string_view>
#include <utility>

namespace satellite_swarm::simulation {
namespace {

constexpr double kJulianDateAtUnixEpoch = 2440587.5;
constexpr double kMillisecondsPerDay = 86'400'000.0;
constexpr double kEarthRotationRadiansPerSecond = 7.29211514670698e-5;
constexpr double kRadiansToDegrees = 57.2957795130823208768;

void validateTleLine(std::string_view line, char expected_line_number) {
  if (line.size() != 69U || line.front() != expected_line_number || line[1] != ' ' ||
      line.back() < '0' || line.back() > '9') {
    throw std::invalid_argument("TLE line has an invalid fixed-width layout");
  }

  unsigned int checksum = 0U;
  for (std::size_t index = 0U; index < 68U; ++index) {
    const char character = line[index];
    if (character >= '0' && character <= '9') {
      checksum += static_cast<unsigned int>(character - '0');
    } else if (character == '-') {
      ++checksum;
    } else if (character < 0x20 || character > 0x7e) {
      throw std::invalid_argument("TLE line contains a non-ASCII character");
    }
  }
  if (checksum % 10U != static_cast<unsigned int>(line.back() - '0')) {
    throw std::invalid_argument("TLE line checksum does not match");
  }
}

std::array<char, 130> mutableTleLine(const std::string& line) {
  std::array<char, 130> result{};
  std::copy(line.begin(), line.end(), result.begin());
  return result;
}

int64_t unixMilliseconds(double julian_date) {
  const double milliseconds = (julian_date - kJulianDateAtUnixEpoch) * kMillisecondsPerDay;
  if (!std::isfinite(milliseconds) ||
      milliseconds < static_cast<double>(std::numeric_limits<int64_t>::min()) ||
      milliseconds > static_cast<double>(std::numeric_limits<int64_t>::max())) {
    throw std::invalid_argument("TLE epoch is outside the supported time range");
  }
  return static_cast<int64_t>(std::llround(milliseconds));
}

CartesianVector rotateTemeToEarthFixed(const CartesianVector& vector, double sidereal_angle) {
  const double cosine = std::cos(sidereal_angle);
  const double sine = std::sin(sidereal_angle);
  return {cosine * vector.x + sine * vector.y, -sine * vector.x + cosine * vector.y, vector.z};
}

double quantize(double value, double quantum) { return std::round(value / quantum) * quantum; }

} // namespace

struct Sgp4Orbit::Implementation {
  elsetrec record{};
  int64_t epoch_unix_milliseconds = 0;
  double epoch_julian_date = 0.0;
};

bool isValid(const OrbitalStateVector& state) {
  const bool known_frame = state.frame == OrbitalCoordinateFrame::Teme ||
                           state.frame == OrbitalCoordinateFrame::EarthFixed;
  const auto finite_vector = [](const CartesianVector& vector) {
    return std::isfinite(vector.x) && std::isfinite(vector.y) && std::isfinite(vector.z);
  };
  return known_frame && finite_vector(state.position_metres) &&
         finite_vector(state.velocity_metres_per_second);
}

SatelliteSnapshot satelliteSnapshotFrom(const PropagationResult& result) {
  if (!isValid(result.earth_fixed) ||
      result.earth_fixed.frame != OrbitalCoordinateFrame::EarthFixed) {
    throw std::invalid_argument("orbit result lacks a valid Earth-fixed state");
  }
  const CartesianVector& position = result.earth_fixed.position_metres;
  const CartesianVector& velocity = result.earth_fixed.velocity_metres_per_second;
  const double horizontal_radius = std::hypot(position.x, position.y);
  const double orbital_radius = std::hypot(horizontal_radius, position.z);
  if (orbital_radius <= 0.0 || horizontal_radius <= 0.0) {
    throw std::invalid_argument("orbit result cannot be converted to a satellite snapshot");
  }

  const double longitude = std::atan2(position.y, position.x) * kRadiansToDegrees;
  const double latitude = std::atan2(position.z, horizontal_radius) * kRadiansToDegrees;
  const double horizontal_rate =
      (position.x * velocity.x + position.y * velocity.y) / horizontal_radius;
  const double latitude_rate_sign = velocity.z * horizontal_radius - position.z * horizontal_rate;

  SatelliteSnapshot snapshot;
  snapshot.coordinate.longitude_degrees = static_cast<float>(quantize(longitude, 0.0001));
  snapshot.coordinate.latitude_degrees = static_cast<float>(quantize(latitude, 0.0001));
  snapshot.orbital_radius_metres = static_cast<float>(quantize(orbital_radius, 1.0));
  snapshot.travel_direction =
      latitude_rate_sign >= 0.0 ? TravelDirection::Northbound : TravelDirection::Southbound;
  if (!isValid(snapshot)) {
    throw std::invalid_argument("orbit result produced an invalid satellite snapshot");
  }
  return snapshot;
}

Sgp4Orbit::Sgp4Orbit(const TwoLineElementSet& elements)
    : implementation_(std::make_unique<Implementation>()) {
  validateTleLine(elements.line1, '1');
  validateTleLine(elements.line2, '2');
  if (elements.line1.substr(2U, 5U) != elements.line2.substr(2U, 5U)) {
    throw std::invalid_argument("TLE catalog numbers do not match");
  }

  auto line1 = mutableTleLine(elements.line1);
  auto line2 = mutableTleLine(elements.line2);
  double start_minutes = 0.0;
  double stop_minutes = 0.0;
  double step_minutes = 0.0;
  SGP4Funcs::twoline2rv(line1.data(), line2.data(), 'c', 'm', 'i', wgs72, start_minutes,
                        stop_minutes, step_minutes, implementation_->record);
  if (implementation_->record.error != 0 || implementation_->record.ephtype != 0) {
    throw std::invalid_argument("TLE cannot initialize the SGP4 model");
  }
  implementation_->epoch_julian_date =
      implementation_->record.jdsatepoch + implementation_->record.jdsatepochF;
  implementation_->epoch_unix_milliseconds = unixMilliseconds(implementation_->epoch_julian_date);
}

Sgp4Orbit::~Sgp4Orbit() = default;
Sgp4Orbit::Sgp4Orbit(Sgp4Orbit&&) noexcept = default;
Sgp4Orbit& Sgp4Orbit::operator=(Sgp4Orbit&&) noexcept = default;

int64_t Sgp4Orbit::epochUnixMilliseconds() const {
  return implementation_->epoch_unix_milliseconds;
}

PropagationResult Sgp4Orbit::propagate(int64_t epoch_unix_milliseconds) const {
  const auto elapsed_milliseconds =
      static_cast<double>(epoch_unix_milliseconds - implementation_->epoch_unix_milliseconds);
  const double requested_julian_date =
      implementation_->epoch_julian_date + elapsed_milliseconds / kMillisecondsPerDay;
  const double minutes_since_epoch = elapsed_milliseconds / (60.0 * 1'000.0);
  double position_kilometres[3]{};
  double velocity_kilometres_per_second[3]{};
  elsetrec working_record = implementation_->record;
  if (!SGP4Funcs::sgp4(working_record, minutes_since_epoch, position_kilometres,
                       velocity_kilometres_per_second) ||
      working_record.error != 0) {
    throw std::runtime_error("SGP4 propagation failed");
  }

  PropagationResult result;
  result.teme.frame = OrbitalCoordinateFrame::Teme;
  result.teme.epoch_unix_milliseconds = epoch_unix_milliseconds;
  result.teme.position_metres = {position_kilometres[0] * 1'000.0, position_kilometres[1] * 1'000.0,
                                 position_kilometres[2] * 1'000.0};
  result.teme.velocity_metres_per_second = {velocity_kilometres_per_second[0] * 1'000.0,
                                            velocity_kilometres_per_second[1] * 1'000.0,
                                            velocity_kilometres_per_second[2] * 1'000.0};

  result.earth_fixed.frame = OrbitalCoordinateFrame::EarthFixed;
  result.earth_fixed.epoch_unix_milliseconds = epoch_unix_milliseconds;
  const double sidereal_angle = SGP4Funcs::gstime_SGP4(requested_julian_date);
  result.earth_fixed.position_metres =
      rotateTemeToEarthFixed(result.teme.position_metres, sidereal_angle);
  const CartesianVector rotated_velocity =
      rotateTemeToEarthFixed(result.teme.velocity_metres_per_second, sidereal_angle);
  result.earth_fixed.velocity_metres_per_second = {
      rotated_velocity.x + kEarthRotationRadiansPerSecond * result.earth_fixed.position_metres.y,
      rotated_velocity.y - kEarthRotationRadiansPerSecond * result.earth_fixed.position_metres.x,
      rotated_velocity.z};

  if (!isValid(result.teme) || !isValid(result.earth_fixed)) {
    throw std::runtime_error("SGP4 propagation returned a non-finite state");
  }
  return result;
}

} // namespace satellite_swarm::simulation
