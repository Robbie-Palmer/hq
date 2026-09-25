# Browser adapter

This directory exposes the deterministic simulation to the portfolio site by adapting the existing
C++ runner. The coordination algorithm remains in the portable core.

## Boundary

The exported C ABI has five functions:

- `satellite_swarm_browser_api_version()` reports worker-facing API version 8.
- `satellite_swarm_source_revision()` reports the exact Git revision embedded at configure time.
- `satellite_swarm_run_demonstration(longitude, latitude, scenario)` runs the deterministic
  three-node trace and returns a pointer to its JSON result. Scenario `0` uses connected links;
  scenario `1` drops the winning node's assignment; scenario `2` completes an accepted safe-state
  action successfully.
- `satellite_swarm_run_fair_allocation_evidence()` runs six equal-score missions and returns the
  assignment telemetry and per-node counts.
- `satellite_swarm_last_error()` returns the last adapter error when a run fails.

Returned pointers refer to adapter-owned strings and remain valid until the next call. The worker
copies each string into JavaScript before making another call. The adapter catches C++ exceptions so
none cross the C boundary.

The worker protocol is at version `5`, the JSON display record is at version `7`, the C ABI is at
version `8`, and the simulation trace is at version `5`. These independent version fields prevent a
change to one boundary from silently reinterpreting another. Display version 7 adds SGP4 orbit
samples, Earth-fixed Cartesian positions, and playback multipliers. Trace version 5 adds
deterministic safe-state request results and status changes. It retains version 4's explicit
mission-completion commands for repeated workloads.

## Build and parity check

Run the supported task from this project directory:

```shell
mise run browser:parity
```

The task pins Emscripten, configures the CMake browser target, copies its `.mjs` and `.wasm` outputs
to the site's public simulation directory, and runs the Node parity test. The test requires the
South Pole result to match the native fixture byte for byte. It also requires the native and Wasm
equal-score evidence to match, exercises a custom coordinate and the error path, and checks the
deployed worker's protocol and module paths through a worker-thread bridge.

The generated files are ignored by Git. The UI's mise build and development tasks compile them from
source with the pinned Emscripten toolchain before Next.js starts.

## Browser lifecycle

The public module worker and CesiumJS renderer load only after the reader selects **Load
simulation**. Each UI run creates one worker, posts one versioned objective and network-scenario
request, validates the response and embedded source revision, and terminates the worker. Aborting
navigation also terminates it. This keeps Emscripten initialization and simulation work off the
page's main thread and prevents stale requests from replacing a newer result.

Cesium receives the validated Earth-fixed samples after the run and interpolates between them. It
does not run SGP4, calculate candidate scores, select an assignee, or update controller state.

## Deliberate limits

- The checked-in TLEs are fixed demonstration inputs. The player never fetches current elements or
  reads the wall clock.
- The caller can select the connected baseline, a deterministic lost-assignment fault, or a fatal
  health transition whose accepted safe-state action reports successful completion.
- The global result buffer assumes one call at a time, which matches the dedicated worker.
- The browser adapter may allocate memory. The portable coordination core and firmware constraints
  remain unchanged.
- WebAssembly parity covers the simulation result. It provides no evidence about radio timing,
  hardware behavior, or flight suitability.
