{{ config(location=model_location('mart_stale_leases.parquet'), options={'compression': 'zstd'}) }}

select
  project_id,
  initiative_id,
  episodes,
  recurring_work_items,
  wait_milliseconds,
  open_at_end,
  stale_takeovers,
  failed_handoff_proxies,
  period_start,
  period_end,
  source_watermark,
  scope_manifest_key
from {{ ref('mart_operational_metrics') }}
where cause = 'stale_lease'
order by project_id nulls first, initiative_id nulls first
