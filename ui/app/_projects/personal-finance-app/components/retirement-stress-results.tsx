import type {
  Currency,
  RetirementProjectionRangeComparison,
} from "@/app/_projects/personal-finance-app/domain";
import { formatCurrency } from "@/app/_projects/personal-finance-app/lib";

type AssumptionComparison =
  RetirementProjectionRangeComparison["assumptionComparisons"][number];
type RangeOutcome = AssumptionComparison["outcomes"][number];
type PathComparison =
  RetirementProjectionRangeComparison["pathComparisons"][number];

const RANGE_HEADINGS = [
  "Assumption",
  "Horizon",
  "Liquid withdrawal capital",
  "Restricted pension capital",
  "Retained home equity",
  "Liabilities",
  "Total net worth",
  "Retirement income coverage",
  "Cash runway",
  "Accessible capital exhaustion",
  "Portfolio survival",
  "Withdrawal tax",
  "Withdrawal fees",
  "Unfunded spending",
] as const;

function percentage(value: number): string {
  return `${(value * 100).toFixed(0)}%`;
}

function exhaustion(date: string | null): string {
  return date ?? "Survives horizon";
}

function cashRunway(months: number | null): string {
  return months == null ? "Survives horizon" : `${months} months`;
}

function RangeRow({
  item,
  outcome,
  currency,
}: Readonly<{
  item: AssumptionComparison;
  outcome: RangeOutcome;
  currency: Currency;
}>) {
  return (
    <tr>
      <td className="p-3 font-medium">{item.assumption.name}</td>
      <td className="p-3">{outcome.horizonYears} years</td>
      <td className="p-3 font-mono">
        {formatCurrency(outcome.liquidWithdrawalCapital, currency)}
      </td>
      <td className="p-3 font-mono">
        {formatCurrency(outcome.restrictedPensionCapital, currency)}
      </td>
      <td className="p-3 font-mono">
        {formatCurrency(outcome.retainedHomeEquity, currency)}
      </td>
      <td className="p-3 font-mono">
        {formatCurrency(outcome.liabilities, currency)}
      </td>
      <td className="p-3 font-mono">
        {formatCurrency(outcome.totalNetWorth, currency)}
      </td>
      <td className="p-3 font-mono">
        {percentage(outcome.retirementIncomeCoverage)}
      </td>
      <td className="p-3">{cashRunway(outcome.cashRunwayMonths)}</td>
      <td className="p-3">
        {exhaustion(outcome.accessibleCapitalExhaustionDate)}
      </td>
      <td className="p-3">
        {outcome.portfolioSurvives ? "Funded" : "Unfunded"}
      </td>
      <td className="p-3 font-mono">
        {formatCurrency(outcome.cumulativeTax, currency)}
      </td>
      <td className="p-3 font-mono">
        {formatCurrency(outcome.cumulativeFees, currency)}
      </td>
      <td className="p-3 font-mono">
        {formatCurrency(outcome.cumulativeShortfall, currency)}
      </td>
    </tr>
  );
}

function RangeTable({
  comparison,
  currency,
}: Readonly<{
  comparison: RetirementProjectionRangeComparison;
  currency: Currency;
}>) {
  return (
    <section className="space-y-2">
      <div>
        <h3 className="font-semibold">Stress range outcomes</h3>
        <p className="text-sm text-muted-foreground">
          Each named set uses the planned retirement date and the same household
          balances.
        </p>
      </div>
      <div className="overflow-x-auto rounded-lg border">
        <table className="w-full min-w-[104rem] text-sm">
          <caption className="sr-only">
            Retirement stress outcomes at 10, 15, 20, and 30 years
          </caption>
          <thead className="bg-muted/50 text-left">
            <tr>
              {RANGE_HEADINGS.map((heading) => (
                <th className="p-3 font-medium" key={heading}>
                  {heading}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y">
            {comparison.assumptionComparisons.flatMap((item) =>
              item.outcomes.map((outcome) => (
                <RangeRow
                  key={`${item.assumption.id}-${outcome.horizonYears}`}
                  item={item}
                  outcome={outcome}
                  currency={currency}
                />
              )),
            )}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function EffectsRow({
  item,
  currency,
}: Readonly<{ item: AssumptionComparison; currency: Currency }>) {
  const effects = [
    ["early-market", item.effects.earlyMarketSequence],
    ["inflation", item.effects.inflation],
    ["spending", item.effects.spendingChange],
    ["income", item.effects.delayedIncome],
    ["tax", item.effects.withdrawalTax],
  ] as const;
  return (
    <tr>
      <td className="p-3 font-medium">{item.assumption.name}</td>
      {effects.map(([name, value]) => (
        <td className="p-3 font-mono" key={name}>
          {formatCurrency(value, currency)}
        </td>
      ))}
    </tr>
  );
}

function EffectsTable({
  comparison,
  currency,
}: Readonly<{
  comparison: RetirementProjectionRangeComparison;
  currency: Currency;
}>) {
  return (
    <section className="space-y-2">
      <div>
        <h3 className="font-semibold">20-year stress attribution</h3>
        <p className="text-sm text-muted-foreground">
          Negative values estimate each adverse effect on opening invested
          capital or household cash requirements. Tax is the modelled cash
          deduction from the full projection.
        </p>
      </div>
      <div className="overflow-x-auto rounded-lg border">
        <table className="w-full min-w-[48rem] text-sm">
          <caption className="sr-only">
            Retirement stress effects at 20 years
          </caption>
          <thead className="bg-muted/50 text-left">
            <tr>
              {[
                "Assumption",
                "Early market sequence",
                "Inflation",
                "Real spending change",
                "Delayed income",
                "Withdrawal tax",
              ].map((heading) => (
                <th className="p-3 font-medium" key={heading}>
                  {heading}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y">
            {comparison.assumptionComparisons.map((item) => (
              <EffectsRow
                key={item.assumption.id}
                item={item}
                currency={currency}
              />
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function PathRow({
  item,
  outcome,
  currency,
}: Readonly<{
  item: PathComparison;
  outcome: PathComparison["outcomes"][number];
  currency: Currency;
}>) {
  return (
    <tr>
      <td className="p-3 font-medium">{item.path.name}</td>
      <td className="p-3">{outcome.horizonYears} years</td>
      <td className="p-3">{item.path.retirementDate ?? "No stop date"}</td>
      <td className="p-3 font-mono">
        {formatCurrency(item.path.annualNetEmploymentIncome, currency)}
      </td>
      <td className="p-3 font-mono">
        {formatCurrency(outcome.liquidWithdrawalCapital, currency)}
      </td>
      <td className="p-3 font-mono">
        {percentage(outcome.retirementIncomeCoverage)}
      </td>
      <td className="p-3">{cashRunway(outcome.cashRunwayMonths)}</td>
      <td className="p-3">
        {outcome.portfolioSurvives ? "Funded" : "Unfunded"}
      </td>
    </tr>
  );
}

function PathTable({
  comparison,
  currency,
}: Readonly<{
  comparison: RetirementProjectionRangeComparison;
  currency: Currency;
}>) {
  return (
    <section className="space-y-2">
      <div>
        <h3 className="font-semibold">Retirement work choices</h3>
        <p className="text-sm text-muted-foreground">
          Stop work, stay in work, or reduce earned income under the central
          assumptions at each planning horizon.
        </p>
      </div>
      <div className="overflow-x-auto rounded-lg border">
        <table className="w-full min-w-[64rem] text-sm">
          <caption className="sr-only">
            Retirement work choices at 10, 15, and 20 years
          </caption>
          <thead className="bg-muted/50 text-left">
            <tr>
              {[
                "Choice",
                "Horizon",
                "Retirement date",
                "Ongoing net employment income",
                "Liquid withdrawal capital",
                "Retirement income coverage",
                "Cash runway",
                "Portfolio survival",
              ].map((heading) => (
                <th className="p-3 font-medium" key={heading}>
                  {heading}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y">
            {comparison.pathComparisons.flatMap((item) =>
              item.outcomes.map((outcome) => (
                <PathRow
                  key={`${item.path.id}-${outcome.horizonYears}`}
                  item={item}
                  outcome={outcome}
                  currency={currency}
                />
              )),
            )}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function Restrictions({ items }: Readonly<{ items: string[] }>) {
  if (items.length === 0) return null;
  return (
    <section className="rounded-lg border border-amber-500/40 bg-amber-500/5 p-4">
      <h3 className="font-semibold">Access timing and excluded capital</h3>
      <ul className="mt-2 list-disc space-y-1 pl-5 text-sm text-muted-foreground">
        {items.map((item) => (
          <li key={item}>{item}</li>
        ))}
      </ul>
    </section>
  );
}

export function RetirementStressResults({
  comparison,
  currency,
}: Readonly<{
  comparison: RetirementProjectionRangeComparison;
  currency: Currency;
}>) {
  return (
    <div className="space-y-6">
      <RangeTable comparison={comparison} currency={currency} />
      <EffectsTable comparison={comparison} currency={currency} />
      <PathTable comparison={comparison} currency={currency} />
      <Restrictions items={comparison.restrictions} />
    </div>
  );
}
