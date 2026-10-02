# UK inflation index data

This package contains reviewed, versioned Office for National Statistics index
levels for historical salary comparisons. It keeps the data, ingestion code,
selection rules, and purchasing-power calculation independent of the UI.

## Coverage

| Index | ONS series | Role | Coverage |
| --- | --- | --- | --- |
| CPIH | L522 | Primary measure | January 1988 onward |
| CPI | D7BT | Alternative excluding owner occupiers' housing costs | January 1988 onward |
| RPI | CHAW | Optional legacy measure | January 1987 onward |

All three series are monthly UK index levels from the ONS MM23 dataset. CPI and
CPIH use a 2015=100 base. RPI uses January 1987=100. Calculations use an index
ratio, so a later rebasing does not change the result when both periods use the
same release.

The package never substitutes one index for another. It returns an unavailable
result for a missing observation, a date before coverage, a period that the ONS
has not published, or a currency other than GBP. RPI remains available for
explicit historical use, but the API and UI identify it as a legacy measure.

## Artifacts and provenance

`artifacts/releases/` stores append-only dataset versions. Each ONS release has
its dataset and series IDs, frequency, base definition, geography, coverage,
source URL, release date, retrieval timestamp, and SHA-256 digest of the source
response. `artifacts/manifest.json` records hashes for the current release and
coverage matrix, along with the source response hashes.

The source registry is in `src/ons.ts`. It records the documented ONS API status
and the time-series CSV fallback. The CPIH filtered-observations API stopped
receiving releases after January 2026, so the registry marks it retired and uses
the ONS time-series CSV. The update request contains only public series
identifiers. Salary or household values are never sent to the ONS.

Run the package checks with:

```sh
mise run //packages/finance-inflation-indices:check
```

## Updating and correcting data

Run:

```sh
mise run //packages/finance-inflation-indices:update
```

The updater retries transient failures, fetches the registered sources, and
does nothing when their checksums are already present. A changed ONS response is
appended as a new pinned release; previous releases and dataset artifacts remain
available. The updater creates the next CalVer dataset artifact and refreshes
the manifest and coverage matrix.

Do not edit a released artifact in place. For a correction, create a new dataset
version, set `supersedes`, and describe each corrected release in `corrections`.

## Calculation semantics

`adjustForInflation` expresses a source amount in reference-period pounds using
`reference index level / source index level`. A monthly release maps a date to
its calendar month. The schema also supports annual releases, which map a date
to its calendar year. Missing and future periods fail instead of carrying the
last value forward.

Callers can select an exact ONS release with `selectInflationDataset`. Saved
comparisons should retain the returned release version so the same inputs can be
reproduced after an ONS revision.

Import calculations and schemas from `finance-inflation-indices`. Import the
reviewed current dataset from `finance-inflation-indices/dataset`; keeping that
entry point separate avoids adding the full observation archive to clients that
only need the calculation types.

## Licence

ONS source material and the derived index values require attribution under the
Open Government Licence. [DATA-LICENCE.md](DATA-LICENCE.md) records the notice
for redistribution. The TypeScript code and tests remain under the repository's
software licence.
