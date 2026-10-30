select
  cast(schema_version as integer) as schema_version,
  cast(sequence as bigint) as sequence,
  cast(event_type as varchar) as event_type,
  cast(work_item_id as varchar) as work_item_id,
  cast(occurred_at as timestamptz) as occurred_at,
  cast(attention_request_id as varchar) as attention_request_id,
  cast(attention_kind as varchar) as attention_kind,
  cast(blocking as boolean) as blocking,
  cast(lease_id as varchar) as lease_id,
  cast(lease_expires_at as timestamptz) as lease_expires_at,
  cast(lease_outcome as varchar) as lease_outcome,
  cast(note_kind as varchar) as note_kind,
  cast(manifest_key as varchar) as manifest_key,
  cast(source_upper_watermark as bigint) as source_upper_watermark
from read_ndjson_auto('{{ var("raw_staging_root") }}/events.ndjson')
