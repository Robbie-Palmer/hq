# Contributing

## Set up

Install [mise](https://mise.jdx.dev/), then run:

- Linux requires Git and a C++20 build toolchain. Debian and Ubuntu users can install the `git` and
  `build-essential` packages.
- macOS requires Git and the Xcode Command Line Tools. Install the latter with
  `xcode-select --install`.

```shell
mise trust
mise install
mise run doctor
mise run test
```

`doctor` checks the native compiler and SDK as well as the tools managed by mise. Use the tasks in
`mise.toml`; they are the same entry points used by CI on Linux and macOS.

## Change behavior safely

1. Express the intended state transition, score behavior, or wire validation as a host-side test.
2. Change the portable core without importing Arduino or operating-system headers.
3. Run `mise run test`, `mise run sanitize`, and `mise run coverage`.
4. If an adapter changed, compile both firmware targets.
5. Run `mise run check` before opening a pull request.

Hardware compilation is not proof of hardware behavior. Record the board, wiring, library versions,
observations, and repeatable procedure when physical integration testing becomes possible.

## Style

- Format C++ and Arduino code with `mise run format`.
- Treat clang-tidy findings and compiler warnings as errors.
- Use fixed-width types for protocol and persisted data.
- Avoid heap allocation in the portable library and adapters.
- Prefer explicit state transitions and bounded storage over implicit ownership.
- Document scientific assumptions separately from software behavior.

## Scope and safety

This code is not suitable for a flight or safety-critical system. Proposals that improve realism
should add traceable requirements and validation evidence rather than strengthening claims without
evidence.
