# EGA matched FFPE and frozen single-cell source product

This DVC product pins public metadata for controlled EGA dataset
`EGAD00001015781` and publisher evidence from DOI
`10.3389/fgene.2026.1755978`. It does not contain sequence payloads or
credentials.

The product keeps four publisher views separate:

- The EGA dataset page displays four samples.
- The public metadata API returns 24 sample records. Their publisher names form
  12 FFPE and fresh-frozen or OCT pairs across seven patient labels.
- The paper reports 12 matched tissue pairs from seven POG patients.
- EGA lists 241 controlled files totalling 965,526,724,986 bytes, displayed as
  965.8 GB on the portal.

Those counts describe different projections. The inventory retains all of them.
It does not map paper POG labels to EGA patient labels. It also does not assign
the 241 files to samples because EGA restricts the sample-to-file mapping to
approved accessors.

## Access and rights

The checked-in fixtures contain public EGA metadata, including file accessions,
sizes, locations, and unencrypted MD5 values. Sequence payloads remain
controlled by `EGAC00000000011` under policy `EGAP00001000045`. The policy has
DUO time-limit and project-specific restrictions and requires an executed Data
Access Agreement before an EGA request. EGA declares no public redistribution
license for the payload. The paper is CC BY 4.0, which does not change the data
rights.

## Checks

Run the default credential-free checks and DVC build:

```bash
mise //data-products/ega/matched-ffpe-frozen-single-cell:check
```

The default path reads checked-in metadata only. It never requests EGA access
or downloads a controlled file.

An explicit drift task compares the fixtures with the same public API endpoints.
It sends no authorization header and allows redirects only within the fixed
`https://metadata.ega-archive.org` origin:

```bash
mise //data-products/ega/matched-ffpe-frozen-single-cell:drift:public
```

Drift is reported for review. The task does not overwrite fixtures.

## Evidence boundary

The source contract records the paper's preparation, single-cell expression,
cell recovery, heterogeneity, and inferred-CNA results. It also records the
study's limits: paired segments contain different cells, Flex uses a restricted
probe set, and the cohort is small and heterogeneous. This source has no public
whole-slide image, stain, scanner, operating-cost, or diagnostic-confidence
evidence.
