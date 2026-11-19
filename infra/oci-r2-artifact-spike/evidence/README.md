# Evidence state

No live R2 canary evidence is committed yet.

`mise //infra/oci-r2-artifact-spike:live` writes a redacted `scorecard.json` here
only after every check passes and the disposable bucket is deleted. A pull request
containing only this file has no live-provider evidence.
