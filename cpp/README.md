# C++ workspace

This directory owns the shared C++ development toolchain. Its mise configuration pins CMake,
Ninja, clang-format, and clang-tidy for projects below it, while each project owns its target-specific
build, test, simulation, and firmware tasks.

## Projects

- [`autonomic-satellite-swarm`](autonomic-satellite-swarm/README.md): a portable coordination core,
  host simulation, and Arduino reference adapters for a revived satellite-swarm research prototype.

## Commands

Run shared formatting from the repository root:

```shell
mise run //cpp:format
mise run //cpp:format:check
```

Run a project's complete quality gate through its qualified task:

```shell
mise run //cpp/autonomic-satellite-swarm:check
```
