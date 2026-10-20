# Nix build and host boundary spike

This non-production prototype exercises one project release boundary across two
services:

- a TypeScript HTTP service packaged by Nix and by a portable Dockerfile;
- a Python HTTP service packaged by Nix and consumed by a NixOS module; and
- one locked flake that exposes packages, checks, development shells, an OCI
  image, and a disposable NixOS host evaluation.

The prototype deliberately does not import a production workload or host. The
decision-ready findings live in
[`docs/nix-build-host-boundary-spike.md`](../../../docs/nix-build-host-boundary-spike.md).

Run every workflow through the local mise tasks:

```bash
mise run --skip-tools //homelab:nix-spike-check
mise run --skip-tools //homelab:nix-spike-image-compare
mise run --skip-tools //homelab:nix-spike-image-multiarch
```

These tasks pin their build and inspection tools themselves, so they skip the
unrelated tools declared for production Home Lab operations.

`scripts/nix-command` uses the host Nix installation when present. On a Linux
machine with Docker but no Nix, it runs the repository-pinned Nix image against
a persistent, prototype-only store volume. The checked-in `flake.lock` remains
the source of dependency resolution in either path.

The comparison task builds and smoke-tests both TypeScript images, generates
CycloneDX SBOMs with Syft, scans both images with Trivy, and prints a compact
measurement table. Its temporary output is removed on exit. The multi-platform
task exports an OCI index for `linux/amd64` and `linux/arm64` with BuildKit SBOM
and provenance attestations; it does not publish the result.

Do not pass secrets as Nix values, flake inputs, build arguments, copied files,
or environment variables used by a derivation. Those values become observable
in store paths, derivations, layers, or build metadata. The NixOS module exposes
only non-secret network settings; a real host must supply secrets at activation
or runtime through a host-owned credential mechanism.
