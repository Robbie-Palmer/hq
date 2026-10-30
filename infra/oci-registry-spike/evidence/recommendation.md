# OCI registry recommendation

Date: 2026-10-30

Decision: reuse zot v2.1.22 as the OCI Distribution service in front of R2, subject
to a disposable live-R2 canary. Do not build a custom gateway.

## Result

| Area | zot v2.1.22 | CNCF Distribution 3.1.2 |
| --- | --- | --- |
| Bounded matrix | 15 of 15 checks passed | 13 passed, 2 failed |
| OCI conformance | 854 tests, 0 failures, 4 skipped, 2 disabled | 852 tests, 91 failures, 16 skipped, 2 disabled |
| Native referrers | Passed | `404` with a non-OCI response |
| Cosign and ORAS discovery | Passed natively | Passed through client fallback tagging |
| Scrub and recovery | Native checksum scrub plus injected-loss recovery | No checksum scrub; dry-run GC traversal plus injected-loss recovery |
| Garbage collection | Inline; the spike isolates an aggressive schedule | Offline command; concurrent writes must stop |
| Runtime image size | 321.8 MB observed | 86.6 MB observed |
| Live R2 | Not run | Not run |

The Distribution conformance failures are not limited to the referrers endpoint.
The pinned runner also reports failures for SHA-512 content, subject-bearing
manifests and indexes, missing-subject behavior, and non-distributable layers. Many
of the 91 individual failures are cascading API assertions from those capability
gaps. Conventional SHA-256 Docker, ORAS, Helm, KitOps, multi-architecture, Cosign,
metrics, export, and upgrade paths passed.

Docker was the available container client on the test host. Podman, nerdctl,
containerd's `ctr`, and Skopeo were not installed, so the spike records them as
unavailable instead of silently claiming coverage.

zot passed the complete enabled conformance profile and all interoperability and
operations cases. It is about 3.7 times larger by uncompressed local runtime image
size, but it avoids a protocol gateway and supplies the native referrers and scrub
capabilities that the requirements call for.

## Configuration and patches

Neither implementation needed a source patch.

Both use their built-in S3 driver with a region endpoint, path-style addressing,
Signature Version 4, and an isolated bucket prefix. Distribution redirects are
disabled so the test remains valid against a private S3-compatible endpoint. The
zot comparison disables background GC during conformance and starts a separate,
short-lived configuration for the explicit GC case. Production should use a
retention policy and a conservative GC delay.

Credentials are generated for each run. The committed files contain no registry or
object-store secret.

## Failure modes and controls

- A very short zot GC delay can race untagged manifests under active writes. Keep GC
  out of peak write windows and validate retention before production.
- Distribution 3.1.2 does not satisfy native referrers discovery in this run. Client
  fallback tags work, but they do not meet the native API requirement.
- Distribution GC must run while the registry is read-only or stopped. Its own
  documentation warns that concurrent uploads can lose layers.
- Object loss causes pulls to fail in both implementations. Restoring the exact S3
  object restores the pull. zot also provides checksum scrub; Distribution does not.
- LocalStack does not prove Cloudflare-specific endpoint, permission, multipart,
  consistency, latency, or billing behavior. A live canary is a release gate.
- The Docker runtime used for this spike did not expose a trustworthy zot cgroup
  memory value. Runtime RAM and CPU must be captured in the deployment canary rather
  than inferred from host-wide Docker statistics.

## Operating cost

The registry compute cost depends on the selected deployment platform and workload,
so this spike does not invent a dollar estimate. The reproducible local comparison
records image size. The exact runtime image includes a generated htpasswd layer and
can vary by a few kilobytes between runs. The live canary should add idle and
sustained CPU/RAM.

For R2 Standard storage, the pricing reference at the test date lists $0.015 per
GB-month, $4.50 per million Class A operations, $0.36 per million Class B operations,
and no R2 egress fee. The monthly free allocation is 10 GB-month, 1 million Class A
operations, and 10 million Class B operations. Apply those rates to retained blob
bytes and measured request counts from the canary. Registry metadata creates several
objects per artifact, so artifact count alone is not a sound request-cost estimate.

## Release gate

Before production, run both the normal client matrix and concurrent multipart
uploads against disposable real-R2 buckets, verify all objects and buckets are
removed, collect request counts and registry CPU/RAM, then repeat the selected zot
version upgrade. A failure should first be taken upstream as a zot or storage-driver
issue. A custom gateway remains unjustified because zot met the documented local
requirements without a patch.
