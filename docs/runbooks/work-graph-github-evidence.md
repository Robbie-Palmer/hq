# GitHub evidence recovery

The Work Graph observer records pull-request, workflow-run, and deployment
evidence. GitHub webhooks provide the normal low-latency path. A scheduled
reconciliation at minute 17 every six hours repairs missed deliveries and
backfills current facts for every open ticket with an `implementation` pull
request link.

Reconciliation uses a GitHub App JWT only to obtain a short-lived installation
token. Repository and installation allowlists apply to both webhook and
reconciliation traffic. Reconciled facts use deterministic delivery IDs and
the normal database consumer, so rerunning the operation neither duplicates
evidence, recovery work, nor replacement-launch reservations. It also cannot
replace a newer projection with an older provider observation.

## Verify normal processing

1. Open the GitHub App's **Advanced** page and select a recent delivery for an
   allowed repository. A successful ingress attempt returns HTTP `202`.
2. Inspect the `work-graph-github-observer` Worker logs. Webhook processing
   records the delivery ID and disposition. Scheduled runs record only
   `operation`, target and delivery counts, and dispositions.
3. Run `work-graph show <ticket>` and confirm that the implementation PR and
   evidence observations refer to the expected repository and exact head or
   merge commit.
4. Treat `unmatched` as a correlation problem, not a transient retry. Confirm
   that the PR is attached with role `implementation` and that a unique linked
   PR owns the observed commit.

The deployment state `waiting` is a valid pending observation. It must be
accepted and later superseded by the provider's terminal status rather than
sent to the DLQ as an invalid observation.

## Recover a requested delivery action

The delivery executor records each merge or deployment request before it acts.
The request names the Work Graph item, immutable owner-policy revision, exact
GitHub evidence identity, commit, and initiating agent session when one exists.
GitHub evidence that is not tied to a recorded action remains ordinary evidence.

A failed or cancelled requested action creates one recovery record and one
blocking attention request. Work Graph stores only the normalized evidence
identity, state, source URL, and provider timestamp. It does not copy webhook
payloads or job logs into the recovery record.

The initiating session pulls unresolved records from
`GET /api/delivery-recoveries?initiatingSessionId=<session>`. A coordinator with
inbound session delivery can reserve one push through
`POST /api/delivery-recoveries/<recovery>/deliveries`. The reservation must
target the initiating session recorded on the action request. If that session
cannot resume, the stored policy fallback permits either owner attention or one
replacement-launch reservation. Repeated webhook delivery and reconciliation
reuse the same result, recovery, attention, and delivery reservations.

Resolve the linked attention request only after recovery succeeds or the owner
records another disposition. Resolution removes the record from the unresolved
session pull without deleting its action, result, evidence, or routing history.

## Redeliver a missed webhook

Use GitHub's App delivery page to redeliver the original event. Preserve the
original delivery ID and payload. Do not construct a replacement request or
edit the payload. A repeat with the same digest is safe; reuse of an ID with a
different digest is rejected.

If GitHub no longer offers the delivery, allow the next scheduled
reconciliation to reconstruct the current PR, completed workflow runs, and
deployment statuses. Then repeat the Work Graph inspection above.

## Recover the dead-letter queue

1. Inspect `work-graph-github-deliveries-dlq` in the Cloudflare dashboard and
   correlate each message's delivery ID with the Worker logs and
   `github_delivery_processing` record. Do not copy payloads into tickets or
   logs.
2. Fix the underlying configuration, schema, or correlation problem first.
   A `failed` disposition is retryable; `ignored` and `unmatched` are retained
   outcomes and should not be replayed blindly.
3. Prefer GitHub's delivery-page redelivery when it is available. Otherwise,
   wait for reconciliation to recover current facts. Delete the DLQ message
   only after Work Graph contains the expected observation or the message is
   proven obsolete.
4. If more than one message failed for the same incident, recover one message
   end to end before processing the rest.

## Diagnose reconciliation failures

Reconciliation fails the scheduled invocation if GitHub rejects a request,
returns an invalid shape, exceeds ten API pages for a collection, leaves the
configured host, or if the consumer retains a failed delivery. Check, in
order:

1. The GitHub App is installed on the linked repository and its installation
   and lowercase `owner/repository` name are in the observer allowlists.
2. The App still has read access to pull requests, Actions, deployments, and
   repository metadata.
3. `GITHUB_APP_ID` and `GITHUB_APP_PRIVATE_KEY` contain a matching active key
   pair in Doppler config `work-graph/prd_work_graph`.
4. Hyperdrive is healthy and all Work Graph migrations are deployed.
5. The linked implementation PR has not been transferred or deleted.

After repair, redeploy with `mise //workers/work-graph-observer:deploy` if a
secret or binding changed. Otherwise the next six-hour run retries the work.
Inspect its summary and the ticket before closing the incident.

## Rotate credentials

For the App private key, add a new key in GitHub, replace
`GITHUB_APP_PRIVATE_KEY` in Doppler, sync the `production-work-graph`
environment, deploy the observer, and verify a successful scheduled deployment
or reconciliation. Revoke the old key only after verification.

For the webhook secret, update GitHub and Doppler in one maintenance window,
sync and deploy, then redeliver a recent event. GitHub permits one active
webhook secret, so use reconciliation to recover deliveries missed during the
cutover.

Never place either secret in a Work Graph note, shell argument, log, or
repository file.

## Production pilot

Use one real `hq` change to verify the full path:

Before the pilot, create an immutable owner policy. Assign it directly for a
one-off pilot, or make it the repository default. Direct assignment evaluates
evidence that has already arrived. Repository defaults apply when an unassigned
ticket with linked implementation pull requests is next evaluated. PR linking,
webhook delivery, and reconciliation all trigger evaluation.

```bash
work-graph completion-policy put --json '{"policyId":"hq-production","revision":1,"requiredCiNames":["Work Graph Observer CI"],"productionEnvironments":["production-work-graph"],"automaticRelease":true}'
work-graph completion-policy assign <ticket> --policy-id hq-production --policy-revision 1
work-graph completion-policy default put Robbie-Palmer/hq 1 --policy-id hq-production --policy-revision 1
```

Use a new revision when requirements change. Reusing a policy ID and revision
with different contents is rejected. The highest repository-default revision
wins. Add a later revision with `--enabled false` to pause new default
assignments. Existing explicit ticket assignments remain unchanged.

For the `hq` repository, production CD jobs publish distinct GitHub deployment
environments. Examples include `production-site-ui`, `production-recipe-api`,
`production-recipe-ingest`, `production-ai-review`, `production-work-graph`,
and `production-infra`. Put every owner-approved environment in the policy's
`productionEnvironments` list. A successful deployment in any listed
environment can satisfy the deployment requirement for its exact merge commit.

1. Attach its pull request to the ticket with
   `work-graph pr attach <ticket> <url> --role implementation`.
2. Confirm the PR observation appears. Merge only after CI succeeds.
3. Confirm completed CI evidence for the accepted commit and successful
   production deployment evidence for the merge commit. A queued or `waiting`
   deployment may appear first and is not sufficient for completion.
4. Confirm Work Graph releases the ticket only after every linked implementation
   pull request and configured policy requirement is satisfied.
5. Inspect `work-graph metadata releases <ticket>`. The event must contain the
   policy revision, candidate evaluation ID, and stored evidence IDs.

An active worker lease keeps lifecycle control with that worker. Automatic
evaluation may mark the ticket as a candidate, but it does not end, steal, or
bypass the lease. Policies without `automaticRelease` also remain candidate-only.
