# Live R2 OCI artifact canary

The protected `R2 OCI Canary` workflow runs zot against a disposable Cloudflare R2
bucket. It does not choose a hosting model; it supplies the live-provider evidence
for the comparison in `infra/oci-registry-spike`.

The broker creates the bucket and an out-of-scope probe bucket, issues a 30-minute
`object-read-write` credential for only the canary bucket, and passes all three AWS
credential fields to the consumer. The parent bundle never enters the consumer
environment. Cleanup uses the parent authority, deletes both owned buckets, and
fails while retaining `.state/broker-receipt.json` if deletion cannot be proved.

The workflow prepares dependencies before loading the parent secret, then runs:

```bash
mise //infra/oci-r2-artifact-spike:live
mise //infra/oci-r2-artifact-spike:teardown
```

Recovery accepts only the exact bucket names in the non-secret receipt. If the
parent was revoked, rotate `r2-parent-credentials.yaml` first; revocation immediately
invalidates every child credential. Dispatch the workflow with the failed run ID to
restore its retained receipt and finish cleanup with the replacement parent.

## Checks

The canary checks both S3 behavior and the registry paths that depend on it:

- invalid and valid S3 authentication, plus zot basic authentication;
- immediate object visibility, atomic conditional writes, and concurrent writers;
- explicit multipart upload and byte-range download;
- ORAS release and model artifacts, Helm, OCI 1.1 referrers, and OCI-layout export;
- zot scrub, exact-object loss and recovery, garbage collection, and metrics;
- an in-place upgrade from the pinned previous zot image;
- stored bytes, direct S3 request classes, and verified broker teardown.

## Sources

- [Cloudflare R2 S3 API](https://developers.cloudflare.com/r2/get-started/s3/)
- [Cloudflare R2 temporary credentials](https://developers.cloudflare.com/r2/api/s3/temporary-credentials/)
- [zot storage planning](https://zotregistry.dev/v2.1.22/articles/storage/)
