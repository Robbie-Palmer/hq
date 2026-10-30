{{ config(location=model_location('fct_wait_episodes.parquet'), options={'compression': 'zstd'}) }}

with attention_requests as (
  select
    sequence as opened_sequence,
    work_item_id,
    attention_request_id as episode_identity,
    'attention:' || attention_kind as cause,
    occurred_at as opened_at
  from {{ ref('stg_events') }}
  where event_type = 'attention.requested'
    and blocking
),
attention_waits as (
  select
    requests.opened_sequence,
    min(resolutions.sequence) as closed_sequence,
    requests.work_item_id,
    requests.episode_identity,
    requests.cause,
    requests.opened_at,
    min(resolutions.occurred_at) as closed_at,
    min(resolutions.occurred_at) is null as open_at_watermark,
    false as failed_handoff_proxy
  from attention_requests as requests
  left join {{ ref('stg_events') }} as resolutions
    on resolutions.event_type = 'attention.resolved'
    and resolutions.work_item_id = requests.work_item_id
    and resolutions.attention_request_id = requests.episode_identity
    and resolutions.sequence > requests.opened_sequence
  group by all
),
lease_starts as (
  select
    sequence as opened_sequence,
    work_item_id,
    lease_id as episode_identity,
    lease_expires_at as initial_expiry
  from {{ ref('stg_events') }}
  where event_type = 'lease.claimed'
),
lease_ends as (
  select
    starts.*,
    ended.sequence as closed_sequence,
    ended.occurred_at as closed_at,
    ended.lease_outcome,
    coalesce((
      select arg_max(renewed.lease_expires_at, renewed.sequence)
      from {{ ref('stg_events') }} as renewed
      where renewed.event_type = 'lease.renewed'
        and renewed.lease_id = starts.episode_identity
        and renewed.work_item_id = starts.work_item_id
        and renewed.sequence > starts.opened_sequence
        and renewed.sequence < coalesce(ended.sequence, 9223372036854775807)
    ), starts.initial_expiry) as expires_at,
    exists (
      select 1
      from {{ ref('stg_events') }} as notes
      where notes.event_type = 'note.created'
        and notes.note_kind = 'work'
        and notes.lease_id = starts.episode_identity
        and notes.work_item_id = starts.work_item_id
        and notes.sequence > starts.opened_sequence
        and notes.sequence < coalesce(ended.sequence, 9223372036854775807)
    ) as has_work_note
  from lease_starts as starts
  left join lateral (
    select sequence, occurred_at, lease_outcome
    from {{ ref('stg_events') }}
    where event_type = 'lease.ended'
      and lease_id = starts.episode_identity
      and work_item_id = starts.work_item_id
      and sequence > starts.opened_sequence
    order by sequence
    limit 1
  ) as ended on true
),
lease_waits as (
  select
    opened_sequence,
    closed_sequence,
    work_item_id,
    episode_identity,
    'stale_lease' as cause,
    expires_at as opened_at,
    case when lease_outcome = 'expired' then closed_at end as closed_at,
    lease_outcome is null as open_at_watermark,
    lease_outcome = 'expired' and not has_work_note as failed_handoff_proxy
  from lease_ends
  where lease_outcome = 'expired'
     or lease_outcome is null
),
episodes as (
  select * from attention_waits
  union all
  select * from lease_waits
)
select
  row_number() over (order by opened_sequence, cause, episode_identity) as wait_episode_id,
  episodes.*,
  manifests.through_sequence as source_watermark,
  manifests.manifest_key as source_manifest_key
from episodes
cross join (
  select through_sequence, manifest_key
  from {{ ref('stg_manifests') }}
  order by through_sequence desc
  limit 1
) as manifests
order by opened_sequence, cause, episode_identity
