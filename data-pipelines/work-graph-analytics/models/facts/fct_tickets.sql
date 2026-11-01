{{ config(location=model_location('fct_tickets.parquet'), options={'compression': 'zstd'}) }}

with identities as (
  select work_item_id from {{ ref('stg_events') }}
  union
  select work_item_id from {{ ref('stg_scopes') }}
),
event_rollup as (
  select
    work_item_id,
    min(sequence) as first_event_sequence,
    max(sequence) as latest_event_sequence,
    min(occurred_at) as first_event_at,
    max(occurred_at) as latest_event_at,
    count(*) as event_count,
    max(source_upper_watermark) as source_watermark
  from {{ ref('stg_events') }}
  group by work_item_id
)
select
  identities.work_item_id,
  event_rollup.first_event_sequence,
  event_rollup.latest_event_sequence,
  event_rollup.first_event_at,
  event_rollup.latest_event_at,
  coalesce(event_rollup.event_count, 0) as event_count,
  latest_manifest.through_sequence as source_watermark,
  latest_manifest.manifest_key as source_manifest_key,
  scopes.project_id,
  scopes.initiative_id,
  scopes.manifest_key as scope_manifest_key
from identities
left join event_rollup using (work_item_id)
left join {{ ref('fct_scopes') }} as scopes using (work_item_id)
cross join (
  select through_sequence, manifest_key
  from {{ ref('stg_manifests') }}
  order by through_sequence desc
  limit 1
) as latest_manifest
order by identities.work_item_id
