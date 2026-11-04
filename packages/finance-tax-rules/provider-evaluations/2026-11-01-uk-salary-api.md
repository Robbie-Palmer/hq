# UK salary API provider evaluation

Evaluated on 1 November 2026 with synthetic values only.

## Decision

TaxScope is approved for a narrow validation-only role. Server-side checks may
send synthetic, annual, pension-free cases for tax years that TaxScope currently
seeds. The adapter is not part of salary history or production calculations.

TaxScope is rejected for production calculations, historical replay, pension
comparisons, and exact payroll reconciliation. Its own documentation says the
API has no SLA, no guaranteed uptime, and no breaking-change notice. Responses
do not identify an API version, calculation version, or immutable rule version.

The Finance Toolkit is rejected. Its developer page advertises a RapidAPI
product, but the site terms prohibit automation and commercial use without
written consent. The RapidAPI listing has no provider-specific terms of service.
The site does not identify a legal owner, and its privacy policy does not explain
retention or telemetry for requests routed through RapidAPI. API version 1.1.0
does not identify the calculation or rule dataset used for a result.

The checked-in `finance-tax-rules` data and local calculation remain the source
for reproducible salary history. A provider failure never invokes another tax
rule set as a fallback.

## Sources checked

Provider sources:

- [TaxScope API documentation](https://taxscope.uk/api-docs/)
- [TaxScope terms](https://taxscope.uk/terms/)
- [TaxScope privacy policy](https://taxscope.uk/privacy/)
- [TaxScope help](https://taxscope.uk/help/)
- [TaxScope current rate inventory](https://taxscope.uk/api/tax-rates/)
- [Loglux Ltd company record](https://find-and-update.company-information.service.gov.uk/company/NI739810)
- [The Finance Toolkit developer page](https://www.thefinancetoolkit.co.uk/developers)
- [The Finance Toolkit privacy policy](https://www.thefinancetoolkit.co.uk/privacy-policy)
- [The Finance Toolkit terms](https://www.thefinancetoolkit.co.uk/terms-of-service)
- [The Finance Toolkit RapidAPI listing](https://rapidapi.com/the-finance-toolkit-the-finance-toolkit-default/api/uk-salary-tax-api-paye-ni-student-loans-comparison)

Authoritative comparison sources:

- [HMRC PAYE tax table routines version 24.0](https://www.gov.uk/government/publications/payroll-technical-specifications-income-tax)
- [Employer rates and thresholds for 2026 to 2027](https://www.gov.uk/guidance/rates-and-thresholds-for-employers-2026-to-2027)
- [Historical National Insurance rates](https://www.gov.uk/government/publications/rates-and-allowances-national-insurance-contributions/rates-and-allowances-national-insurance-contributions)
- [HMRC salary sacrifice guidance](https://www.gov.uk/guidance/salary-sacrifice-and-the-effects-on-paye)
- [GOV.UK net pay and relief at source guidance](https://www.gov.uk/workplace-pensions/managing-your-pension)

The local expected values come from `validationCorpus` version `2026.10.4`.
That corpus links each case to a checked-in extract of the relevant government
source.

## Provider findings

### TaxScope

| Question | Finding |
| --- | --- |
| Owner | Loglux Ltd, company NI739810. Companies House recorded it as active on the evaluation date. |
| Authentication | None for the public API. |
| Cost | Free public tier. A future authenticated paid tier is mentioned, but no price is published. |
| Limits | 60 requests per minute per IP. Clients must respect `Retry-After` after HTTP 429. |
| Availability | Best effort. The provider explicitly says the API is not for production and may change without notice. |
| Years | The live rate inventory contained start years 2024, 2025, and 2026. A request for 2023 returned HTTP 404. |
| Jurisdictions | Rest of UK, Scotland, and Welsh tax codes are documented. Scottish selection is also exposed as a flag. |
| Pension inputs | `none`, relief at source, net pay, or salary sacrifice plus one percentage. The live result applied the percentage to qualifying earnings. The API has no explicit contribution basis or fixed contribution input. |
| NI and payroll inputs | Annual, monthly, or weekly basis. The public request has no pay date, period number, prior taxable pay, prior tax, or NI category. |
| Version selection | A tax-year start year can be selected. Responses do not identify the API, engine, calculation, or rule version. |
| Licence and terms | API use is allowed under the site terms with attribution and output disclaimers. The terms describe the source as AGPL-3.0, but the linked GitHub licence path returned HTTP 404 on the evaluation date. |
| Data and retention | The service logs API inputs, including amount, tax year, region, pension choice, and tax code, in `UsageEvent` rows for 90 days. Plain IP addresses appear in those rows and server logs. Server logs are retained for 30 days. |
| Telemetry | Each API call records path, method, status, IP hash, plain IP by default, user agent, and calculator inputs. |

The documented retention is unacceptable for real salary records. The chosen
adapter requires the literal data classification `synthetic` and rejects any
pension object. It lives at the provider-specific package subpath
`finance-tax-rules/providers/taxscope-validation` so ordinary salary code does
not import it accidentally.

### The Finance Toolkit

| Question | Finding |
| --- | --- |
| Owner | The site and RapidAPI account use the name "The Finance Toolkit" but do not identify a legal entity or registration number. |
| Authentication | RapidAPI key and host headers. The website uses an unauthenticated same-origin demo endpoint, but its terms prohibit automated access. |
| Cost and quotas | RapidAPI metadata listed a free hard limit of 100 requests per day. Paid plans were $9.99 for 10,000 requests with $0.005 overage, $29.99 for 50,000 with $0.003 overage, and $79.99 for 200,000 with $0.001 overage. No provider rate limiter was enabled in the listing metadata. |
| Availability | No provider SLA was published. The request passes through RapidAPI and the observed service used AWS API Gateway and CloudFront. |
| Years | The developer schema listed 2024/25, 2025/26, 2026/27, and 2029/30. A 2023/24 request failed. |
| Jurisdictions | England and Northern Ireland plus an explicit Scotland flag. Separate Welsh rule identity was not documented. |
| Pension inputs | Fixed or percentage employee deductions for salary sacrifice, net pay, and relief at source. Employer contribution fields are also present. The response does not expose provider relief separately. |
| NI and payroll inputs | Annual salary, hourly rate, or daily rate. The response derives monthly and weekly figures. There is no pay date, NI category, period number, or prior payroll state. |
| Version selection | RapidAPI showed API version 1.1.0. The request selects a financial period, but the result has no calculation or immutable rule version. |
| Licence and terms | The site terms limit the service to personal, non-commercial use and prohibit bots, scripts, external APIs, and automation. The RapidAPI listing had `termsOfService: null`. The developer page and site terms therefore conflict. |
| Data and retention | The site policy says calculator parameters are not stored after calculation. It does not cover RapidAPI request retention, provider logs, marketplace telemetry, or a data-processing agreement. |
| Telemetry | The site uses Google Analytics and AdSense. RapidAPI adds its own service metadata and logs, which the provider policy does not describe. |

The same-origin demo results below confirm calculation behavior only. They do
not make that endpoint an approved integration route.

## Synthetic results

All monetary values are pence. A difference is provider output minus the
authoritative fixture.

| Case | Authoritative fixture | TaxScope live result | Finance Toolkit live result |
| --- | --- | --- | --- |
| Salary sacrifice, £60,000 salary and £6,000 exchange | tax 903,200; NI 309,000; pension 600,000; take-home 4,187,800 | Unsupported input semantics. Ten percent produced a 440,300 contribution because the provider used qualifying earnings. | tax 903,200; NI 309,060, difference +60; pension 600,000; take-home 4,187,740, difference -60. |
| Net pay, £60,000 salary and £6,000 contribution | tax 903,200; NI 321,000; member deduction 600,000; take-home 4,175,800 | Unsupported input semantics. The API cannot name gross pay as the contribution basis or send the fixed amount. | tax 903,200; NI 321,060, difference +60; member deduction 600,000; take-home 4,175,740, difference -60. |
| Relief at source, £4,800 paid and £1,200 provider relief | tax 1,023,200; NI 321,000; member deduction 480,000; provider relief 120,000; take-home 4,175,800 | Unsupported. The request cannot separate member payment from provider relief and the result does not return provider relief. | tax 1,143,200, difference +120,000; NI 321,060, difference +60; member deduction 600,000, difference +120,000; no provider-relief output; take-home 4,055,740, difference -120,060. The API models payroll cash, not the fixture's annual higher-rate relief. |
| Personal Allowance taper at £110,000 | tax 3,343,200; NI 421,000; take-home 7,235,800 | tax 3,343,200; NI 421,060, difference +60; take-home 7,235,740, difference -60. | Same values and differences as TaxScope. |
| Scottish bands at £50,000 | tax 901,380; NI 299,392; take-home 3,799,228 | tax 901,380; NI 299,440, difference +48; take-home 3,799,180, difference -48. | Same values and differences as TaxScope. |
| Monthly BR pay of £3,000 in 2026/27 | tax 60,000; NI 15,616; take-home 224,384 for the period | The period values matched, but the response labelled itself `approximate` and supplied no period state. | tax 60,000; NI 15,620, difference +4; take-home 224,380, difference -4. The API divided an annual calculation rather than reproducing the exact payroll fixture. |
| Weekly BR pay of £500 in 2026/27 | tax 10,000; NI 2,064; take-home 37,936 for the period | The period values matched, but the response labelled itself `approximate`. Its precision note also referred to a monthly default profile despite the weekly request. | tax 10,000; NI 2,066, difference +2; take-home 37,934, difference -2. |
| NI change inside 2023/24 | December NI 23,424 at 12%; January NI 19,520 at 10% | Unsupported. The current service returned HTTP 404 for start year 2023 and has no effective-date input. | Unsupported. The current service failed a 2023/24 request and has no effective-date input. |

The small annual NI differences come from calculation-period and rounding
choices. They show a measurable disagreement. Neither result establishes an
error by itself. The provider documentation does not expose enough lineage to
reproduce the choice after a rule or deployment change.

## Adapter boundary

`TaxScopeValidationAdapter` has these fixed behaviors:

- It accepts only synthetic, annual-liability, category A, non-director,
  pension-free requests.
- It runs server-side against the canonical HTTPS endpoint with a 3-second
  timeout per attempt.
- It makes at most two attempts. It retries timeouts, network failures, HTTP
  429, and HTTP 502, 503, or 504. `Retry-After` is capped at 1 second.
- It does not retry validation failures, missing tax years, other 4xx responses,
  or invalid response contracts.
- It returns a typed failure. It never calls the internal calculator and never
  returns a result from a different provider.
- It does not cache. A successful result includes the adapter version, pinned
  contract snapshot, evaluation time, response date, and SHA-256 digest of the
  raw response so a caller can preserve exact lineage with a stored result.
- It records `providerApiVersion` and `providerRuleVersion` as null. The adapter
  does not invent version identifiers the provider did not return.

## Reconsideration conditions

Do not broaden TaxScope use unless the provider offers an authenticated contract
with an SLA, immutable calculation and rule versions, a no-retention option, and
inputs that preserve pension basis and payroll state.

Reconsider The Finance Toolkit only after the provider identifies the legal
operator, publishes API-specific terms and data handling, resolves the site
automation conflict, and returns calculation and rule lineage. Any new review
must rerun the synthetic corpus. Documentation claims alone do not establish
correctness.
