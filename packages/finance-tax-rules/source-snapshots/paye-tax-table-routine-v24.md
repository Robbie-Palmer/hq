# HMRC PAYE tax table routine v24.0 extract

- Source: <https://www.gov.uk/government/publications/payroll-technical-specifications-income-tax>
- Publisher: HM Revenue & Customs
- Version: 24.0, February 2026
- Retrieved: 2026-10-02

The routine distinguishes normal cumulative operation from Week 1 or Month 1
operation. Cumulative calculations carry taxable pay and tax paid to date into the
current period. Non-cumulative calculations treat each payment in isolation.

For suffix tax codes, the numeric code determines free pay. The routine calculates
the Week 1 or Month 1 free-pay amount, rounding up to the next penny where needed.
It multiplies that amount by the period number for cumulative calculations.

Before applying the tax formula, the routine rounds taxable pay down to the whole
pound. It carries the tax formula to four decimal places of a pound without
correcting the last place, then rounds the result down to the penny. BR charges all
rounded taxable pay at the basic rate. The same rounding stages apply when BR is
used cumulatively or on a Week 1 or Month 1 basis.

The specification says a mid-year taxpayer-status change keeps cumulative taxable
pay and tax paid to date. A non-cumulative code continues to work period by period
until HMRC issues another code.
