select
  cast(manifest_key as varchar) as manifest_key,
  cast(manifest_schema_version as integer) as manifest_schema_version,
  cast(batch_id as varchar) as batch_id,
  cast(from_sequence_exclusive as bigint) as from_sequence_exclusive,
  cast(through_sequence as bigint) as through_sequence,
  cast(source_upper_watermark as bigint) as source_upper_watermark,
  cast(captured_at as timestamptz) as captured_at,
  cast(event_object_key as varchar) as event_object_key,
  cast(event_rows as bigint) as event_rows,
  cast(event_checksum_sha256 as varchar) as event_checksum_sha256,
  cast(scope_object_key as varchar) as scope_object_key,
  cast(scope_rows as bigint) as scope_rows,
  cast(scope_checksum_sha256 as varchar) as scope_checksum_sha256
from read_ndjson_auto('{{ var("raw_staging_root") }}/manifests.ndjson')
