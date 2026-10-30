SET preserve_insertion_order = false;
SET threads = 1;

CREATE TABLE raw_objects AS
SELECT json, filename
FROM read_json_objects([__INPUT_FILES__], filename = true);

-- Schema v2 carries recordType; schema v1 predates it and only ever stored
-- published review-run terminal records. Both are read here; neither is
-- rewritten. Any other schema version or shape fails the build.
CREATE TEMP TABLE typed_objects AS
SELECT filename, json,
       try_cast(json_extract_string(json, '$.schemaVersion') AS BIGINT) AS schema_version,
       json_extract_string(json, '$.recordType') AS record_type,
       json_extract_string(json, '$.status') AS status
FROM raw_objects;

CREATE TEMP TABLE invalid_objects AS
SELECT filename, schema_version, record_type
FROM typed_objects
WHERE json_type(json, '$.schemaVersion') NOT IN ('BIGINT', 'UBIGINT')
   OR (schema_version = 2 AND
       (record_type IS NULL OR record_type NOT IN
          ('review-run-terminal', 'finding-interaction-evidence', 'finding-outcome', 'replay-manifest')))
   OR (schema_version = 1 AND
       (record_type IS NOT NULL OR status IS DISTINCT FROM 'published'))
   OR (schema_version IS DISTINCT FROM 1 AND schema_version IS DISTINCT FROM 2);

SELECT CASE WHEN count(*) = 0 THEN 1 ELSE error(
  'Unknown schema version or record type: ' || string_agg(filename || ' (' || coalesce(schema_version, 'null') || ', ' || coalesce(record_type, 'null') || ')', ', ')
) END FROM invalid_objects;

CREATE TABLE review_run_candidates AS
SELECT
  filename,
  schema_version AS record_schema_version,
  json_extract_string(json, '$.workflow.instanceId') AS run_id,
  json_extract_string(json, '$.repository') AS repository,
  try_cast(json_extract_string(json, '$.pullRequestNumber') AS INTEGER) AS pull_request_number,
  json_extract_string(json, '$.headSha') AS head_sha,
  json_extract_string(json, '$.status') AS status,
  json_extract_string(json, '$.promptVersion') AS prompt_version,
  json_extract_string(json, '$.guardrailPolicy.publication.version') AS publication_policy_version,
  json_extract_string(json, '$.pullRequest.taskType') AS task_type,
  json_extract_string(json, '$.pullRequest.originatingAgent') AS originating_agent,
  coalesce(
    try_cast(json_extract_string(json, '$.workflow.triggeredAt') AS TIMESTAMPTZ),
    try_cast(json_extract_string(json, '$.workflow.timestamp') AS TIMESTAMPTZ)
  ) AS triggered_at,
  try_cast(json_extract_string(json, '$.change.additions') AS BIGINT) AS additions,
  try_cast(json_extract_string(json, '$.change.deletions') AS BIGINT) AS deletions,
  coalesce(try_cast(json_extract_string(json, '$.change.changedFiles') AS BIGINT), 0) AS changed_files,
  try_cast(json_extract_string(json, '$.coverage.totalHunks') AS BIGINT) AS total_hunks,
  CASE WHEN schema_version = 2
       THEN coalesce(json_array_length(json_extract(json, '$.coverage.reviewedHunkIds')), 0) END AS reviewed_hunks,
  coalesce(try_cast(json_extract_string(json, '$.runCostUsd') AS DOUBLE), 0) AS run_cost_usd,
  coalesce(json_extract(json, '$.change.riskSignals'), '[]'::JSON) AS risk_signals,
  coalesce(json_extract(json, '$.change.repositoryAreas'), '[]'::JSON) AS repository_areas,
  json_extract(json, '$.coverageManifest') AS coverage_manifest,
  CASE WHEN schema_version = 2
       THEN json_extract(json, '$.findings.published')
       ELSE json_extract(json, '$.findings.findings') END AS published_findings,
  schema_version = 2 AS finding_identity_available,
  json_extract(json, '$.models') AS models
FROM typed_objects
WHERE record_type = 'review-run-terminal'
   OR (schema_version = 1 AND status = 'published');

SELECT CASE WHEN count(*) > 0 THEN 1 ELSE error('At least one review-run-terminal object is required') END FROM review_run_candidates;
SELECT CASE WHEN count(*) = 0 THEN 1 ELSE error('Review runs have missing or invalid required fields') END
FROM review_run_candidates
WHERE run_id IS NULL OR repository IS NULL OR pull_request_number IS NULL OR head_sha IS NULL
   OR status NOT IN ('denied', 'failed', 'published', 'skipped');

-- A publication can succeed before the enclosing workflow later records a
-- failure (for example, when a post-publication step exceeds its lease). R2
-- retains both immutable terminal records. Reconcile only that known pair and
-- keep rejecting all other duplicate or conflicting terminal combinations.
SELECT CASE WHEN count(*) = 0 THEN 1 ELSE error('Review runs have conflicting or duplicate terminal records') END
FROM (
  SELECT run_id
  FROM review_run_candidates
  GROUP BY run_id
  HAVING count(*) > 1 AND NOT (
    count(*) = 2
    AND count(*) FILTER (WHERE status = 'published') = 1
    AND count(*) FILTER (WHERE status = 'failed') = 1
    AND count(DISTINCT repository) = 1
    AND count(DISTINCT pull_request_number) = 1
    AND count(DISTINCT head_sha) = 1
  )
);

CREATE TABLE review_runs AS
SELECT * EXCLUDE (filename, terminal_rank)
FROM (
  SELECT *, row_number() OVER (
    PARTITION BY run_id
    ORDER BY CASE status WHEN 'published' THEN 0 ELSE 1 END, filename
  ) AS terminal_rank
  FROM review_run_candidates
)
WHERE terminal_rank = 1;

SELECT CASE WHEN count(*) = 0 THEN 1 ELSE error('Review coverage manifests have an unknown schema or invalid path collection') END
FROM review_runs
WHERE coverage_manifest IS NOT NULL AND (
  try_cast(json_extract_string(coverage_manifest, '$.schemaVersion') AS BIGINT) IS DISTINCT FROM 1
  OR json_extract_string(coverage_manifest, '$.selectorVersion') IS NULL
  OR json_type(coverage_manifest, '$.paths') IS DISTINCT FROM 'ARRAY'
);

CREATE TABLE review_path_fact AS
SELECT
  r.run_id,
  r.repository,
  r.pull_request_number,
  r.head_sha,
  r.status AS run_status,
  cast(json_extract_string(r.coverage_manifest, '$.schemaVersion') AS BIGINT) AS manifest_schema_version,
  json_extract_string(r.coverage_manifest, '$.selectorVersion') AS selector_version,
  json_extract_string(p.value, '$.path') AS path,
  json_extract_string(p.value, '$.decision') AS decision,
  json_extract_string(p.value, '$.reasonCode') AS reason_code
FROM review_runs r, LATERAL json_each(json_extract(r.coverage_manifest, '$.paths')) p
WHERE r.coverage_manifest IS NOT NULL;

SELECT CASE WHEN count(*) = 0 THEN 1 ELSE error('Review coverage paths have missing or invalid decisions') END
FROM review_path_fact
WHERE path IS NULL OR path = '' OR decision IS NULL OR reason_code IS NULL
   OR decision NOT IN ('selected', 'excluded', 'completed', 'failed', 'waived')
   OR reason_code NOT IN (
     'default-included',
     'forced-inclusion',
     'configured-filename-exclusion',
     'configured-extension-exclusion',
     'configured-directory-exclusion',
     'configured-vendor-exclusion',
     'configured-generated-exclusion',
     'review-completed',
     'review-run-failed',
     'review-failed-diff-unavailable',
     'review-waived-no-semantic-change',
     'review-waived-prior-coverage',
     'review-waived-policy-denied',
     'review-waived-no-model-review'
   )
   OR NOT (
     (decision = 'selected' AND reason_code IN ('default-included', 'forced-inclusion'))
     OR (decision = 'excluded' AND reason_code IN (
       'configured-filename-exclusion',
       'configured-extension-exclusion',
       'configured-directory-exclusion',
       'configured-vendor-exclusion',
       'configured-generated-exclusion'
     ))
     OR (decision = 'completed' AND reason_code = 'review-completed')
     OR (decision = 'failed' AND reason_code IN ('review-run-failed', 'review-failed-diff-unavailable'))
     OR (decision = 'waived' AND reason_code IN (
       'review-waived-no-semantic-change',
       'review-waived-prior-coverage',
       'review-waived-policy-denied',
       'review-waived-no-model-review'
     ))
   );

SELECT CASE WHEN count(*) = 0 THEN 1 ELSE error('Review coverage manifests contain duplicate paths') END
FROM (
  SELECT run_id, path FROM review_path_fact GROUP BY run_id, path HAVING count(*) > 1
);

SELECT CASE WHEN count(*) = 0 THEN 1 ELSE error('Review coverage manifests do not account for every changed path') END
FROM review_runs r LEFT JOIN (
  SELECT run_id,
    count(*) AS manifest_path_count,
    count(*) FILTER (WHERE decision = 'selected') AS selected_path_count,
    count(*) FILTER (WHERE decision = 'excluded') AS excluded_path_count,
    count(*) FILTER (WHERE decision = 'completed') AS completed_path_count,
    count(*) FILTER (WHERE decision = 'failed') AS failed_path_count,
    count(*) FILTER (WHERE decision = 'waived') AS waived_path_count
  FROM review_path_fact GROUP BY run_id
) p USING (run_id)
WHERE r.coverage_manifest IS NOT NULL AND (
  coalesce(p.manifest_path_count, 0) IS DISTINCT FROM r.changed_files
  OR try_cast(json_extract_string(r.coverage_manifest, '$.summary.selected') AS BIGINT)
     IS DISTINCT FROM coalesce(p.selected_path_count, 0)
  OR try_cast(json_extract_string(r.coverage_manifest, '$.summary.excluded') AS BIGINT)
     IS DISTINCT FROM coalesce(p.excluded_path_count, 0)
  OR try_cast(json_extract_string(r.coverage_manifest, '$.summary.completed') AS BIGINT)
     IS DISTINCT FROM coalesce(p.completed_path_count, 0)
  OR try_cast(json_extract_string(r.coverage_manifest, '$.summary.failed') AS BIGINT)
     IS DISTINCT FROM coalesce(p.failed_path_count, 0)
  OR try_cast(json_extract_string(r.coverage_manifest, '$.summary.waived') AS BIGINT)
     IS DISTINCT FROM coalesce(p.waived_path_count, 0)
);

CREATE TABLE finding_history AS
SELECT
  json_extract_string(json, '$.repository') AS repository,
  cast(json_extract_string(json, '$.pullRequestNumber') AS INTEGER) AS pull_request_number,
  json_extract_string(json, '$.findingId') AS finding_id,
  cast(json_extract_string(json, '$.outcomeVersion') AS INTEGER) AS outcome_version,
  json_extract_string(json, '$.outcome') AS outcome,
  coalesce(json_extract_string(json, '$.outcomeKind'), CASE
    WHEN json_extract_string(json, '$.outcome') = 'no-observable-response' THEN 'workflow'
    WHEN json_extract_string(json, '$.outcome') = 'superseded' THEN 'censored'
    ELSE 'adjudicated'
  END) AS outcome_kind,
  json_extract_string(json, '$.basis') AS outcome_basis,
  coalesce(try_cast(json_extract_string(json, '$.confidence') AS DOUBLE), 1) AS outcome_confidence,
  coalesce(json_extract_string(json, '$.evaluatorVersion'), 'legacy-v1') AS evaluator_version,
  json_type(json, '$.manualOverride') = 'OBJECT' AS manual_override,
  json_extract_string(json, '$.occurredAt')::TIMESTAMPTZ AS outcome_at
FROM raw_objects WHERE json_extract_string(json, '$.recordType') = 'finding-outcome';

SELECT CASE WHEN count(*) = 0 THEN 1 ELSE error('Outcome revisions require positive, unique versions') END
FROM (SELECT repository, pull_request_number, finding_id, outcome_version FROM finding_history
      GROUP BY ALL HAVING outcome_version IS NULL OR outcome_version < 1 OR count(*) > 1);

SELECT CASE WHEN count(*) = 0 THEN 1 ELSE error('Outcome revisions have missing or invalid required fields') END
FROM finding_history
WHERE repository IS NULL OR pull_request_number IS NULL OR finding_id IS NULL
   OR outcome IS NULL OR outcome NOT IN
      ('confirmed-fixed', 'acknowledged', 'rejected', 'superseded', 'no-observable-response')
   OR outcome_basis IS NULL OR outcome_basis NOT IN
      ('explicit-disposition', 'later-reviewed-head', 'pull-request-finalization', 'outcome-window')
   OR (outcome_basis = 'outcome-window' AND outcome != 'no-observable-response')
   OR outcome_kind NOT IN ('adjudicated', 'censored', 'workflow')
   OR outcome_kind IS DISTINCT FROM CASE
      WHEN outcome = 'no-observable-response' THEN 'workflow'
      WHEN outcome = 'superseded' THEN 'censored'
      ELSE 'adjudicated'
   END
   OR outcome_confidence < 0 OR outcome_confidence > 1
   OR evaluator_version IS NULL
   OR outcome_at IS NULL;

CREATE TABLE published_findings AS
SELECT r.run_id, r.repository, r.pull_request_number, r.head_sha, r.prompt_version, r.triggered_at,
       json_extract_string(f.value, '$.findingId') AS finding_id,
       json_extract_string(f.value, '$.file') AS file,
       json_extract_string(f.value, '$.severity') AS severity,
       json_extract_string(f.value, '$.title') AS title,
       json_extract(f.value, '$.source_models') AS source_models
FROM review_runs r, LATERAL json_each(coalesce(r.published_findings, '[]'::JSON)) f
WHERE r.status = 'published' AND r.finding_identity_available;

SELECT CASE WHEN count(*) = 0 THEN 1 ELSE error('Published findings have missing or invalid required fields') END
FROM published_findings
WHERE finding_id IS NULL OR file IS NULL OR title IS NULL
   OR source_models IS NULL OR json_type(source_models) != 'ARRAY';

SELECT CASE WHEN count(*) = 0 THEN 1 ELSE error('Outcome/evidence references a finding that was never published') END
FROM (
  SELECT h.finding_id FROM finding_history h LEFT JOIN published_findings p
    USING (repository, pull_request_number, finding_id) WHERE p.finding_id IS NULL
  UNION ALL
  SELECT json_extract_string(e.json, '$.findingId')
  FROM raw_objects e LEFT JOIN published_findings p
    ON p.repository = json_extract_string(e.json, '$.repository')
   AND p.pull_request_number = cast(json_extract_string(e.json, '$.pullRequestNumber') AS INTEGER)
   AND p.finding_id = json_extract_string(e.json, '$.findingId')
  WHERE json_extract_string(e.json, '$.recordType') = 'finding-interaction-evidence' AND p.finding_id IS NULL
);

CREATE TABLE finding_latest AS
WITH first_publication AS (
  SELECT * EXCLUDE (rn) FROM (SELECT *, row_number() OVER (PARTITION BY repository, pull_request_number, finding_id ORDER BY triggered_at, run_id) rn FROM published_findings) WHERE rn = 1
), latest_outcome AS (
  SELECT * EXCLUDE (rn) FROM (SELECT *, row_number() OVER (PARTITION BY repository, pull_request_number, finding_id ORDER BY outcome_version DESC) rn FROM finding_history) WHERE rn = 1
)
SELECT p.*, o.outcome_version, o.outcome, o.outcome_kind, o.outcome_basis,
       o.outcome_confidence, o.evaluator_version, o.manual_override, o.outcome_at,
       o.outcome IN ('confirmed-fixed', 'acknowledged') AS accepted,
       o.outcome = 'confirmed-fixed' AS fixed,
       o.outcome = 'rejected' AS rejected,
       o.outcome = 'no-observable-response' OR o.outcome IS NULL AS no_response,
       date_diff('millisecond', p.triggered_at, o.outcome_at) AS outcome_latency_ms
FROM first_publication p LEFT JOIN latest_outcome o USING (repository, pull_request_number, finding_id);

CREATE TABLE review_run_fact AS
WITH finding_counts AS (
  SELECT run_id,
    count(*) AS published_count,
    count(*) FILTER (WHERE accepted) AS accepted_count,
    count(*) FILTER (WHERE fixed) AS fixed_count,
    count(*) FILTER (WHERE rejected) AS rejected_count,
    count(*) FILTER (WHERE no_response) AS no_response_count
  FROM finding_latest GROUP BY run_id
), path_counts AS (
  SELECT run_id,
    count(*) AS manifest_path_count,
    count(*) FILTER (WHERE decision = 'selected') AS selected_path_count,
    count(*) FILTER (WHERE decision = 'excluded') AS excluded_path_count,
    count(*) FILTER (WHERE decision = 'completed') AS completed_path_count,
    count(*) FILTER (WHERE decision = 'failed') AS failed_path_count,
    count(*) FILTER (WHERE decision = 'waived') AS waived_path_count
  FROM review_path_fact GROUP BY run_id
)
SELECT r.* EXCLUDE (published_findings, models, coverage_manifest),
  r.additions + r.deletions AS change_size,
  CASE WHEN r.additions + r.deletions IS NULL THEN NULL
       WHEN r.additions + r.deletions < 50 THEN 'small'
       WHEN r.additions + r.deletions < 250 THEN 'medium'
       ELSE 'large' END AS change_size_band,
  CASE WHEN r.finding_identity_available THEN coalesce(f.published_count, 0)
       ELSE coalesce(json_array_length(coalesce(r.published_findings, '[]'::JSON)), 0) END AS published_finding_count,
  CASE WHEN r.finding_identity_available THEN coalesce(f.accepted_count, 0) END AS accepted_finding_count,
  CASE WHEN r.finding_identity_available THEN coalesce(f.fixed_count, 0) END AS fixed_finding_count,
  CASE WHEN r.finding_identity_available THEN coalesce(f.rejected_count, 0) END AS rejected_finding_count,
  CASE WHEN r.finding_identity_available THEN coalesce(f.no_response_count, 0) END AS no_response_finding_count,
  CASE WHEN r.total_hunks IS NULL OR r.total_hunks = 0 THEN NULL
       ELSE r.reviewed_hunks::DOUBLE / r.total_hunks END AS coverage_rate,
  CASE WHEN NOT r.finding_identity_available OR coalesce(f.accepted_count, 0) = 0 THEN NULL
       ELSE r.run_cost_usd / f.accepted_count END AS cost_per_accepted_finding,
  CASE WHEN NOT r.finding_identity_available
        OR coalesce(f.accepted_count, 0) + coalesce(f.rejected_count, 0) = 0 THEN NULL
       ELSE f.accepted_count::DOUBLE / (f.accepted_count + f.rejected_count) END AS acceptance_rate,
  CASE WHEN NOT r.finding_identity_available OR coalesce(f.published_count, 0) = 0 THEN NULL
       ELSE coalesce(f.fixed_count, 0)::DOUBLE / f.published_count END AS fix_through_rate,
  CASE WHEN NOT r.finding_identity_available OR coalesce(f.published_count, 0) = 0 THEN NULL
       ELSE coalesce(f.rejected_count, 0)::DOUBLE / f.published_count END AS noise_rate,
  CASE WHEN NOT r.finding_identity_available OR coalesce(f.published_count, 0) = 0 THEN NULL
       ELSE coalesce(f.no_response_count, 0)::DOUBLE / f.published_count END AS no_response_rate,
  r.coverage_manifest IS NOT NULL AS path_manifest_available,
  CASE WHEN r.coverage_manifest IS NOT NULL THEN coalesce(p.manifest_path_count, 0) END AS manifest_path_count,
  CASE WHEN r.coverage_manifest IS NOT NULL THEN coalesce(p.selected_path_count, 0) END AS selected_path_count,
  CASE WHEN r.coverage_manifest IS NOT NULL THEN coalesce(p.excluded_path_count, 0) END AS excluded_path_count,
  CASE WHEN r.coverage_manifest IS NOT NULL THEN coalesce(p.completed_path_count, 0) END AS completed_path_count,
  CASE WHEN r.coverage_manifest IS NOT NULL THEN coalesce(p.failed_path_count, 0) END AS failed_path_count,
  CASE WHEN r.coverage_manifest IS NOT NULL THEN coalesce(p.waived_path_count, 0) END AS waived_path_count,
  CASE WHEN r.coverage_manifest IS NULL OR r.changed_files = 0 THEN NULL
       ELSE coalesce(p.manifest_path_count, 0)::DOUBLE / r.changed_files END AS path_accounting_rate
FROM review_runs r
LEFT JOIN finding_counts f USING (run_id)
LEFT JOIN path_counts p USING (run_id);

CREATE TABLE model_run_fact AS
WITH model_rows AS (
SELECT r.run_id, r.repository, r.pull_request_number, r.head_sha, r.prompt_version,
  r.publication_policy_version, r.record_schema_version, rf.finding_identity_available,
  json_extract_string(m.value, '$.model') AS model,
  json_extract_string(m.value, '$.provider') AS provider,
  json_extract_string(m.value, '$.role') AS role,
  cast(json_extract_string(m.value, '$.ok') AS BOOLEAN) AS ok,
  coalesce(try_cast(json_extract_string(m.value, '$.latencyMs') AS BIGINT), 0) AS latency_ms,
  coalesce(try_cast(json_extract_string(m.value, '$.costUsd') AS DOUBLE), 0) AS cost_usd,
  coalesce(try_cast(json_extract_string(m.value, '$.usage.inputTokens') AS BIGINT), 0) AS input_tokens,
  coalesce(try_cast(json_extract_string(m.value, '$.usage.cachedInputTokens') AS BIGINT), 0) AS cached_input_tokens,
  coalesce(try_cast(json_extract_string(m.value, '$.usage.outputTokens') AS BIGINT), 0) AS output_tokens,
  r.risk_signals, r.repository_areas, rf.change_size_band
FROM review_runs r JOIN review_run_fact rf USING (run_id), LATERAL json_each(coalesce(r.models, '[]'::JSON)) m
), attributed AS (
SELECT m.run_id, m.model, count(*) FILTER (WHERE f.accepted) AS accepted_count
FROM model_rows m LEFT JOIN finding_latest f
  ON f.run_id = m.run_id AND json_contains(coalesce(f.source_models, '[]'::JSON), to_json(m.model))
GROUP BY m.run_id, m.model
)
SELECT m.*,
  input_tokens - cached_input_tokens AS uncached_input_tokens,
  CASE WHEN input_tokens = 0 THEN NULL ELSE cached_input_tokens::DOUBLE / input_tokens END AS cache_hit_rate,
  CASE WHEN NOT m.finding_identity_available OR input_tokens - cached_input_tokens = 0 THEN NULL
       ELSE a.accepted_count::DOUBLE * 1000000.0 / (input_tokens - cached_input_tokens) END AS accepted_findings_per_million_uncached_tokens
FROM model_rows m JOIN attributed a USING (run_id, model);

CREATE TABLE pull_request_fact AS
SELECT repository, pull_request_number,
  min(triggered_at) AS first_review_at, max(triggered_at) AS last_review_at,
  count(*) AS review_run_count, sum(run_cost_usd) AS total_cost_usd,
  min(finding_identity_available) AS finding_identity_available,
  list_sort(list_distinct(list(record_schema_version))) AS record_schema_versions,
  sum(published_finding_count) AS published_finding_count,
  sum(accepted_finding_count) AS accepted_finding_count,
  sum(fixed_finding_count) AS fixed_finding_count,
  sum(rejected_finding_count) AS rejected_finding_count,
  sum(no_response_finding_count) AS no_response_finding_count,
  sum(reviewed_hunks) FILTER (WHERE finding_identity_available) AS reviewed_hunks,
  sum(total_hunks) FILTER (WHERE finding_identity_available) AS total_hunks,
  sum(manifest_path_count) FILTER (WHERE path_manifest_available) AS manifest_path_count,
  sum(selected_path_count) FILTER (WHERE path_manifest_available) AS selected_path_count,
  sum(excluded_path_count) FILTER (WHERE path_manifest_available) AS excluded_path_count,
  sum(completed_path_count) FILTER (WHERE path_manifest_available) AS completed_path_count,
  sum(failed_path_count) FILTER (WHERE path_manifest_available) AS failed_path_count,
  sum(waived_path_count) FILTER (WHERE path_manifest_available) AS waived_path_count,
  CASE WHEN sum(changed_files) FILTER (WHERE path_manifest_available) IS NULL
        OR sum(changed_files) FILTER (WHERE path_manifest_available) = 0 THEN NULL
       ELSE sum(manifest_path_count) FILTER (WHERE path_manifest_available)::DOUBLE
            / sum(changed_files) FILTER (WHERE path_manifest_available) END AS path_accounting_rate,
  CASE WHEN sum(total_hunks) FILTER (WHERE finding_identity_available) IS NULL
        OR sum(total_hunks) FILTER (WHERE finding_identity_available) = 0 THEN NULL
       ELSE sum(reviewed_hunks) FILTER (WHERE finding_identity_available)::DOUBLE
            / sum(total_hunks) FILTER (WHERE finding_identity_available) END AS coverage_rate,
  CASE WHEN coalesce(sum(accepted_finding_count) FILTER (WHERE finding_identity_available), 0) = 0 THEN NULL
       ELSE sum(run_cost_usd) FILTER (WHERE finding_identity_available)
            / sum(accepted_finding_count) FILTER (WHERE finding_identity_available) END AS cost_per_accepted_finding,
  list_sort(list_distinct(list(prompt_version) FILTER (WHERE prompt_version IS NOT NULL))) AS prompt_versions,
  list_sort(list_distinct(list(task_type) FILTER (WHERE task_type IS NOT NULL))) AS task_types,
  list_sort(list_distinct(list(originating_agent) FILTER (WHERE originating_agent IS NOT NULL))) AS originating_agents
FROM review_run_fact GROUP BY repository, pull_request_number;
