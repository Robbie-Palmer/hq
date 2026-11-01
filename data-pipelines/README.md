# Data pipelines

Operational data pipelines live here. They transform versioned production
exports into derived datasets and reporting marts without reading from the
transactional database.

Current projects:

- `work-graph-analytics`: validates privacy-safe Work Graph captures and uses
  dbt with DuckDB to publish versioned Parquet facts and marts.
