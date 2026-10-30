{{ config(location=model_location('mart_interventions.parquet'), options={'compression': 'zstd'}) }}

select *
from {{ ref('mart_operational_metrics') }}
where cause like 'attention:%'
order by project_id nulls first, initiative_id nulls first, cause
