{{ config(location=model_location('mart_handoffs.parquet'), options={'compression': 'zstd'}) }}

select
  project_id,
  initiative_id,
  stale_takeovers,
  failed_handoff_proxies,
  period_start,
  period_end,
  source_watermark,
  scope_manifest_key
from {{ ref('mart_stale_leases') }}
order by project_id nulls first, initiative_id nulls first
