# Deterministic orbit simulation

The browser demonstration propagates three checked-in two-line element sets with SGP4. This model
belongs to the host and WebAssembly simulation layer. The portable coordination library and the Uno
and ESP32 firmware do not link it.

## Source and scenario

The vendored `SGP4.cpp` and `SGP4.h` are from CelesTrak's
[`fundamentals-of-astrodynamics`](https://github.com/CelesTrak/fundamentals-of-astrodynamics)
repository at commit `4efec61212ce03529bdf1037e0b86eb1ece2ea49`. They retain their upstream
comments. Local changes normalize line endings, relocate the files under `third_party/sgp4`, and
skip a redundant self-copy in `sgp4init` that makes upstream `twoline2rv` trigger undefined
overlapping `strncpy` behavior. The guard does not change propagation. The upstream source is
AGPL-3.0; `third_party/sgp4/NOTICE.md` records the license and citation.

The scenario element pairs are constants in `simulation/src/browser_simulation.cpp`. They derive
from CelesTrak's satellite 00005 verification case, share its epoch, and use distinct catalog IDs
and mean anomalies to phase three illustrative nodes around the same orbit. They are fixed test
inputs, not current observations of real spacecraft. Construction rejects lines that are not 69
printable ASCII characters, have the wrong line number or checksum, or disagree on catalog number.
The upstream parser must also initialize an ordinary SGP4 element set without an error.

The common epoch is Unix millisecond `962131819734`. The exact fractional Julian date from the TLE
is retained internally; the Unix value is its rounded serialized identifier. Every requested time
is the scenario epoch plus a monotonic trace offset. Propagation reads neither the system clock nor
the network.

## Frames and conversion

SGP4 returns position and velocity in the True Equator, Mean Equinox (TEME) frame. The result keeps
that state and a second Earth-fixed state, both labelled with their frame and epoch. The conversion
uses the Greenwich sidereal angle calculated by the imported Vallado `gstime_SGP4` routine:

```text
x_e =  cos(gmst) x_t + sin(gmst) y_t
y_e = -sin(gmst) x_t + cos(gmst) y_t
z_e = z_t
```

Velocity receives the same rotation and the Earth-rotation term. The demonstration treats UTC as
UT1 and sets polar motion to zero because it has no Earth-orientation data. The result is adequate
for a deterministic visualization, but it is not a precision ITRF transformation. The historical
scorer receives geocentric latitude, longitude, radius, and northbound or southbound direction
derived once from this Earth-fixed result. Browser serialization uses the same result for Cesium's
Cartesian position; it does not propagate a second trajectory.

The native and WebAssembly serializers round Earth-fixed position to metres and velocity to
millimetres per second. Scorer inputs are rounded to `0.0001` degree and one metre. These explicit
boundaries preserve byte-for-byte output across the two targets.

## Sampling and playback

The trace retains the 10-millisecond controller frames through 120 milliseconds, then samples every
60 seconds through 8,040 seconds. The reference orbit's period is about 7,983 seconds, so the 147
frames cover one complete revolution. A regression test compares SGP4 at each 30-second midpoint
with linear interpolation between its surrounding samples. The largest measured Earth-fixed error
is 3,206.51 metres, below the enforced 3,300-metre bound.

Cesium's `SampledPositionProperty` linearly interpolates these Earth-fixed samples. Playback runs the
negotiation at `0.01x`, changes to `100x` for quiet flight, and displays both the UTC simulation time
and current multiplier. Pause and step use recorded frames. Reduced-motion mode disables automatic
playback; none of these presentation controls changes trace inputs or output.

## Verification and cost

The reference-vector tests enforce a one-metre TEME position bound for CelesTrak near-Earth vectors
at epoch and six hours later, plus a deep-space vector 3.6 days before its epoch. A polar case
crosses 80 degrees latitude and the longitude discontinuity. Invalid checksums, lengths, and catalog
pairings are rejected. The native fixture, WebAssembly result, and production worker output must
match byte for byte.

Measured against the preceding revision's equivalent artifacts:

| Artifact | Before | After | Change |
| --- | ---: | ---: | ---: |
| Debug native simulation executable | 1,811,400 B | 2,194,200 B | +382,800 B (21.13%) |
| Browser JavaScript loader | 19,678 B | 21,231 B | +1,553 B (7.89%) |
| Browser WebAssembly | 227,825 B | 274,931 B | +47,106 B (20.68%) |
| Committed JSON fixture | 10,795 B | 208,382 B | +197,587 B (1,830.36%) |

The production browser audit passed without external requests or page errors in Chromium
153.0.8010.12. First-globe time was 3,050 milliseconds on the desktop profile and 4,684 milliseconds
with 4x mobile CPU throttling. Each profile loaded one 274,931-byte simulation WebAssembly resource.
These measurements describe this CI host and serve only as a regression baseline. User-device
performance will vary.
