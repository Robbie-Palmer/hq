with
period as (
  select ?::timestamptz as period_start, ?::timestamptz as period_end
),
wait_facts as (select * from read_parquet(?)),
event_facts as (select * from read_parquet(?)),
scope_facts as (select * from read_parquet(?)),
waits_in_period as (
  select
    waits.*,
    greatest(waits.opened_at, period.period_start) as clipped_opened_at,
    least(coalesce(waits.closed_at, period.period_end), period.period_end) as clipped_closed_at
  from wait_facts as waits
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
    count(*) filter (
      where closed_at is null or closed_at >= (select period_end from period)
    ) as open_at_end
  from waits_in_period
  group by work_item_id, cause
),
stale_outcomes as (
  select
    work_item_id,
    cause,
    count(*) as stale_takeovers,
    count(*) filter (where failed_handoff_proxy) as failed_handoff_proxies
  from wait_facts
  where cause = 'stale_lease'
    and closed_at >= (select period_start from period)
    and closed_at < (select period_end from period)
  group by work_item_id, cause
),
intervention_rollup as (
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
  from event_facts as requests
  left join lateral (
    select sequence, occurred_at
    from event_facts as candidate
    where candidate.event_type = 'attention.resolved'
      and candidate.work_item_id = requests.work_item_id
      and candidate.attention_request_id = requests.attention_request_id
      and candidate.sequence > requests.sequence
    order by candidate.sequence
    limit 1
  ) as resolutions on true
  where requests.event_type = 'attention.requested'
  group by requests.work_item_id, requests.attention_kind
),
interventions as (
  select *
  from intervention_rollup
  where intervention_requests > 0 or resolutions > 0
),
metric_parts as (
  select
    work_item_id, cause, episodes, wait_milliseconds, open_at_end,
    0 as intervention_requests, 0 as resolutions,
    0 as stale_takeovers, 0 as failed_handoff_proxies
  from wait_rollup
  union all
  select
    work_item_id, cause, 0, 0, 0, 0, 0,
    stale_takeovers, failed_handoff_proxies
  from stale_outcomes
  union all
  select
    work_item_id, cause, 0, 0, 0,
    intervention_requests, resolutions, 0, 0
  from interventions
),
item_metrics as (
  select
    work_item_id,
    cause,
    sum(episodes) as episodes,
    sum(wait_milliseconds) as wait_milliseconds,
    sum(open_at_end) as open_at_end,
    sum(intervention_requests) as intervention_requests,
    sum(resolutions) as resolutions,
    sum(stale_takeovers) as stale_takeovers,
    sum(failed_handoff_proxies) as failed_handoff_proxies
  from metric_parts
  group by work_item_id, cause
),
scoped as (
  select item_metrics.*, scopes.project_id, scopes.initiative_id
  from item_metrics
  left join scope_facts as scopes using (work_item_id)
),
selected as (
  select *
  from scoped
  where (?::varchar is null or project_id = ?::varchar)
    and (?::varchar is null or initiative_id = ?::varchar)
)
select
  project_id,
  initiative_id,
  cause,
  sum(episodes) as episodes,
  count(*) filter (where episodes > 1) as recurring_work_items,
  sum(wait_milliseconds) as wait_milliseconds,
  sum(open_at_end) as open_at_end,
  sum(intervention_requests) as intervention_requests,
  sum(resolutions) as resolutions,
  sum(stale_takeovers) as stale_takeovers,
  sum(failed_handoff_proxies) as failed_handoff_proxies
from selected
group by project_id, initiative_id, cause
order by project_id nulls first, initiative_id nulls first, cause
