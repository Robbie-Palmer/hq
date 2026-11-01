{{ config(location=model_location('fct_events.parquet'), options={'compression': 'zstd'}) }}

select *
from {{ ref('stg_events') }}
order by sequence
