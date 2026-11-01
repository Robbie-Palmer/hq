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

function percentage(value: number): string {
  return `${(value * 100).toFixed(0)}%`;
}

function exhaustion(date: string | null): string {
  return date ?? "Survives horizon";
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
        {formatCurrency(outcome.accessibleCapital, currency)}
      </td>
      <td className="p-3 font-mono">
        {formatCurrency(outcome.totalNetWorth, currency)}
      </td>
      <td className="p-3 font-mono">{percentage(outcome.incomeCoverage)}</td>
      <td className="p-3">
        {exhaustion(outcome.accessibleCapitalExhaustionDate)}
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
        <table className="w-full min-w-[56rem] text-sm">
          <caption className="sr-only">
            Retirement stress outcomes at 10, 15, 20, and 30 years
          </caption>
          <thead className="bg-muted/50 text-left">
            <tr>
              {[
                "Assumption",
                "Horizon",
                "Accessible capital",
                "Total net worth",
                "Income coverage",
                "Capital exhaustion",
                "Unfunded spending",
              ].map((heading) => (
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
  currency,
}: Readonly<{ item: PathComparison; currency: Currency }>) {
  return (
    <tr>
      <td className="p-3 font-medium">{item.path.name}</td>
      <td className="p-3">{item.path.retirementDate}</td>
      <td className="p-3 font-mono">
        {formatCurrency(item.path.annualNetEmploymentIncome, currency)}
      </td>
      <td className="p-3 font-mono">
        {formatCurrency(item.outcome.totalNetWorth, currency)}
      </td>
      <td className="p-3 font-mono">
        {percentage(item.outcome.incomeCoverage)}
      </td>
      <td className="p-3">
        {exhaustion(item.outcome.accessibleCapitalExhaustionDate)}
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
        <h3 className="font-semibold">20-year retirement choices</h3>
        <p className="text-sm text-muted-foreground">
          The central assumptions hold household balances and spending fixed.
        </p>
      </div>
      <div className="overflow-x-auto rounded-lg border">
        <table className="w-full min-w-[44rem] text-sm">
          <caption className="sr-only">
            Retirement timing and replacement income comparison
          </caption>
          <thead className="bg-muted/50 text-left">
            <tr>
              {[
                "Choice",
                "Retirement date",
                "Net employment income",
                "Total net worth",
                "Income coverage",
                "Capital exhaustion",
              ].map((heading) => (
                <th className="p-3 font-medium" key={heading}>
                  {heading}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y">
            {comparison.pathComparisons.map((item) => (
              <PathRow key={item.path.id} item={item} currency={currency} />
            ))}
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
      <h3 className="font-semibold">Model limits and restricted capital</h3>
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
