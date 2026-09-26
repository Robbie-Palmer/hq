# Autonomic Satellite Swarm

A revived research prototype for coordinating small satellite swarms and exploring fail-safe
behavior. The portable C++ core can run in a host simulation, in a browser through WebAssembly, or
behind Arduino hardware adapters.

The original prototype was called *Apoptotic Temporal Satellite Swarms*. This project accompanies
the 2019 paper [*Autonomic Providing Pre-Programmed Death of Cubesats
for Avoiding Space JUNK*](https://doi.org/10.1109/SMC-IT.2019.00015), by Robbie Palmer and Roy
Sterritt. It preserves the paper's proof-of-concept ideas while making their assumptions and limits
explicit.

> [!IMPORTANT]
> This is research and demonstration software, not flight software. "Apoptosis" means entering a
> safe-disabled software state that is latched until the controller resets. It does not physically
> destroy or deorbit a spacecraft. The included orbital score is a historical heuristic, not
> validated astrodynamics.

## What it demonstrates

- A temporary leader broadcasts a mission objective.
- Available nodes calculate a replaceable candidacy score.
- The leader acknowledges responses and deterministically assigns the strongest candidate.
- Equal top scores rotate across the stable responder set using the mission key, without allocation
  history or another wire field.
- A separate transmitter exports fixed telemetry frames at a bounded rate and retains a record when
  its sink rejects the write.
- A busy node does not accept more work.
- Health policy can place a node into reversible quiescence or a safe-disabled state latched for
  the controller lifetime.
- Entering safe-disabled can make one idempotent platform request. The controller records whether
  the platform accepts it, polls accepted work until success or failure, and stays latched for every
  outcome.
- Repeated failure to receive acknowledgements can trigger the historical "death by default" rule.
- Deterministic trace inputs can drop, delay, or duplicate deliveries, change directed links, and
  reset a node so protocol failures can be replayed exactly.
- Missions use `{origin node, boot epoch, mission sequence}` keys, so messages from different nodes
  cannot alias the same mission. Preventing aliases across leader resets also requires each node to
  durably advance its boot epoch before restarting its mission sequence.
- Each controller records typed mission, state, health, and send-failure evidence in a fixed
  16-record queue. Priorities protect mission outcomes and safe-disable transitions from routine
  records, while sequence gaps and drop counts expose lost evidence.

## Quick start

[mise](https://mise.jdx.dev/) pins the developer tools and exposes the supported commands:

- On Linux, install Git and a C++20 build toolchain. On Debian or Ubuntu, install the `git` and
  `build-essential` packages.
- On macOS, install Git and the Xcode Command Line Tools with `xcode-select --install`.

Then run these commands from this directory:

```shell
mise trust
mise install
mise run doctor
mise run test
mise run simulate
mise run simulate:json
mise run simulate:fairness
```

The simulation should assign the southern-latitude mission to node 1:

```text
Mission 0:1:1 assigned to node 1
node 0: idle
node 1: active
node 2: idle
```

The [browser demonstration](https://robbiepalmer.me/satellite-swarm) runs the portable controller
as WebAssembly in a module worker and draws the result on a self-hosted CesiumJS globe.

`simulate:json` prints the versioned state, position, message, controller-telemetry, transition, and
network-fault record consumed by the CesiumJS view. The paths come from scripted simulation inputs.
Orbit propagation remains outside this demo. The browser can compare the connected mission with a
run where node 1's winning assignment is dropped.

`simulate:fairness` runs six missions where all three nodes score 100. It prints assignment evidence
derived from the leader's bounded telemetry. The expected order is `0, 1, 2, 0, 1, 2`, with two
missions per node and no dropped records.

Build the browser module and compare its default output with the native fixture:

```shell
mise run browser:parity
```

The task pins Emscripten, writes the untracked deployable `.mjs` and `.wasm` files under `ui/public`,
checks a custom objective, compares the equal-score evidence byte for byte, and verifies
invalid-input handling. The UI build runs the same task so
deployments compile the browser module from source. The worker API is versioned separately from the
simulation trace and display schema.

Run every host, firmware, formatting, lint, and spelling check with:

```shell
mise run check
```

`mise run coverage` uses the pinned GNU toolchain on Linux and Apple Clang with `llvm-cov` on macOS.
It writes SonarQube's generic coverage report and rejects line coverage below 80% or branch coverage
below 70%. The monorepo's SonarQube workflow imports that report alongside its JavaScript and Python
coverage.

## Architecture

```text
src/satellite_swarm/       portable state machine, policies, types, and wire codec
simulation/                 deterministic trace runner and observable simulation state
browser/                    C ABI, Emscripten entry point, and native/WASM parity test
examples/simulation/       deterministic host-side three-node demonstration
firmware/uno_ir/           legacy Arduino Uno + infrared reference adapter
firmware/esp32_espnow/     modern ESP32 + ESP-NOW reference adapter
tests/                     host-side behavior and characterization tests
docs/                      architecture, protocol, and modernization notes
```

The core depends on five interfaces:

- `Transport` moves semantic messages without exposing radio details.
- `HealthMonitor` maps platform observations to nominal, quiescent, or fatal health.
- `CandidacyScorer` ranks a satellite for a mission objective.
- `SafeStateActuator` accepts or rejects one non-blocking, idempotent request when the controller
  first enters safe-disabled and reports its eventual terminal status.
- `TelemetrySink` accepts a diagnostic record when the platform grants output-channel access.

See [Architecture](docs/architecture.md) and [Wire protocol](docs/wire-protocol.md) for the detailed
contracts.

## Firmware builds

The Arduino CLI profiles pin platform and library versions and download them into isolated build
profiles:

```shell
mise run firmware:uno
mise run firmware:esp32
```

The Uno adapter uses six NEC infrared frames for each validated protocol packet. The ESP32 adapter
uses ESP-NOW broadcast packets. Both are compile-tested; neither has been exercised on physical
hardware during the revival because the original equipment is no longer available. The Uno task
also requires at least 768 bytes of its 2 KB SRAM to remain available for local variables and the
runtime stack after global allocation. This compile-time guard measures static allocation only.

Both sketches also send 34-byte telemetry frames over their serial diagnostic link at no more than
one frame per second. Coordination remains on IR or ESP-NOW. The one-second interval applies only to
the bench experiment.

Worst-case stack safety under interrupt nesting and physical-target stack behavior remain
unverified.

The compile checks use reference node ID `0`. Set a distinct ID for each physical board at build
time; the task rejects values outside the core's configured `0..15` range:

```shell
SATELLITE_SWARM_NODE_ID=2 mise run firmware:uno
SATELLITE_SWARM_NODE_ID=2 mise run firmware:esp32
```

The firmware build accepts `SATELLITE_SWARM_BOOT_EPOCH`, which defaults to `1` for compile and bench
use. A real deployment must advance that value in durable storage before the controller starts after
a reset. Initial coordinates remain deliberately simple constants in each sketch. A real deployment
also needs calibrated health inputs, authenticated transport with replay protection, mission
persistence, a hardware-specific safe-state actuator, and a genuine guidance/navigation/control
implementation. The reference sketches do not supply a physical safe-state actuator. Without one,
the controller records a rejected result and preserves its software latch.

## Documentation

- [Architecture](docs/architecture.md)
- [Wire protocol](docs/wire-protocol.md)
- [Bounded telemetry](docs/telemetry.md)
- [Coordination invariant baseline](docs/invariant-baseline.md)
- [Revival notes and corrected defects](docs/revival-notes.md)
- [Next research cycle](docs/next-research-cycle.md)
- [Distributed coordination over intermittent links](docs/distributed-coordination-research.md)
- [Contributing](CONTRIBUTING.md)
