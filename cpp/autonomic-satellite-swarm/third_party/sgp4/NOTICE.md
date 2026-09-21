# CelesTrak SGP4 source notice

`SGP4.cpp` and `SGP4.h` come from the CelesTrak
[`fundamentals-of-astrodynamics`](https://github.com/CelesTrak/fundamentals-of-astrodynamics)
repository at commit `4efec61212ce03529bdf1037e0b86eb1ece2ea49`.

The upstream repository releases the code under the GNU Affero General Public License version 3.0.
This repository carries the same license in `/LICENSE`. CelesTrak also asks users of the SGP4 code
to cite Vallado, Crawford, Hujsak, and Kelso, "Revisiting Spacetrack Report #3," AIAA 2006-6753.

The imported files retain their upstream comments. The import normalizes line endings, places the
files under `third_party/sgp4`, and skips the redundant satellite-number copy in `sgp4init` when the
source is already its destination. That guard avoids undefined overlapping `strncpy` behavior in
the upstream `twoline2rv` call path without changing the propagated result. Project-owned
validation, time handling, coordinate conversion, and snapshot adaptation live in
`simulation/src/orbit.cpp`.
