# UK employment tax rule data

This package contains reviewed, versioned UK tax and pension rule data. Its first
dataset covers employment income, employee Class 1 National Insurance, and pension
rules for historical salary estimates. Future datasets can add Capital Gains Tax,
Inheritance Tax, and other personal-finance rules without moving the existing data.

## Coverage

| Area | Supported |
| --- | --- |
| Tax years | 2022/23 through 2026/27 |
| Jurisdictions | England and Northern Ireland, Scotland, Wales |
| Income Tax | Annual liability on employment non-savings, non-dividend income; standard Personal Allowance and taper |
| National Insurance | Employee Class 1 category A; weekly and monthly pay periods; non-directors |
| Pensions | Salary sacrifice, net pay, relief at source; relief limit, annual allowance, taper, and MPAA |

## Salary validation corpus

`validationCorpus` is a synthetic, source-linked set of annual and payroll cases.
It covers tax-band boundaries, the Personal Allowance taper, Scottish rates,
pension contribution methods, bonuses, job changes, partial years, NI changes,
pay frequency, PAYE basis, tax codes, and HMRC rounding. No fixture contains a
real person's pay or tax record.

Each supported fixture declares one of two precision levels:

- `annual-liability-estimate` compares annual Income Tax and an NI estimate based
  on twelve monthly threshold periods. It is not payslip reconciliation.
- `exact-payroll-deduction` carries the pay period, tax code, cumulative state,
  NI category, and HMRC rounding contract needed for a payroll comparison.

`evaluateValidationFixture` compares every calculation component separately. It
also rejects a candidate built from a different library, rule dataset, or
calculation contract version. Unsupported inputs have explicit reasons, so a
library cannot silently substitute category A NI or discard missing prior payroll
state.

The build writes the corpus to `artifacts/validation/` and records its version,
fixture count, and source-snapshot digests in the artifact manifest.

England and Northern Ireland share one Income Tax rule because the same UK schedule
governs both. Wales has a separate rule identity because the Senedd sets Welsh rates.
Those rates produce the same overall 20%, 40%, and 45% rates in every supported year.
Scotland has different rates and bands for employment income.

The package does not approximate missing data. `resolveRules` returns an unavailable
result for dates outside the supported range, NI categories other than A, annual or
irregular NI pay periods, and unknown jurisdictions. The NI rules apply only to
employees who are not directors; callers must exclude directors. The package also
does not model PAYE tax codes or withholding, multiple employments, savings,
dividends, Marriage Allowance, or Blind Person's Allowance. Those cases need more
facts and rules than this dataset contains.

The 2022/23 NI data has separate intervals for the July threshold change and the
November rate reversal. The 2023/24 data has a separate interval for the January
2024 employee rate cut.

## Building artifacts

Run:

```sh
mise run //packages/finance-tax-rules:build
mise run //packages/finance-tax-rules:check
```

The build validates the schema, source references, full tax-year coverage, and NI
interval continuity. It then writes content-addressed, deterministic artifacts in
`artifacts/`. Runtime selection only uses enacted rules. The build creates an
announced artifact only when the dataset contains announced rules, so an empty file
does not imply that the package tracks a future rule.

Each source record includes the SHA-256 digest of the retrieved official page.
Artifacts also include the digest of each checked-in extract, and the manifest
records every generated artifact digest. A saved calculation can record the
dataset version and verify the exact inputs later.

## Updating and correcting data

The finance data owner reviews HMRC changes after each Budget, fiscal statement,
and annual employer-rates publication. Add a new source extract, record its
publication and retrieval dates, add rules with explicit effective dates, then run
the package check.

Do not change a released artifact in place. Increase `datasetVersion`, set
`supersedes`, describe corrected rule IDs in `corrections`, and keep the old
versioned artifacts. Announced rules belong in the announced artifact until the
relevant legislation is enacted and reviewed.

## Sources and licence

The detailed source records live in `src/data.ts`; the reviewed extracts live in
`source-snapshots/`. Historical payroll semantics come from HMRC's year-specific
employer publications, not just statistical summary tables. The 2022/23 record
also links to the UK Government Web Archive index.

HMRC source material and the derived rule values require attribution under the Open
Government Licence. [DATA-LICENCE.md](DATA-LICENCE.md) records the required notice
and explains which parts remain under the repository's software licence.
