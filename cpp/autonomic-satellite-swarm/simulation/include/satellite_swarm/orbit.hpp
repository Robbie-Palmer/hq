#ifndef SATELLITE_SWARM_ORBIT_HPP
#define SATELLITE_SWARM_ORBIT_HPP

#include "satellite_swarm/types.hpp"

#include <memory>
#include <stdint.h>
#include <string>

namespace satellite_swarm::simulation {

enum class OrbitalCoordinateFrame : uint8_t { Teme, EarthFixed };

struct CartesianVector {
  double x = 0.0;
  double y = 0.0;
  double z = 0.0;
};

struct OrbitalStateVector {
  OrbitalCoordinateFrame frame = OrbitalCoordinateFrame::Teme;
  int64_t epoch_unix_milliseconds = 0;
  CartesianVector position_metres{};
  CartesianVector velocity_metres_per_second{};
};

struct PropagationResult {
  OrbitalStateVector teme{};
  OrbitalStateVector earth_fixed{};
};

struct TwoLineElementSet {
  std::string line1;
  std::string line2;
};

bool isValid(const OrbitalStateVector& state);
SatelliteSnapshot satelliteSnapshotFrom(const PropagationResult& result);

class Sgp4Orbit {
public:
  explicit Sgp4Orbit(const TwoLineElementSet& elements);
  ~Sgp4Orbit();
  Sgp4Orbit(Sgp4Orbit&&) noexcept;
  Sgp4Orbit& operator=(Sgp4Orbit&&) noexcept;
  Sgp4Orbit(const Sgp4Orbit&) = delete;
  Sgp4Orbit& operator=(const Sgp4Orbit&) = delete;

  int64_t epochUnixMilliseconds() const;
  PropagationResult propagate(int64_t epoch_unix_milliseconds) const;

private:
  struct Implementation;
  std::unique_ptr<Implementation> implementation_;
};

} // namespace satellite_swarm::simulation

#endif
