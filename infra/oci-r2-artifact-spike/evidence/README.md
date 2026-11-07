# Evidence state

The live canary has not run in this checkout. No disposable R2 credentials were
available on 2026-11-07, and the upstream provider comparison has not yet
shortlisted or rejected R2-backed zot.

`mise //infra/oci-r2-artifact-spike:live` writes a redacted `scorecard.json` here
only after every check passes and the disposable bucket is deleted. A pull request
containing only this state proves the canary implementation and its local checks,
not R2 compatibility. Do not use it to clear the live-provider release gate.
