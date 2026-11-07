#include "satellite_swarm/maneuver.hpp"

#include <algorithm>
#include <array>
#include <cmath>
#include <limits>
#include <optional>
#include <utility>

namespace satellite_swarm::simulation {
namespace {

constexpr double kJulianDateAtUnixEpoch = 2440587.5;
constexpr double kJulianDateJ2000 = 2451545.0;
constexpr double kMillisecondsPerDay = 86'400'000.0;
constexpr double kSecondsPerDay = 86'400.0;
constexpr double kPi = 3.141592653589793238462643383279502884;
constexpr double kTwoPi = 2.0 * kPi;
constexpr double kDegreesToRadians = kPi / 180.0;
constexpr double kArcsecondsToRadians = kDegreesToRadians / 3'600.0;
constexpr double kEarthRotationRadiansPerSecond = 7.29211514670698e-5;
constexpr double kWgs84SemiMajorAxisMetres = 6'378'137.0;
constexpr double kWgs84Flattening = 1.0 / 298.257223563;

using Matrix3 = std::array<std::array<double, 3>, 3>;

struct LambertSolution {
  CartesianVector departure_velocity{};
  CartesianVector arrival_velocity{};
};

double magnitude(const CartesianVector& vector) {
  return std::sqrt(vector.x * vector.x + vector.y * vector.y + vector.z * vector.z);
}

double dot(const CartesianVector& left, const CartesianVector& right) {
  return left.x * right.x + left.y * right.y + left.z * right.z;
}

CartesianVector add(const CartesianVector& left, const CartesianVector& right) {
  return {left.x + right.x, left.y + right.y, left.z + right.z};
}

CartesianVector subtract(const CartesianVector& left, const CartesianVector& right) {
  return {left.x - right.x, left.y - right.y, left.z - right.z};
}

CartesianVector scale(const CartesianVector& vector, double scalar) {
  return {vector.x * scalar, vector.y * scalar, vector.z * scalar};
}

CartesianVector cross(const CartesianVector& left, const CartesianVector& right) {
  return {left.y * right.z - left.z * right.y, left.z * right.x - left.x * right.z,
          left.x * right.y - left.y * right.x};
}

CartesianVector normalized(const CartesianVector& vector) {
  const double norm = magnitude(vector);
  if (!std::isfinite(norm) || norm <= 0.0) {
    throw ManeuverPlanningError(ManeuverPlanningError::Code::InvalidInitialState,
                                "maneuver vector cannot be normalized");
  }
  return scale(vector, 1.0 / norm);
}

Matrix3 multiply(const Matrix3& left, const Matrix3& right) {
  Matrix3 result{};
  for (std::size_t row = 0U; row < 3U; ++row) {
    for (std::size_t column = 0U; column < 3U; ++column) {
      for (std::size_t index = 0U; index < 3U; ++index) {
        result[row][column] += left[row][index] * right[index][column];
      }
    }
  }
  return result;
}

CartesianVector multiply(const Matrix3& matrix, const CartesianVector& vector) {
  return {matrix[0][0] * vector.x + matrix[0][1] * vector.y + matrix[0][2] * vector.z,
          matrix[1][0] * vector.x + matrix[1][1] * vector.y + matrix[1][2] * vector.z,
          matrix[2][0] * vector.x + matrix[2][1] * vector.y + matrix[2][2] * vector.z};
}

Matrix3 transpose(const Matrix3& matrix) {
  return {{{matrix[0][0], matrix[1][0], matrix[2][0]},
           {matrix[0][1], matrix[1][1], matrix[2][1]},
           {matrix[0][2], matrix[1][2], matrix[2][2]}}};
}

Matrix3 rotateX(double angle) {
  const double cosine = std::cos(angle);
  const double sine = std::sin(angle);
  return {{{1.0, 0.0, 0.0}, {0.0, cosine, sine}, {0.0, -sine, cosine}}};
}

Matrix3 rotateY(double angle) {
  const double cosine = std::cos(angle);
  const double sine = std::sin(angle);
  return {{{cosine, 0.0, -sine}, {0.0, 1.0, 0.0}, {sine, 0.0, cosine}}};
}

Matrix3 rotateZ(double angle) {
  const double cosine = std::cos(angle);
  const double sine = std::sin(angle);
  return {{{cosine, sine, 0.0}, {-sine, cosine, 0.0}, {0.0, 0.0, 1.0}}};
}

double julianUtc(int64_t epoch_unix_milliseconds) {
  return kJulianDateAtUnixEpoch +
         static_cast<double>(epoch_unix_milliseconds) / kMillisecondsPerDay;
}

double julianUt1(int64_t epoch_unix_milliseconds, const EarthOrientationInputs& earth_orientation) {
  return julianUtc(epoch_unix_milliseconds) +
         earth_orientation.ut1_minus_utc_seconds / kSecondsPerDay;
}

double julianTt(int64_t epoch_unix_milliseconds, const EarthOrientationInputs& earth_orientation) {
  return julianUtc(epoch_unix_milliseconds) +
         (static_cast<double>(earth_orientation.tai_minus_utc_seconds) + 32.184) / kSecondsPerDay;
}

double greenwichMeanSiderealTime(double julian_ut1) {
  const double centuries = (julian_ut1 - kJulianDateJ2000) / 36'525.0;
  double seconds = -6.2e-6 * centuries * centuries * centuries + 0.093104 * centuries * centuries +
                   (876'600.0 * 3'600.0 + 8'640'184.812866) * centuries + 67'310.54841;
  seconds = std::fmod(seconds, 86'400.0);
  if (seconds < 0.0) {
    seconds += 86'400.0;
  }
  return seconds * (kTwoPi / 86'400.0);
}

Matrix3 polarMotion(const EarthOrientationInputs& earth_orientation) {
  return multiply(rotateY(-earth_orientation.polar_motion_x_radians),
                  rotateX(-earth_orientation.polar_motion_y_radians));
}

Matrix3 temeToGcrfRotation(double julian_tt) {
  const double centuries = (julian_tt - kJulianDateJ2000) / 36'525.0;
  const double centuries_squared = centuries * centuries;
  const double centuries_cubed = centuries_squared * centuries;

  const double zeta =
      (2'306.2181 * centuries + 0.30188 * centuries_squared + 0.017998 * centuries_cubed) *
      kArcsecondsToRadians;
  const double theta =
      (2'004.3109 * centuries - 0.42665 * centuries_squared - 0.041833 * centuries_cubed) *
      kArcsecondsToRadians;
  const double z =
      (2'306.2181 * centuries + 1.09468 * centuries_squared + 0.018203 * centuries_cubed) *
      kArcsecondsToRadians;
  const Matrix3 j2000_to_mean = multiply(rotateZ(-z), multiply(rotateY(theta), rotateZ(-zeta)));

  const double mean_longitude_sun =
      std::fmod((280.4665 + 36'000.7698 * centuries) * kDegreesToRadians, kTwoPi);
  const double mean_longitude_moon =
      std::fmod((218.3165 + 481'267.8813 * centuries) * kDegreesToRadians, kTwoPi);
  const double ascending_node =
      std::fmod((125.04452 - 1'934.136261 * centuries) * kDegreesToRadians, kTwoPi);
  const double delta_psi_arcseconds =
      -17.20 * std::sin(ascending_node) - 1.32 * std::sin(2.0 * mean_longitude_sun) -
      0.23 * std::sin(2.0 * mean_longitude_moon) + 0.21 * std::sin(2.0 * ascending_node);
  const double delta_epsilon_arcseconds =
      9.20 * std::cos(ascending_node) + 0.57 * std::cos(2.0 * mean_longitude_sun) +
      0.10 * std::cos(2.0 * mean_longitude_moon) - 0.09 * std::cos(2.0 * ascending_node);
  const double delta_psi = delta_psi_arcseconds * kArcsecondsToRadians;
  const double delta_epsilon = delta_epsilon_arcseconds * kArcsecondsToRadians;
  const double mean_obliquity = (84'381.448 - 46.8150 * centuries - 0.00059 * centuries_squared +
                                 0.001813 * centuries_cubed) *
                                kArcsecondsToRadians;
  const Matrix3 mean_to_true = multiply(rotateX(-(mean_obliquity + delta_epsilon)),
                                        multiply(rotateZ(-delta_psi), rotateX(mean_obliquity)));
  const double equation_of_equinoxes = delta_psi * std::cos(mean_obliquity);
  const Matrix3 teme_to_true = rotateZ(-equation_of_equinoxes);
  return multiply(transpose(j2000_to_mean), multiply(transpose(mean_to_true), teme_to_true));
}

CartesianVector earthRotationVelocity(const CartesianVector& position) {
  return {-kEarthRotationRadiansPerSecond * position.y, kEarthRotationRadiansPerSecond * position.x,
          0.0};
}

OrbitalStateVector roundTripThroughItrf(const OrbitalStateVector& teme,
                                        const EarthOrientationInputs& earth_orientation) {
  const double sidereal_angle =
      greenwichMeanSiderealTime(julianUt1(teme.epoch_unix_milliseconds, earth_orientation));
  const Matrix3 teme_to_pef = rotateZ(sidereal_angle);
  const Matrix3 pef_to_itrf = polarMotion(earth_orientation);
  const CartesianVector pef_position = multiply(teme_to_pef, teme.position_metres);
  const CartesianVector pef_velocity = subtract(
      multiply(teme_to_pef, teme.velocity_metres_per_second), earthRotationVelocity(pef_position));
  const CartesianVector itrf_position = multiply(pef_to_itrf, pef_position);
  const CartesianVector itrf_velocity = multiply(pef_to_itrf, pef_velocity);

  const Matrix3 itrf_to_pef = transpose(pef_to_itrf);
  const Matrix3 pef_to_teme = transpose(teme_to_pef);
  const CartesianVector recovered_pef_position = multiply(itrf_to_pef, itrf_position);
  const CartesianVector recovered_pef_velocity = multiply(itrf_to_pef, itrf_velocity);
  OrbitalStateVector recovered;
  recovered.frame = OrbitalCoordinateFrame::Teme;
  recovered.epoch_unix_milliseconds = teme.epoch_unix_milliseconds;
  recovered.position_metres = multiply(pef_to_teme, recovered_pef_position);
  recovered.velocity_metres_per_second = multiply(
      pef_to_teme, add(recovered_pef_velocity, earthRotationVelocity(recovered_pef_position)));
  return recovered;
}

CartesianVector itrfToGcrfPosition(const CartesianVector& itrf_position,
                                   int64_t epoch_unix_milliseconds,
                                   const EarthOrientationInputs& earth_orientation) {
  const Matrix3 itrf_to_pef = transpose(polarMotion(earth_orientation));
  const double sidereal_angle =
      greenwichMeanSiderealTime(julianUt1(epoch_unix_milliseconds, earth_orientation));
  const CartesianVector teme_position =
      multiply(transpose(rotateZ(sidereal_angle)), multiply(itrf_to_pef, itrf_position));
  return multiply(temeToGcrfRotation(julianTt(epoch_unix_milliseconds, earth_orientation)),
                  teme_position);
}

double stumpffC(double z) {
  if (z > 1e-8) {
    const double root = std::sqrt(z);
    return (1.0 - std::cos(root)) / z;
  }
  if (z < -1e-8) {
    const double root = std::sqrt(-z);
    return (std::cosh(root) - 1.0) / (-z);
  }
  return 0.5 - z / 24.0 + z * z / 720.0 - z * z * z / 40'320.0;
}

double stumpffS(double z) {
  if (z > 1e-8) {
    const double root = std::sqrt(z);
    return (root - std::sin(root)) / (root * root * root);
  }
  if (z < -1e-8) {
    const double root = std::sqrt(-z);
    return (std::sinh(root) - root) / (root * root * root);
  }
  return 1.0 / 6.0 - z / 120.0 + z * z / 5'040.0 - z * z * z / 362'880.0;
}

std::optional<double> lambertTimeResidual(double z, double radius1, double radius2, double a,
                                          double duration_seconds) {
  const double c = stumpffC(z);
  const double s = stumpffS(z);
  if (!std::isfinite(c) || !std::isfinite(s) || c <= 0.0) {
    return std::nullopt;
  }
  const double y = radius1 + radius2 + a * (z * s - 1.0) / std::sqrt(c);
  if (!std::isfinite(y) || y <= 0.0) {
    return std::nullopt;
  }
  const double x = std::sqrt(y / c);
  const double residual =
      x * x * x * s + a * std::sqrt(y) -
      std::sqrt(kEarthGravitationalParameterMetresCubedPerSecondSquared) * duration_seconds;
  if (!std::isfinite(residual)) {
    return std::nullopt;
  }
  return residual;
}

std::optional<LambertSolution> solveLambertBranch(const CartesianVector& departure_position,
                                                  const CartesianVector& arrival_position,
                                                  double duration_seconds, double sine_sign) {
  const double radius1 = magnitude(departure_position);
  const double radius2 = magnitude(arrival_position);
  const double cosine =
      std::clamp(dot(departure_position, arrival_position) / (radius1 * radius2), -1.0, 1.0);
  const double sine_magnitude =
      magnitude(cross(departure_position, arrival_position)) / (radius1 * radius2);
  const double denominator = 1.0 - cosine;
  if (denominator <= 1e-12 || sine_magnitude <= 1e-12) {
    return std::nullopt;
  }
  const double a = sine_sign * sine_magnitude * std::sqrt(radius1 * radius2 / denominator);
  if (std::abs(a) <= 1e-12) {
    return std::nullopt;
  }

  constexpr double kLowerZ = -4.0 * kPi * kPi + 1e-6;
  constexpr double kUpperZ = 4.0 * kPi * kPi - 1e-6;
  constexpr std::size_t kSearchSteps = 4'096U;
  std::optional<double> previous_value;
  double previous_z = kLowerZ;
  double lower = 0.0;
  double upper = 0.0;
  bool bracketed = false;
  for (std::size_t index = 0U; index <= kSearchSteps; ++index) {
    const double fraction = static_cast<double>(index) / static_cast<double>(kSearchSteps);
    const double z = kLowerZ + fraction * (kUpperZ - kLowerZ);
    const auto value = lambertTimeResidual(z, radius1, radius2, a, duration_seconds);
    if (value.has_value() && previous_value.has_value() &&
        ((*previous_value <= 0.0 && *value >= 0.0) || (*previous_value >= 0.0 && *value <= 0.0))) {
      lower = previous_z;
      upper = z;
      bracketed = true;
      break;
    }
    if (value.has_value()) {
      previous_value = value;
      previous_z = z;
    }
  }
  if (!bracketed) {
    return std::nullopt;
  }

  for (std::size_t iteration = 0U; iteration < 160U; ++iteration) {
    const double midpoint = (lower + upper) / 2.0;
    const auto lower_value = lambertTimeResidual(lower, radius1, radius2, a, duration_seconds);
    const auto midpoint_value =
        lambertTimeResidual(midpoint, radius1, radius2, a, duration_seconds);
    if (!lower_value.has_value() || !midpoint_value.has_value()) {
      return std::nullopt;
    }
    if ((*lower_value <= 0.0 && *midpoint_value >= 0.0) ||
        (*lower_value >= 0.0 && *midpoint_value <= 0.0)) {
      upper = midpoint;
    } else {
      lower = midpoint;
    }
  }

  const double z = (lower + upper) / 2.0;
  const double c = stumpffC(z);
  const double s = stumpffS(z);
  const double y = radius1 + radius2 + a * (z * s - 1.0) / std::sqrt(c);
  const double f = 1.0 - y / radius1;
  const double g = a * std::sqrt(y / kEarthGravitationalParameterMetresCubedPerSecondSquared);
  const double g_dot = 1.0 - y / radius2;
  if (!std::isfinite(g) || std::abs(g) <= 1e-9) {
    return std::nullopt;
  }
  LambertSolution solution;
  solution.departure_velocity =
      scale(subtract(arrival_position, scale(departure_position, f)), 1.0 / g);
  solution.arrival_velocity =
      scale(subtract(scale(arrival_position, g_dot), departure_position), 1.0 / g);
  if (!std::isfinite(magnitude(solution.departure_velocity)) ||
      !std::isfinite(magnitude(solution.arrival_velocity))) {
    return std::nullopt;
  }
  return solution;
}

LambertSolution solveLambert(const OrbitalStateVector& departure, const OrbitalStateVector& target,
                             double duration_seconds) {
  std::optional<LambertSolution> selected;
  double selected_delta_velocity = std::numeric_limits<double>::infinity();
  for (const double sine_sign : {1.0, -1.0}) {
    const auto candidate = solveLambertBranch(departure.position_metres, target.position_metres,
                                              duration_seconds, sine_sign);
    if (!candidate.has_value()) {
      continue;
    }
    const double delta_velocity =
        magnitude(subtract(candidate->departure_velocity, departure.velocity_metres_per_second)) +
        magnitude(subtract(target.velocity_metres_per_second, candidate->arrival_velocity));
    if (delta_velocity < selected_delta_velocity - 1e-9) {
      selected = candidate;
      selected_delta_velocity = delta_velocity;
    }
  }
  if (!selected.has_value()) {
    throw ManeuverPlanningError(ManeuverPlanningError::Code::LambertFailure,
                                "zero-revolution Lambert transfer has no solution");
  }
  return *selected;
}

OrbitalStateVector targetState(Coordinate objective, const OrbitalStateVector& departure,
                               const ManeuverScenario& scenario) {
  OrbitalStateVector target;
  target.frame = OrbitalCoordinateFrame::Gcrf;
  target.epoch_unix_milliseconds = scenario.arrival_epoch_unix_milliseconds;
  target.position_metres =
      objectivePositionInGcrf(objective, scenario.target_altitude_metres,
                              scenario.arrival_epoch_unix_milliseconds, scenario.earth_orientation);

  const CartesianVector radius_direction = normalized(target.position_metres);
  const CartesianVector departure_momentum =
      cross(departure.position_metres, departure.velocity_metres_per_second);
  CartesianVector target_normal = subtract(
      departure_momentum, scale(radius_direction, dot(departure_momentum, radius_direction)));
  if (magnitude(target_normal) <= 1e-9) {
    const CartesianVector tie_break_axis = std::abs(radius_direction.z) < 0.9
                                               ? CartesianVector{0.0, 0.0, 1.0}
                                               : CartesianVector{1.0, 0.0, 0.0};
    target_normal = cross(radius_direction, tie_break_axis);
  }
  target_normal = normalized(target_normal);
  CartesianVector velocity_direction = normalized(cross(target_normal, radius_direction));
  if (dot(velocity_direction, departure.velocity_metres_per_second) < 0.0) {
    velocity_direction = scale(velocity_direction, -1.0);
  }
  const double circular_speed = std::sqrt(kEarthGravitationalParameterMetresCubedPerSecondSquared /
                                          magnitude(target.position_metres));
  target.velocity_metres_per_second = scale(velocity_direction, circular_speed);
  return target;
}

template <typename StateAtEpoch>
void appendSamples(std::vector<TrajectorySample>& samples, TrajectoryRole role,
                   int64_t start_epoch_unix_milliseconds, int64_t end_epoch_unix_milliseconds,
                   uint32_t interval_milliseconds, const StateAtEpoch& state_at_epoch) {
  int64_t epoch = start_epoch_unix_milliseconds;
  while (true) {
    samples.push_back({role, state_at_epoch(epoch)});
    if (epoch == end_epoch_unix_milliseconds) {
      break;
    }
    const int64_t remaining = end_epoch_unix_milliseconds - epoch;
    epoch += std::min<int64_t>(remaining, static_cast<int64_t>(interval_milliseconds));
  }
}

} // namespace

OrbitalStateVector temeToGcrf(const OrbitalStateVector& teme,
                              const EarthOrientationInputs& earth_orientation) {
  if (!isValid(teme) || teme.frame != OrbitalCoordinateFrame::Teme ||
      earth_orientation.tai_minus_utc_seconds <= 0 ||
      !std::isfinite(earth_orientation.ut1_minus_utc_seconds) ||
      !std::isfinite(earth_orientation.polar_motion_x_radians) ||
      !std::isfinite(earth_orientation.polar_motion_y_radians)) {
    throw ManeuverPlanningError(ManeuverPlanningError::Code::TransformFailure,
                                "TEME to GCRF transform inputs are invalid");
  }
  const OrbitalStateVector recovered = roundTripThroughItrf(teme, earth_orientation);
  const Matrix3 rotation =
      temeToGcrfRotation(julianTt(teme.epoch_unix_milliseconds, earth_orientation));
  OrbitalStateVector result;
  result.frame = OrbitalCoordinateFrame::Gcrf;
  result.epoch_unix_milliseconds = teme.epoch_unix_milliseconds;
  result.position_metres = multiply(rotation, recovered.position_metres);
  result.velocity_metres_per_second = multiply(rotation, recovered.velocity_metres_per_second);
  if (!isValid(result)) {
    throw ManeuverPlanningError(ManeuverPlanningError::Code::TransformFailure,
                                "TEME to GCRF transform produced an invalid state");
  }
  return result;
}

CartesianVector objectivePositionInGcrf(Coordinate objective, double altitude_metres,
                                        int64_t epoch_unix_milliseconds,
                                        const EarthOrientationInputs& earth_orientation) {
  if (!isValid(objective) || !std::isfinite(altitude_metres) || altitude_metres < 0.0) {
    throw ManeuverPlanningError(ManeuverPlanningError::Code::TransformFailure,
                                "objective transform inputs are invalid");
  }
  const double longitude = static_cast<double>(objective.longitude_degrees) * kDegreesToRadians;
  const double latitude = static_cast<double>(objective.latitude_degrees) * kDegreesToRadians;
  const double eccentricity_squared = kWgs84Flattening * (2.0 - kWgs84Flattening);
  const double sine_latitude = std::sin(latitude);
  const double prime_vertical_radius =
      kWgs84SemiMajorAxisMetres /
      std::sqrt(1.0 - eccentricity_squared * sine_latitude * sine_latitude);
  const CartesianVector itrf_position{
      (prime_vertical_radius + altitude_metres) * std::cos(latitude) * std::cos(longitude),
      (prime_vertical_radius + altitude_metres) * std::cos(latitude) * std::sin(longitude),
      (prime_vertical_radius * (1.0 - eccentricity_squared) + altitude_metres) * sine_latitude};
  const CartesianVector result =
      itrfToGcrfPosition(itrf_position, epoch_unix_milliseconds, earth_orientation);
  if (!std::isfinite(magnitude(result)) || magnitude(result) <= 0.0) {
    throw ManeuverPlanningError(ManeuverPlanningError::Code::TransformFailure,
                                "objective transform produced an invalid position");
  }
  return result;
}

OrbitalStateVector propagateTwoBody(const OrbitalStateVector& initial,
                                    int64_t epoch_unix_milliseconds) {
  if (!isValid(initial) || initial.frame != OrbitalCoordinateFrame::Gcrf) {
    throw ManeuverPlanningError(ManeuverPlanningError::Code::InvalidInitialState,
                                "two-body propagation requires a valid GCRF state");
  }
  const double duration_seconds = (static_cast<double>(epoch_unix_milliseconds) -
                                   static_cast<double>(initial.epoch_unix_milliseconds)) /
                                  1'000.0;
  if (!std::isfinite(duration_seconds)) {
    throw ManeuverPlanningError(ManeuverPlanningError::Code::PropagationFailure,
                                "two-body propagation epoch is outside the supported range");
  }
  if (duration_seconds == 0.0) {
    return initial;
  }

  const double radius0 = magnitude(initial.position_metres);
  const double speed0_squared =
      dot(initial.velocity_metres_per_second, initial.velocity_metres_per_second);
  if (radius0 <= 0.0 || !std::isfinite(radius0) || !std::isfinite(speed0_squared)) {
    throw ManeuverPlanningError(ManeuverPlanningError::Code::InvalidInitialState,
                                "two-body propagation initial state is degenerate");
  }
  const double sqrt_mu = std::sqrt(kEarthGravitationalParameterMetresCubedPerSecondSquared);
  const double radial_velocity =
      dot(initial.position_metres, initial.velocity_metres_per_second) / radius0;
  const double alpha =
      2.0 / radius0 - speed0_squared / kEarthGravitationalParameterMetresCubedPerSecondSquared;
  double chi = std::abs(alpha) > 1e-12 ? sqrt_mu * duration_seconds * alpha
                                       : sqrt_mu * duration_seconds / radius0;
  bool converged = false;
  for (std::size_t iteration = 0U; iteration < 96U; ++iteration) {
    const double z = alpha * chi * chi;
    const double c = stumpffC(z);
    const double s = stumpffS(z);
    const double function = radius0 * radial_velocity / sqrt_mu * chi * chi * c +
                            (1.0 - alpha * radius0) * chi * chi * chi * s + radius0 * chi -
                            sqrt_mu * duration_seconds;
    const double derivative = radius0 * radial_velocity / sqrt_mu * chi * (1.0 - z * s) +
                              (1.0 - alpha * radius0) * chi * chi * c + radius0;
    if (!std::isfinite(function) || !std::isfinite(derivative) || std::abs(derivative) <= 1e-12) {
      break;
    }
    const double correction = function / derivative;
    chi -= correction;
    if (std::abs(correction) <= 1e-8) {
      converged = true;
      break;
    }
  }
  if (!converged) {
    throw ManeuverPlanningError(ManeuverPlanningError::Code::PropagationFailure,
                                "two-body universal-variable solver did not converge");
  }

  const double z = alpha * chi * chi;
  const double c = stumpffC(z);
  const double s = stumpffS(z);
  const double f = 1.0 - chi * chi / radius0 * c;
  const double g = duration_seconds - chi * chi * chi / sqrt_mu * s;
  const CartesianVector position =
      add(scale(initial.position_metres, f), scale(initial.velocity_metres_per_second, g));
  const double radius = magnitude(position);
  if (!std::isfinite(radius) || radius <= 0.0) {
    throw ManeuverPlanningError(ManeuverPlanningError::Code::PropagationFailure,
                                "two-body propagation produced an invalid radius");
  }
  const double f_dot = sqrt_mu / (radius * radius0) * (alpha * chi * chi * chi * s - chi);
  const double g_dot = 1.0 - chi * chi / radius * c;
  OrbitalStateVector result;
  result.frame = OrbitalCoordinateFrame::Gcrf;
  result.epoch_unix_milliseconds = epoch_unix_milliseconds;
  result.position_metres = position;
  result.velocity_metres_per_second =
      add(scale(initial.position_metres, f_dot), scale(initial.velocity_metres_per_second, g_dot));
  if (!isValid(result)) {
    throw ManeuverPlanningError(ManeuverPlanningError::Code::PropagationFailure,
                                "two-body propagation produced a non-finite state");
  }
  return result;
}

ManeuverPlan planManeuver(const Sgp4Orbit& current_orbit, Coordinate objective,
                          const ManeuverScenario& scenario) {
  const int64_t current_start = current_orbit.epochUnixMilliseconds();
  if (!isValid(objective) || scenario.departure_epoch_unix_milliseconds < current_start ||
      scenario.arrival_epoch_unix_milliseconds <= scenario.departure_epoch_unix_milliseconds ||
      scenario.end_epoch_unix_milliseconds < scenario.arrival_epoch_unix_milliseconds ||
      scenario.sample_interval_milliseconds == 0U ||
      !std::isfinite(scenario.target_altitude_metres) || scenario.target_altitude_metres < 0.0 ||
      !std::isfinite(scenario.maximum_total_delta_velocity_metres_per_second) ||
      scenario.maximum_total_delta_velocity_metres_per_second <= 0.0) {
    throw ManeuverPlanningError(ManeuverPlanningError::Code::InvalidScenario,
                                "maneuver scenario is invalid");
  }

  ManeuverPlan plan;
  appendSamples(plan.current_coast, TrajectoryRole::CurrentCoast, current_start,
                scenario.departure_epoch_unix_milliseconds, scenario.sample_interval_milliseconds,
                [&](int64_t epoch) {
                  return temeToGcrf(current_orbit.propagate(epoch).teme,
                                    scenario.earth_orientation);
                });
  const OrbitalStateVector departure = plan.current_coast.back().state;
  const OrbitalStateVector target = targetState(objective, departure, scenario);
  const double transfer_duration_seconds =
      static_cast<double>(scenario.arrival_epoch_unix_milliseconds -
                          scenario.departure_epoch_unix_milliseconds) /
      1'000.0;
  const LambertSolution lambert = solveLambert(departure, target, transfer_duration_seconds);

  OrbitalStateVector transfer_departure = departure;
  transfer_departure.velocity_metres_per_second = lambert.departure_velocity;
  const CartesianVector departure_delta_velocity =
      subtract(lambert.departure_velocity, departure.velocity_metres_per_second);
  const CartesianVector arrival_delta_velocity =
      subtract(target.velocity_metres_per_second, lambert.arrival_velocity);
  plan.total_delta_velocity_metres_per_second =
      magnitude(departure_delta_velocity) + magnitude(arrival_delta_velocity);
  if (plan.total_delta_velocity_metres_per_second >
      scenario.maximum_total_delta_velocity_metres_per_second) {
    throw ManeuverPlanningError(ManeuverPlanningError::Code::DeltaVelocityLimitExceeded,
                                "maneuver exceeds the scenario delta-velocity limit");
  }

  appendSamples(plan.transfer, TrajectoryRole::Transfer, scenario.departure_epoch_unix_milliseconds,
                scenario.arrival_epoch_unix_milliseconds, scenario.sample_interval_milliseconds,
                [&](int64_t epoch) { return propagateTwoBody(transfer_departure, epoch); });
  const double arrival_position_error =
      magnitude(subtract(plan.transfer.back().state.position_metres, target.position_metres));
  if (!std::isfinite(arrival_position_error) || arrival_position_error > 10.0) {
    throw ManeuverPlanningError(ManeuverPlanningError::Code::PropagationFailure,
                                "Lambert transfer missed the target position tolerance");
  }

  appendSamples(plan.target_orbit, TrajectoryRole::TargetOrbit,
                scenario.arrival_epoch_unix_milliseconds, scenario.end_epoch_unix_milliseconds,
                scenario.sample_interval_milliseconds,
                [&](int64_t epoch) { return propagateTwoBody(target, epoch); });
  plan.events.push_back({ManeuverEventRole::DepartureBurn,
                         scenario.departure_epoch_unix_milliseconds, OrbitalCoordinateFrame::Gcrf,
                         departure.position_metres, departure_delta_velocity});
  plan.events.push_back({ManeuverEventRole::ArrivalBurn, scenario.arrival_epoch_unix_milliseconds,
                         OrbitalCoordinateFrame::Gcrf, target.position_metres,
                         arrival_delta_velocity});
  return plan;
}

} // namespace satellite_swarm::simulation
