# Nix build, OCI image, and NixOS host boundary spike

- Status: ADR-ready recommendation
- Work item: `pep-nix-build-host-spike`
- Experiment history: [pull request #1846](https://github.com/Robbie-Palmer/hq/pull/1846)

## Question

Where should the platform draw the boundary between Nix development and
package builds, OCI image construction, and NixOS host configuration without
making Nix a prerequisite for every builder or coupling unrelated releases to
one lock file?

## Experiment

The spike used one project-owned `flake.lock` to pin Nixpkgs and expose these
outputs on Linux and Darwin:

- separate TypeScript and Python development shells;
- a Nix package and build check for each service;
- a Linux-only `dockerTools.buildLayeredImage` for the TypeScript service;
- a portable, pinned, multi-stage Dockerfile for the same service; and
- a NixOS module plus disposable host evaluation that consumes the Python
  package directly.

The experiment exposed every operation through mise. A wrapper used local Nix
when installed and a pinned Nix container on Linux otherwise. The Docker
fallback proved that a contributor could evaluate and build the locked flake
without installing Nix on the host, while the Dockerfile remained buildable
without Nix.

## Retention

The repository retains this report, not the experiment code. The prototype had
no production consumer or ongoing CI owner, so keeping it would create an
unsupported example that could drift from the Copier templates it is meant to
inform. Pull request #1846 retains the implementation and test history. When
Copier work begins, add smaller executable examples as template fixtures covered
by the generated-project test suite.

## Findings

The experiment produced this Linux `x86_64` snapshot on 2026-10-20. Image
size is Docker's unpacked size. Package counts come from Syft 1.54.1. The final
column is the number of high or critical findings reported by Trivy 0.76.0 with
the database available at execution time; it is evidence that both formats are
scannable, not a lasting security comparison.

| Variant | Size (bytes) | Layers | SBOM packages | High or critical findings |
| --- | ---: | ---: | ---: | ---: |
| Dockerfile | 168,082,000 | 5 | 512 | 52 |
| `dockerTools` | 217,153,380 | 29 | 325 | 13 |

Both images returned the same health response while running as an unprivileged
numeric user. A second unchanged build hit every Dockerfile step and completed
in 0.74 seconds. The already-built Nix image required no derivations and
completed in 6.31 seconds through the Dockerized Nix fallback; that number
includes container startup and flake evaluation, so it is not a package-build
benchmark. The multi-platform export produced distinct `linux/amd64` and
`linux/arm64` manifests plus one attestation manifest for each platform.

| Concern | Dockerfile and BuildKit | `dockerTools.buildLayeredImage` |
| --- | --- | --- |
| Cache behaviour | Instruction and file checksums give legible, registry-exportable cache boundaries. A source change invalidates the source copy and later steps. | Nix reuses content-addressed derivations and their dependency closures. Reuse is excellent with a shared Nix store or binary cache, but not available to an ordinary OCI-only builder. |
| Layers | The experimental Dockerfile had an explicit base, build, and application history. The runtime retained Alpine and a shell, which helped inspection but added packages. | Nix assigns popular store paths to individual layers up to `maxLayers`, then groups the remainder. The measured closure was larger and had more layers than the Alpine image; store-path layers are also less familiar to OCI operators. |
| Multi-architecture | One Dockerfile builds an OCI index for `linux/amd64` and `linux/arm64` with Buildx. Native nodes are preferable to emulation for expensive builds. | The image output is native to each Linux Nix system. Separate native builders can build both outputs, but another step must assemble and attest the multi-platform index. Darwin can build packages and shells but cannot produce or run the Linux image locally without a Linux builder. |
| SBOM and provenance | BuildKit attaches SPDX SBOM and SLSA provenance attestations to an OCI index using standard flags. Syft also inventories the loaded image. | Syft recognizes the Nix store, but `dockerTools` creates a Docker-compatible tarball rather than BuildKit attestations. Publication needs a separate SBOM and provenance step tied to the resulting digest. |
| Vulnerability scanning | Trivy identifies Alpine and language packages through conventional metadata. Findings map to familiar package update paths. | Store contents are reproducible, but scanner coverage depends on Nix catalog support and can differ from Nixpkgs vulnerability metadata. The pipeline must scan the final image and must not treat an empty result as proof of safety. |
| Non-Nix builders | Docker, BuildKit, hosted CI, and managed container builders consume the Dockerfile directly. | Requires Nix or the pinned Docker fallback and access to Nix substituters. This is a narrower interoperability boundary. |
| Local debugging | The Alpine runtime has a shell and conventional paths. A separate debug target could add tools without changing the production target. | The production image intentionally has no shell or package database. Debugging works through `nix develop`, `nix run`, or a separate debug image, not by mutating the running container. |
| Updates | Dependabot or Renovate can propose base-digest and tool-version changes independently. BuildKit rebuilds affected instructions. | `nix flake update nixpkgs` changes the dependency graph in one reviewed lock diff and rebuilds affected derivations. Sharing that lock across unrelated release units would coordinate their updates unnecessarily. |

The Nixpkgs manual documents that `buildLayeredImage` emits a compressed,
Docker-loadable tarball, defaults to at most 100 layers, and uses a fixed 1970
creation time for reproducibility. Setting the creation time to `now` breaks
that property. Docker documents that BuildKit cache reuse follows instruction
and source checksums, and that multi-platform builds can use emulation, native
nodes, or cross-compilation. BuildKit can attach SBOM and provenance
attestations directly to the image index.

## Recommendation

Adopt Nix as the project environment and package boundary when a project needs
it, not as the universal OCI authoring format.

1. Generate one flake per independently released project or tightly coupled
   project group. That flake owns its `flake.lock`, packages, checks, apps, and
   development shells. A host fleet keeps a separate host-owned flake and lock.
   A host may consume a project package by a pinned flake input; it must not make
   the application project inherit the host lock.
2. Keep Dockerfiles as the default portable OCI contract. Pin base images by
   multi-platform index digest, build with BuildKit, publish a multi-platform
   index, and attach SBOM and provenance attestations. This keeps non-Nix CI,
   local Docker users, managed builders, and vulnerability scanners on the
   common path.
3. Permit `dockerTools.buildLayeredImage` as an explicit project override for a
   Linux workload whose runtime closure is already built by Nix and whose
   builders, cache, publication, and debugging path are Nix-aware. The override
   still owes an OCI digest, SBOM, provenance attestation, and final-image scan.
4. Consume Nix packages directly from NixOS modules when the service runs on a
   NixOS host. Do not wrap that package in an OCI image unless an orchestrator
   or distribution boundary requires OCI. Keep the module reusable by making
   the package an option rather than reaching into another flake implicitly.
5. Make mise the stable interface: `check` calls `nix flake check`, development
   tasks call `nix develop` or `nix run`, and image tasks choose the declared
   Dockerfile or `dockerTools` adapter. Copier should generate these tasks and
   the correct platform guards from the project profile.

This separates four replaceable contracts: mise invokes work, a project flake
builds packages, an OCI adapter distributes a workload when required, and a
host flake configures NixOS. A change in one contract does not silently select
the next one.

## Lock and update policy

- Commit every `flake.lock`; do not hand-edit it.
- Give the lock to the smallest release unit that must update atomically.
- Let a project flake share one Nixpkgs revision across its packages, checks,
  shells, and image adapter. Use `inputs.<name>.follows = "nixpkgs"` for helper
  inputs within that boundary.
- Keep host locks separate. Update project and host inputs in separate pull
  requests unless a tested interface change requires a coordinated rollout.
- Run `nix flake check --no-update-lock-file` in CI. Use an explicit maintenance
  task for `nix flake update`, review the lock diff, and rebuild all checks.

## Binary-cache policy

Use `cache.nixos.org` by default. Add a project cache only after build cost or
latency justifies it. CI may write signed outputs; developer and host machines
may read them. Configure the cache URL and public key in trusted machine or CI
configuration, not through arbitrary per-project secrets. Do not make ordinary
users Nix `trusted-users`: the Nix manual warns that this is effectively root
authority. Cache application packages and checks; retain artefacts according to
the release and rollback window rather than caching mutable worktrees.

## Secrets and platform support

Nix evaluation and derivations must receive only public configuration. Secret
values do not belong in flake inputs, Nix strings, derivation environments,
Docker build arguments, image layers, or the binary cache. NixOS hosts should
materialize credentials at activation or service start through a host-owned
mechanism such as systemd credentials, with the module accepting only a path or
credential name.

The project flake evaluates packages and shells for `x86_64-linux`,
`aarch64-linux`, `x86_64-darwin`, and `aarch64-darwin`. OCI image outputs and
NixOS evaluations are Linux-only. CI should build Linux artefacts on native
Linux runners for each published architecture. Darwin developers use the same
lock for shells and local packages, and delegate Linux images and NixOS systems
to Linux builders.

## Proposed ADR decision text

Use project-owned locked Nix flakes for reproducible development shells,
checks, and packages. Keep independently released project and host flakes on
separate locks. Use Dockerfiles with BuildKit as the default OCI construction
and attestation contract. Allow `dockerTools` only for explicitly Nix-native
Linux workloads with equivalent publication evidence. Consume Nix packages
directly in NixOS modules when OCI is not an actual distribution boundary.

## Primary sources

- [Nixpkgs `dockerTools` reference](https://nixos.org/manual/nixpkgs/stable/#sec-pkgs-dockerTools)
- [Nix flake lock reference](https://nix.dev/manual/nix/latest/command-ref/new-cli/nix3-flake-lock)
- [Nix configuration and substituter reference](https://nix.dev/manual/nix/latest/command-ref/conf-file.html)
- [NixOS module manual](https://nixos.org/manual/nixos/stable/#sec-writing-modules)
- [Docker build cache invalidation](https://docs.docker.com/build/cache/invalidation/)
- [Docker multi-platform builds](https://docs.docker.com/build/building/multi-platform/)
- [Docker build attestations](https://docs.docker.com/build/metadata/attestations/)
- [Syft supported sources](https://github.com/anchore/syft/wiki/supported-sources)
- [Trivy container-image scanning](https://trivy.dev/latest/docs/target/container_image/)
