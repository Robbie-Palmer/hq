# Live R2 OCI artifact spike

This canary tests zot against a real Cloudflare R2 bucket. It is the live-provider
follow-up to the LocalStack comparison in `infra/oci-registry-spike`. The provider
comparison has not yet shortlisted or rejected R2-backed zot, so this evidence does
not choose a hosting model.

The canary creates one randomly named bucket, runs a loopback-only zot registry,
and deletes the bucket. It never writes R2 credentials to disk or output. The exit
trap retries cleanup after a failed test, and the run fails unless it can verify
that the bucket no longer exists.

## Credentials

Use a dedicated R2 S3 access key with Object Read & Write access and bucket creation
and deletion authority. Revoke it after the run. Do not use a production key or a
bucket that contains other data.

Provide these values through the process environment:

- `R2_ENDPOINT`, the canonical account S3 endpoint;
- `R2_ACCESS_KEY_ID` and `R2_SECRET_ACCESS_KEY`, the disposable S3 key pair;
- `R2_BUCKET_PREFIX`, a unique lowercase prefix such as `oci-r2-spike-owner`.

Preflight validates only the input shape:

```bash
mise //infra/oci-r2-artifact-spike:preflight
```

The live task is destructive only to the bucket it creates:

```bash
mise //infra/oci-r2-artifact-spike:live
```

If the process is interrupted after bucket creation, rerun teardown with the same
credentials. The non-secret bucket name remains in `.state/bucket` until teardown
succeeds.

```bash
mise //infra/oci-r2-artifact-spike:teardown
```

## Coverage

The canary checks both S3 behavior and the registry paths that depend on it:

- invalid and valid S3 authentication, plus zot basic authentication;
- immediate object visibility, atomic conditional writes, and concurrent writers;
- explicit multipart upload and byte-range download;
- ORAS release and model artifacts, Helm, OCI 1.1 referrers, and OCI-layout export;
- zot scrub, exact-object loss and recovery, garbage collection, and metrics;
- an in-place upgrade from the pinned previous zot image;
- stored bytes, direct S3 request counts, cost at current R2 Standard rates, and
  verified bucket deletion.

R2 account analytics are not available to an S3 key. The evidence therefore records
exact storage bytes and direct canary requests, but it labels zot's internal S3
request cost as unobserved. Billing reconciliation needs the account-level R2
analytics view. Credential revocation is also an owner action outside the S3 API.

## Local baseline and R2-specific behavior

The local baseline passed all 15 zot checks against LocalStack. This canary reuses
its pinned zot versions and client tools, but changes the storage configuration to
R2's `auto` region, canonical HTTPS endpoint, path-style addressing, and Signature
Version 4. The live checks add explicit multipart and range operations, real object
visibility, measured stored bytes, cost inputs, and bucket deletion proof.

The recovery model remains exact-object restoration. Deleting a referenced blob
makes the artifact unreadable; restoring the same bytes at the same key restores
the pull. Aggressive garbage collection runs only in its own short-lived config.
That schedule is test-only and is unsafe for a registry serving unrelated writes.

## Sources

- [Cloudflare R2 S3 API](https://developers.cloudflare.com/r2/get-started/s3/)
- [Cloudflare R2 S3 compatibility](https://developers.cloudflare.com/r2/api/s3/api/)
- [Cloudflare R2 consistency](https://developers.cloudflare.com/r2/reference/consistency/)
- [Cloudflare R2 pricing](https://developers.cloudflare.com/r2/pricing/)
- [zot storage planning](https://zotregistry.dev/v2.1.22/articles/storage/)
