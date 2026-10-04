import type {
  MortgageInvestmentComparison,
  MortgageInvestmentOutcome,
} from "@/lib/domain/assettracker";

export type MortgageInvestmentFormatters = {
  money: (value: number) => string;
  percent: (value: number) => string;
  fiDate: (value: string | null) => string;
};

function ResultRow({
  outcome,
  money,
  fiDate,
}: Readonly<{
  outcome: MortgageInvestmentOutcome;
  money: MortgageInvestmentFormatters["money"];
  fiDate: MortgageInvestmentFormatters["fiDate"];
}>) {
  return (
    <tr className="border-t">
      <th
        scope="row"
        className="whitespace-nowrap px-3 py-3 text-left font-medium"
      >
        {outcome.label}
      </th>
      <td className="px-3 py-3 text-right font-medium">
        {money(outcome.netWorth)}
      </td>
      <td className="px-3 py-3 text-right">{money(outcome.liquidAssets)}</td>
      <td className="px-3 py-3 text-right">{money(outcome.mortgageBalance)}</td>
      <td className="px-3 py-3 text-right">{money(outcome.interestPaid)}</td>
      <td className="whitespace-nowrap px-3 py-3">
        {fiDate(outcome.projectedFiDate)}
      </td>
    </tr>
  );
}

export function MortgageInvestmentHighlights({
  comparison,
  horizonLabel,
  money,
  percent,
}: Readonly<{
  comparison: MortgageInvestmentComparison;
  horizonLabel: string;
  money: MortgageInvestmentFormatters["money"];
  percent: MortgageInvestmentFormatters["percent"];
}>) {
  const advantage = comparison.invest.netWorth - comparison.overpay.netWorth;
  const stressedAdvantage =
    comparison.invest.stressedNetWorth - comparison.overpay.stressedNetWorth;
  const winner = advantage >= 0 ? comparison.invest : comparison.overpay;
  const stressedWinner =
    stressedAdvantage >= 0 ? comparison.invest : comparison.overpay;
  return (
    <div className="grid gap-3 sm:grid-cols-3">
      <div className="rounded-md border p-3">
        <p className="text-xs text-muted-foreground">At {horizonLabel}</p>
        <p className="mt-1 font-semibold">{money(Math.abs(advantage))}</p>
        <p className="mt-1 text-xs text-muted-foreground">
          {winner.label} leads
        </p>
      </div>
      <div className="rounded-md border p-3">
        <p className="text-xs text-muted-foreground">Break-even return</p>
        <p className="mt-1 font-semibold">
          {comparison.breakEvenInvestmentReturn == null
            ? "Outside model range"
            : percent(comparison.breakEvenInvestmentReturn)}
        </p>
      </div>
      <div className="rounded-md border p-3">
        <p className="text-xs text-muted-foreground">Stress case</p>
        <p className="mt-1 font-semibold">
          {money(Math.abs(stressedAdvantage))}
        </p>
        <p className="mt-1 text-xs text-muted-foreground">
          {stressedWinner.label} leads
        </p>
      </div>
    </div>
  );
}

export function MortgageInvestmentSummary({
  comparison,
  money,
  fiDate,
}: Readonly<{
  comparison: MortgageInvestmentComparison;
  money: MortgageInvestmentFormatters["money"];
  fiDate: MortgageInvestmentFormatters["fiDate"];
}>) {
  return (
    <div className="overflow-x-auto rounded-md border">
      <table
        className="w-full min-w-[760px] text-sm"
        aria-label="Mortgage strategy summary"
      >
        <thead className="bg-muted/50 text-left text-xs text-muted-foreground">
          <tr>
            <th className="px-3 py-2 font-medium">Strategy</th>
            <th className="px-3 py-2 text-right font-medium">Net worth</th>
            <th className="px-3 py-2 text-right font-medium">Liquid assets</th>
            <th className="px-3 py-2 text-right font-medium">Mortgage</th>
            <th className="px-3 py-2 text-right font-medium">Interest</th>
            <th className="px-3 py-2 font-medium">Projected FI</th>
          </tr>
        </thead>
        <tbody>
          <ResultRow
            outcome={comparison.overpay}
            money={money}
            fiDate={fiDate}
          />
          <ResultRow
            outcome={comparison.invest}
            money={money}
            fiDate={fiDate}
          />
        </tbody>
      </table>
    </div>
  );
}
