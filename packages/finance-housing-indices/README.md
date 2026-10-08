# UK housing-price data

This package imports versioned UK House Price Index releases from HM Land
Registry. It parses the official full CSV into monthly series by geography and
property type. It does not call a paid property-data service.

The importer hashes the exact CSV bytes and gives each release a checksum-based
version ID. `storeHousePriceIndexRelease` writes those bytes before normalized
observations. A store can map the raw object to private R2 and the release to
PostgreSQL, as described in the project's housing-data ADR. Repeating the same
checksum does nothing. If HM Land Registry revises values without changing the
release month, the new checksum creates another release and keeps the old one.

`compareHousePriceIndices` reads anchor and target values from one pinned
release. It requires an exact observation for both months. This matters for
Northern Ireland, where quarterly observations leave expected gaps. The code
does not fill those gaps or swap in another geography or property type.

`estimatePropertyValueHistory` rebases a recorded purchase price or valuation
with `anchorValue * (targetIndexLevel / anchorIndexLevel)`. Callers provide an
ordered series hierarchy, such as local detached, local all-property, regional
detached, then regional all-property. The result identifies the selected
fallback and records the anchor, formula, index levels, release version, and
checksum. Once selected, the series does not change between months. A missing
month produces an unavailable point.

Recorded valuations and index estimates use different types and arrays. An
estimate on the same date as a surveyor valuation does not replace the recorded
valuation. A later feature can choose which one to display without losing the
underlying fact.

The current source registry points at HM Land Registry's versioned July 2026
full CSV and its GOV.UK data page. Update both URLs and the publication metadata
together for each import. Keep upstream CSV files in object storage. Git
contains only the small fixtures in this package.

## Completed-sale comparables

`parsePricePaidCsv` imports HM Land Registry Price Paid Data bulk CSVs for
England and Wales. The importer keeps the exact source checksum, retrieval
time, observed period, and most recent complete month. Raw files belong in R2;
normalized transactions belong in PostgreSQL. The application does not call a
paid API or scrape a property portal.

`findComparableSales` matches the target property's exact postcode district,
an inclusive completion-date range, selected property types, tenure, and the
new-build filter. It sorts matching transactions by completion date and then
transaction ID, so a saved query returns the same order against its pinned
release. The result includes the search area and every filter.

Price Paid Data registration trails completion. The result states that recent
months are incomplete and identifies the latest month treated as complete.
Scotland and Northern Ireland return an unsupported-region result because this
source does not cover them. The matcher does not substitute aggregate regional
statistics for individual transactions.

`findNorthernIrelandMarketTrend` can accompany that Northern Ireland result
with the latest quarterly NI House Price Index evidence from the pinned UK HPI
release. It selects the first configured geography and property-type series
with an official quarter-end observation, reports the average price and annual
index change, and labels the period of any older sales-volume figure. The result
states that area statistics do not identify individual properties or replace
comparable sales.

Run the checks with:

```sh
mise run //packages/finance-housing-indices:check
```

## Licence

UK HPI and Price Paid Data are Crown copyright and database right material
licensed under the Open Government Licence v3.0. Keep the attribution stored on
each release when displaying or redistributing the data.
[DATA-LICENCE.md](DATA-LICENCE.md) has the full notice used by this package.
