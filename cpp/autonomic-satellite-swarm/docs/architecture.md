# Architecture

## Goals

The revival keeps the 2019 proof of concept understandable while allowing its hardware and research
assumptions to change independently. The core therefore owns coordination behavior, not pins,
radios, clocks, batteries, or orbital propagation.

## Components

### Portable coordination core

`SwarmController` is a deterministic, allocation-free state machine. Callers supply the current
32-bit monotonic time to `update`. Every timeout uses unsigned elapsed-time arithmetic, so the
calculation remains correct when Arduino `millis()` wraps.

Callers may replace the controller's latest validated `SatelliteSnapshot` before a simulation step
or navigation update. The controller exposes that same snapshot for observation and uses it when it
next calculates candidacy. Invalid coordinates, non-positive or non-finite radius, mass, or energy,
and unknown travel directions leave the last valid snapshot unchanged.

The controller can be:

- idle;
- leading a mission negotiation;
- awaiting an acknowledgement;
- awaiting an assignment;
- active on a mission;
- quiescent; or
- safely disabled.

Safe-disabled is latched for one controller lifetime. Quiescence is reversible when the health
monitor returns to nominal. The deterministic reset baseline records that constructing a replacement
controller clears safe-disabled because no durable state store exists yet.

### Policies and ports

`Transport` sends and receives domain messages. Infrared, ESP-NOW, an in-memory simulation, or a
future radio can implement it without changing the state machine.

`HealthMonitor` owns the mapping from platform observations to health policy. The reference sketches
use a nominal monitor because there is no current hardware against which to calibrate thresholds.

`CandidacyScorer` owns mission suitability. `HistoricalOrbitalScorer` reproduces the paper's
heuristic and its example outputs, with validation and defined edge cases. A future flight-dynamics
model can replace it behind the same interface.

`SafeStateActuator` receives one non-blocking request when the controller first enters
safe-disabled. The request ID is the node ID and boot epoch, which is unique because the controller
can make only one request in a boot. The request also carries the triggering reason and current
mission key. The controller latches safe-disabled before invoking the adapter and does not leave it
when the adapter rejects the request. After acceptance, each controller update polls once until the
adapter reports success or failure. The controller records that terminal result and stops polling.
An omitted adapter produces a rejected result, so a platform must provide an implementation before
claiming a physical safe action.

`TelemetrySink` accepts diagnostic records outside the controller. `TelemetryTransmitter` grants it
at most one record per configured interval and only when the platform says the output channel is
available. A rejected record stays in the bounded queue.

### Wire codec

`WireCodec` converts messages to a fixed 18-byte representation. It explicitly controls byte order,
coordinate quantization, versioning, and error detection. Adapters never send in-memory C++ object
layouts. Each message separates its immediate sender from a stable mission key containing the
mission's origin node, that node's boot epoch, and a sequence within the epoch.

### Deterministic simulation

The simulation layer runs the portable controllers from a versioned sequence of fixed-time frames.
Each frame applies directed-link changes, explicit delivery faults, health and satellite updates,
safe-state status changes, node resets, and mission completions before mission commands and
controller updates. A delivery directive can drop, delay, or duplicate the next matching
sender-to-recipient message. Each simulated node can reject or accept its safe-state request, and a
later frame can move accepted work from pending to success or failure. The runner records each
applied fault alongside messages and state changes, then captures every node's state, score, and
satellite snapshot. The command-line demonstration uses this runner. An Emscripten target exposes
the same browser serializer through a versioned C ABI, and a module worker invokes it without moving
coordination rules into TypeScript. Native and WebAssembly results are compared byte for byte for
the default scenario and a repeated equal-score allocation run. A reset increments the simulated
node's boot epoch before constructing its replacement controller.

### Hardware adapters

The Arduino Uno adapter fragments one packet into six NEC infrared frames. It is the closest
maintainable equivalent of the original three-Arduino demonstration.

The ESP32 adapter sends the same packet through ESP-NOW. ESP-NOW is a convenient modern local radio
for a benchtop swarm demonstration; it is not proposed as a spacecraft communication link.

## Deliberate constraints

- Node IDs are currently `0..15`, with `255` reserved for broadcast.
- Candidate storage is statically bounded at 16 nodes.
- Each update processes a configurable bounded number of received messages.
- Each controller keeps at most 16 telemetry records. A higher-priority record may evict an older,
  lower-priority record, and every loss increments a saturating drop counter.
- Telemetry export attempts one record per configured interval. The reference firmware uses a
  dedicated serial link at one frame per second; shared-radio scheduling remains unimplemented.
- The Uno firmware build reserves at least 768 bytes of SRAM beyond global allocation for local
  variables and the runtime stack. This static-allocation threshold provides headroom; worst-case
  stack and interrupt-nesting behavior remain unverified.
- One controller negotiates one mission at a time.
- Mission keys combine a provisioned node ID, a 32-bit boot epoch, and a 16-bit sequence. Sequence
  wrap is forbidden.
- Equal top scores rotate across the sorted tied set using a phase derived from the mission origin
  and boot epoch, then advanced by the mission sequence. The policy stores no allocation history.
- The simulator advances boot epochs. The compile-tested firmware accepts a build-time epoch but has
  no durable epoch store.
- The reference transport is unauthenticated and unencrypted.
- The controller accepts snapshot updates but does not calculate or schedule them.
- The reference firmware does not provide a physical safe-state actuator or completion evidence.
- Multi-hop discovery and forwarding are out of scope for this revival.

These limits keep memory use and behavior deterministic. Changing one should begin with a requirement
and an architecture decision rather than an incidental code edit.

## Extension points

A credible next research iteration would add:

1. A validated orbital propagation and maneuver-cost model.
2. Durable boot-epoch, assignment, and safe-state storage with explicit recovery rules.
3. Validated resource and lifetime inputs for candidacy scoring before the existing cyclic
   equal-score tie-break.
4. A mission executor interface with progress, cancellation, and failure semantics, plus validated
   hardware implementations of the safe-state actuator hook.
5. Measured shared-radio scheduling, delivery, and duty-cycle rules for telemetry export.
6. Authenticated messages with replay protection before enabling remote intervention.
7. Property-based and model-checked invariants beyond the deterministic regression scenarios.
8. Hardware-in-the-loop tests for a selected board and radio.

The [next research cycle](next-research-cycle.md) develops these questions, including an observable
and governed improvement loop, without presenting them as current capabilities.
