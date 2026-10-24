# Project secret and identity bootstrap

Use a versioned bootstrap plan after the bootstrap Terraform state has created
the project's empty Doppler configs and protected GitHub environments. The
plan is separate from the project profile and Terraform variables. It contains
names and routing data, never credential values.

The example at
`infra/project-modules/examples/secret-bootstrap.yaml` records the complete
secret inventory for a small Worker service. Each secret declares:

- its Doppler config and key as the system of record;
- every protected GitHub environment or Worker binding that consumes it;
- the person or team responsible for rotation; and
- whether a human supplies it, the bootstrap generates it, or an installed
  source extension supplies it.

The plan also lists the credentials used to perform the handoff. Give the
Doppler token write access only to the named project and configs. Limit the
GitHub token to environment-secret administration for the named repository.
The Cloudflare token needs Workers Scripts Write for the named account. Keep
these operator credentials in a supervised shell or a dedicated Doppler
config. They are not project runtime secrets.

## Plan and apply

Inspect the redacted plan first:

```bash
mise //:project:secret-bootstrap:plan -- \
  infra/project-modules/examples/secret-bootstrap.yaml
```

The output names every destination and reports each secret as `waiting`,
`ready`, or `complete`. It does not read the value environment variables.

Complete a manual provider action, export the value into the environment name
recorded by `creation.value_env`, then acknowledge its checkpoint while
applying:

```bash
mise //:project:secret-bootstrap:apply -- \
  infra/project-modules/examples/secret-bootstrap.yaml \
  --acknowledge create-cloudflare-deploy-token
```

The command passes values to Doppler and GitHub on standard input. Worker
bindings use Cloudflare's HTTPS API. Values do not appear in arguments,
output, the plan, or the resume file. Provider failures report the command or
HTTP status without including a response body.

The default resume file is
`.project-bootstrap/<project-id>.json`. Git ignores this directory. The file
has mode `0600` and contains only the plan digest, acknowledged checkpoint
IDs, and completed secret IDs. A later run skips complete secrets. If a
provider fails midway through one secret, the next run sends that secret to
all destinations again so the copies converge.

## Network and scope controls

The executor accepts only the canonical Doppler, GitHub, and Cloudflare API
origins. It rejects a changed origin before reading or sending a value. The
plan parser also rejects a Doppler config, GitHub environment, or Worker that
is not in the matching identity allowlist.

The core flow does not create Cloudflare API tokens. Manually issued tokens
are ordinary `manual` inputs, as shown in the example. An optional token
provisioner can implement a named `extension` source through the executor's
extension interface. Adding one does not change project profiles or bootstrap
plan schema version 1.

Identity-provider consoles often require a consent screen, callback URI, or
human approval. Record that action as a checkpoint and make the issued secret
depend on it. The acknowledgement remains in the resume file, so the next run
continues without repeating completed provider work.
