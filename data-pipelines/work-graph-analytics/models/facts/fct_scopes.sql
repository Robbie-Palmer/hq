{{ config(location=model_location('fct_scopes.parquet'), options={'compression': 'zstd'}) }}

select
  work_item_id,
  project_id,
  initiative_id,
  captured_at,
  event_watermark as source_watermark,
  manifest_key,
  scope_object_key
from {{ ref('stg_scopes') }}
qualify row_number() over (
  partition by work_item_id
  order by event_watermark desc, manifest_key desc
) = 1
order by work_item_id
