{{ config(location=model_location('mart_operational_metrics.parquet'), options={'compression': 'zstd'}) }}

with period as (
  select
    cast('{{ var("period_start") }}' as timestamptz) as period_start,
    cast('{{ var("period_end") }}' as timestamptz) as period_end
),
waits_in_period as (
  select
    waits.*,
    greatest(waits.opened_at, period.period_start) as clipped_opened_at,
    least(coalesce(waits.closed_at, period.period_end), period.period_end) as clipped_closed_at
  from {{ ref('fct_wait_episodes') }} as waits
  cross join period
  where waits.opened_at < period.period_end
    and coalesce(waits.closed_at, period.period_end) > period.period_start
),
wait_rollup as (
  select
    work_item_id,
    cause,
    count(*) as episodes,
    sum(epoch_ms(clipped_closed_at - clipped_opened_at)) as wait_milliseconds,
    count(*) filter (where closed_at is null or closed_at >= (select period_end from period)) as open_at_end,
    count(*) filter (where cause = 'stale_lease' and closed_at >= (select period_start from period) and closed_at < (select period_end from period)) as stale_takeovers,
    count(*) filter (where failed_handoff_proxy and closed_at >= (select period_start from period) and closed_at < (select period_end from period)) as failed_handoff_proxies
  from waits_in_period
  group by work_item_id, cause
),
interventions as (
  select
    requests.work_item_id,
    'attention:' || requests.attention_kind as cause,
    count(*) filter (
      where requests.occurred_at >= (select period_start from period)
        and requests.occurred_at < (select period_end from period)
    ) as intervention_requests,
    count(resolutions.sequence) filter (
      where resolutions.occurred_at >= (select period_start from period)
        and resolutions.occurred_at < (select period_end from period)
    ) as resolutions
  from {{ ref('fct_events') }} as requests
  left join {{ ref('fct_events') }} as resolutions
    on resolutions.event_type = 'attention.resolved'
    and resolutions.work_item_id = requests.work_item_id
    and resolutions.attention_request_id = requests.attention_request_id
    and resolutions.sequence > requests.sequence
  where requests.event_type = 'attention.requested'
  group by requests.work_item_id, requests.attention_kind
),
item_metrics as (
  select
    coalesce(waits.work_item_id, interventions.work_item_id) as work_item_id,
    coalesce(waits.cause, interventions.cause) as cause,
    coalesce(waits.episodes, 0) as episodes,
    coalesce(waits.wait_milliseconds, 0) as wait_milliseconds,
    coalesce(waits.open_at_end, 0) as open_at_end,
    coalesce(interventions.intervention_requests, 0) as intervention_requests,
    coalesce(interventions.resolutions, 0) as resolutions,
    coalesce(waits.stale_takeovers, 0) as stale_takeovers,
    coalesce(waits.failed_handoff_proxies, 0) as failed_handoff_proxies
  from wait_rollup as waits
  full outer join interventions using (work_item_id, cause)
),
scoped as (
  select item_metrics.*, scopes.project_id, scopes.initiative_id
  from item_metrics
  left join {{ ref('fct_scopes') }} as scopes using (work_item_id)
)
select
  scoped.project_id,
  scoped.initiative_id,
  scoped.cause,
  sum(scoped.episodes) as episodes,
  count(*) filter (where scoped.episodes > 1) as recurring_work_items,
  sum(scoped.wait_milliseconds) as wait_milliseconds,
  sum(scoped.open_at_end) as open_at_end,
  sum(scoped.intervention_requests) as intervention_requests,
  sum(scoped.resolutions) as resolutions,
  sum(scoped.stale_takeovers) as stale_takeovers,
  sum(scoped.failed_handoff_proxies) as failed_handoff_proxies,
  (select period_start from period) as period_start,
  (select period_end from period) as period_end,
  max(tickets.source_watermark) as source_watermark,
  max(tickets.scope_manifest_key) as scope_manifest_key
from scoped
left join {{ ref('fct_tickets') }} as tickets using (work_item_id)
group by scoped.project_id, scoped.initiative_id, scoped.cause
order by scoped.project_id nulls first, scoped.initiative_id nulls first, scoped.cause
