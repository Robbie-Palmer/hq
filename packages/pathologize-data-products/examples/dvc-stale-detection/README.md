# DVC source-lock stale-detection example

The derived `compose` stage depends on the upstream source product's
`dvc.lock`, product contract, and records interface. A source product revision
therefore makes the derived product stale even if its last committed output is
still present.

The package test copies this directory, changes only `source/dvc.lock`, runs
`dvc status`, and checks that `derived/composed.json` did not change. This is
the same dependency pattern used by the existing Pathologize derived products.
