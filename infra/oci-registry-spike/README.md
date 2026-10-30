# OCI registry implementation spike

This project compares zot and CNCF Distribution against the same disposable,
S3-compatible object store. The run is local, bounded, and destructive only to its
Compose project. It generates credentials at runtime and does not persist secrets in
Git.

The recorded result recommends zot. See the
[machine-readable scorecard](evidence/scorecard.json) and the
[recommendation](evidence/recommendation.md).

## Run the spike

Prerequisites are mise, Docker with Buildx, curl, jq, OpenSSL, and an x86-64 Linux
host. All images are digest-pinned. Downloaded clients are version-pinned and
checksum-verified.

```bash
mise //infra/oci-registry-spike:spike
```

The task creates two LocalStack S3 buckets, starts both registries, runs the complete
matrix, writes generated evidence under `.artifacts/run/`, and tears down the
containers, network, volume, credential-bearing runtime images, and runtime
credentials. Set `KEEP_SPIKE_STACK=1` only
when debugging a failed run, then remove it with:

```bash
mise //infra/oci-registry-spike:teardown
```

Static validation is separate from the destructive spike:

```bash
mise //infra/oci-registry-spike:check
mise //infra/oci-registry-spike:scorecard:check
```

## Coverage and bounds

Each implementation receives the same 15 checks:

- authenticated and rejected registry requests;
- the OCI Distribution conformance runner pinned to commit
  `97274622c11112caa21efb8c52acca3c6b8fa7f1`;
- ORAS push, pull, and export;
- Docker push and pull when the Docker client is available;
- an amd64 and arm64 OCI image index;
- Helm chart push and pull;
- a KitOps ModelKit containing a deterministic 16 MiB model fixture;
- key-based Cosign signing and verification, ORAS discovery, and the native
  referrers endpoint;
- conditional S3 writes and concurrent tag updates;
- garbage collection, integrity traversal, injected object loss, and recovery;
- Prometheus metrics;
- an in-place previous-to-current registry upgrade over retained object storage.

The aggressive zot garbage-collection schedule is isolated in a dedicated runtime
configuration. Running that schedule during unrelated conformance writes makes the
test nondeterministic and does not represent a safe deployment configuration.

Generated logs, JUnit XML, HTML conformance reports, and copied fixtures remain under
`.artifacts/` and are ignored by Git. The committed scorecard contains the stable
summary needed to review the decision.

## R2 boundary

LocalStack exercises the S3 API shape without consuming a real R2 account. It does
not prove R2 endpoint, credential-scope, latency, multipart, or billing behavior.
Those checks are explicitly `not_run` in the scorecard.

`mise //infra/oci-registry-spike:live-r2:preflight` only validates the opt-in
environment contract. It does not mutate R2. A live canary requires an owner-provided
disposable bucket prefix and deletion authority, followed by cleanup verification.
The required variables are `R2_ENDPOINT`, `R2_ACCESS_KEY_ID`,
`R2_SECRET_ACCESS_KEY`, and `R2_BUCKET_PREFIX`; the script never prints or persists
their values.

## Sources

- [OCI Distribution Specification](https://github.com/opencontainers/distribution-spec)
- [zot storage planning](https://zotregistry.dev/v2.1.22/articles/storage/)
- [zot monitoring](https://zotregistry.dev/v2.1.22/articles/monitoring/)
- [CNCF Distribution S3 driver](https://distribution.github.io/distribution/storage-drivers/s3/)
- [CNCF Distribution garbage collection](https://distribution.github.io/distribution/about/garbage-collection/)
- [Cloudflare R2 pricing](https://developers.cloudflare.com/r2/pricing/)
