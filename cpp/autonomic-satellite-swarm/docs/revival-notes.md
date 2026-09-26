# Revival notes

The original code was a useful summer-internship proof of concept. This revival preserves its
research story while removing defects that would obscure or destabilize further experimentation.

## Corrected defects

| Prior behavior | Risk | Revival |
| --- | --- | --- |
| `SynMessage` was allocated with `new` and never safely released. | Heap exhaustion and unclear ownership on an embedded target. | Messages are values; the core performs no dynamic allocation. |
| The current SYN pointer and mock health state could be read uninitialized. | Undefined behavior and intermittent crashes. | All state is initialized and transitions are guarded. |
| Agent IDs indexed a fixed three-element array without validation. | Out-of-bounds memory writes from a malformed message. | IDs and configured capacity are validated against bounded storage. |
| IDs were decoded with mask `0x0011`. | Most eight-bit IDs decoded incorrectly. | The new codec encodes each field explicitly and has round-trip tests. |
| Signed shifts and platform-dependent `long` represented the protocol. | Undefined behavior and different layouts across platforms. | Fixed-width integers and explicit big-endian encoding define the wire format. |
| A 32-bit payload was sent through Sony IR framing despite Sony's standard frame sizes. | Interoperability and decoding ambiguity. | The Uno adapter uses four documented 32-bit NEC raw frames. |
| The IR receiver was not started in `setup`. | A device might never receive the first message. | Adapter initialization is explicit. |
| Long blocking delays ran in the main loop and reset path. | Missed messages and frozen state progression. | Coordination is driven by elapsed time; only short physical IR frame gaps remain. |
| Timer state did not initialize and its rollover concern remained unresolved. | Undefined first read and failure around `millis()` rollover. | The caller supplies time and rollover-safe elapsed arithmetic is tested. |
| The orbital calculation accepted invalid coordinates and had undefined zero-time cases. | NaN, division by zero, and misleading scores. | Inputs are validated; exact arrival scores `100`; historical examples remain characterized. |
| An active node could initiate a new mission. | Starting another negotiation overwrote its current assignment. | Only an idle node may initiate or accept a mission. |
| The wire encoder accepted unknown message-type values that its decoder rejected. | Locally generated packets could violate the protocol contract. | Encoding and decoding now enforce the same closed set of message types. |
| Non-finite physical inputs passed the historical scorer's positivity checks. | NaN or infinite arithmetic could produce undefined or misleading scores. | All physical inputs must be finite and positive. |
| Protocol state advanced even when a transport rejected the outgoing message. | A local node could report progress or safe-disable on communication evidence that never existed. | Initiation, candidacy, and assignment transitions now depend on successful transport acceptance. |
| Queued messages were handled before negotiation deadlines. | Late candidates, acknowledgements, or assignments could alter an expired phase. | Timed transitions run before the bounded receive loop. |
| The historical energy calculation squared a scaled latitude distance. | Small positive radii could underflow the denominator to zero. | The algebraically equivalent degree ratio avoids the squared denominator and rejects non-finite energy. |
| An update drained the transport until it became empty. | A busy or adversarial transport could make one update's execution time unbounded. | Configuration limits the number of messages processed per update. |
| The ESP-NOW adapter allowed sends and receives before successful initialization. | Callers could accidentally rely on platform error behavior instead of the adapter contract. | Both operations require a successfully completed `begin`. |
| The IR fragment count and packet size were related only by convention. | A future size change could make the masked chunk index address beyond the packet. | Compile-time assertions bind the two-bit index, chunk layout, and packet size. |
| Every firmware build hard-coded node ID `0`. | Multiple boards could not participate as distinct nodes. | Both adapters require the shared `SATELLITE_SWARM_NODE_ID` build definition; mise validates and supplies it. |
| A direct assignment could complete negotiation without clearing earlier communication failures. | A later isolated failure could safe-disable a node despite an intervening successful negotiation. | Accepting a matching assignment now resets the consecutive-failure evidence, just like accepting its acknowledgement. |
| A replacement scorer could return values above the protocol's `0..100` range. | Local candidacies could be encoded but rejected by peers, or local and remote candidates could be compared under different rules. | The controller bounds every local scorer result before comparison or transmission. |
| CMake contained an invalid project name, stale include paths, duplicated sources, and no CTest registration. | The advertised host workflow was not reproducible. | Presets, named targets, CTest discovery, warnings, sanitizers, and mise tasks form one workflow. |

## Revisited design choices

Not every modernization is a correction. Some original choices were reasonable responses to a
small embedded target and the tooling available at the time:

- Communication, health, scoring, and state transitions were tightly integrated. That may have
  been an intentional way to control flash, RAM, and protocol overhead. Separating them behind
  `Transport`, `HealthMonitor`, and `CandidacyScorer` changes source-code dependencies; it does not
  require extra wire messages. The abstraction cost still needs to be checked in firmware size and
  memory reports. A future constrained target should compare the current runtime interfaces with
  static or compile-time composition rather than assume either design is cheaper.
- Catch2 2.x [officially supported its single-header
  distribution](https://github.com/catchorg/Catch2/blob/v2.13.10/docs/slow-compiles.md), so vendoring
  `catch.hpp` was not itself a defect. For a CMake project, Catch2 3.x [documents exported CMake
  targets and `FetchContent`](https://github.com/catchorg/Catch2/blob/v3.16.0/docs/cmake-integration.md);
  the revival therefore pins a release and links `Catch2::Catch2WithMain`. The historical gap was
  dependency provenance and an update process, not the single-header format. FakeIt also supported
  single-header use; the revival's narrow ports happen to need only small purpose-built fakes.

## Intentional behavior changes

- An active node ignores new mission requests instead of entering an extra communication-health
  sub-state. Busy-node health checks need their own explicit protocol.
- Multi-hop rebroadcasting is deferred. The reference transports currently model one broadcast
  domain.
- A follower enters safe-disabled only after the configured number of consecutive missions fail to
  acknowledge its candidacy. A valid acknowledgement resets that evidence.
- Equal top scores use a mission-keyed cyclic order. A stable tied set receives one assignment per
  node in each complete rotation, while tests and replays remain deterministic. This removes the
  fixed node-ID bias but does not yet account for resources or wear.
- Safe-disabled still inhibits participation in software when no physical adapter exists. The core
  now makes one request through an explicit actuator port. The reference firmware omits that port
  because no safe-state hardware has been validated, so the controller records a rejected result.
  When an adapter accepts a request, the controller polls until it records one terminal success or
  failure result.

Telemetry, deterministic equal-score rotation, and the portable safe-state lifecycle are now
implemented. Resource-aware scoring, controlled mission-control intervention, and physical
safe-state implementations remain scoped in [Next research cycle](next-research-cycle.md). They are
not implied by the current behavior.

## Verification boundary

Host tests cover scoring examples, validation, message corruption, negotiation, retries, health
transitions, busy nodes, deterministic selection, and clock rollover. The host simulation exercises
three controllers over an in-memory broadcast bus. CI also compiles both firmware sketches.

Physical radio timing, electrical behavior, callback concurrency under load, sensor calibration, and
actual mission execution remain unverified without hardware.
