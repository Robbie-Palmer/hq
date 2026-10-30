{% test event_count_matches_staging(model) %}
select 1
where (select coalesce(sum(event_rows), 0) from {{ model }})
   <> (select count(*) from {{ ref('stg_events') }})
{% endtest %}
