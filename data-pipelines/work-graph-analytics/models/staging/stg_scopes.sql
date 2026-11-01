select
  cast(work_item_id as varchar) as work_item_id,
  cast(project_id as varchar) as project_id,
  cast(initiative_id as varchar) as initiative_id,
  cast(captured_at as timestamptz) as captured_at,
  cast(event_watermark as bigint) as event_watermark,
  cast(manifest_key as varchar) as manifest_key,
  cast(scope_object_key as varchar) as scope_object_key
from read_ndjson_auto('{{ var("raw_staging_root") }}/scopes.ndjson')
