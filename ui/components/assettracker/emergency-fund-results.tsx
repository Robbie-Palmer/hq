import { formatCurrency } from "@/lib/assettracker";
import type {
  Currency,
  EmergencyFundAnalysis,
  EmergencyFundStressResult,
} from "@/lib/domain/assettracker";

function stressDescription(
  result: EmergencyFundStressResult | undefined,
  currency: Currency,
) {
  if (result == null) return "No stress result";
  if (result.firstShortfallMonth == null) {
    return `No uncovered shortfall over ${result.path.length} months; ${formatCurrency(Math.round(result.endingReserve), currency)} remains`;
  }
  const duration =
    result.shortfallMonths === 1
      ? "1 month"
      : `${result.shortfallMonths} months`;
  return `Shortfall starts in month ${result.firstShortfallMonth}; ${formatCurrency(Math.round(result.totalShortfall), currency)} uncovered across ${duration}, up to ${formatCurrency(Math.round(result.maximumMonthlyShortfall), currency)} in one month`;
}

function PolicyPosition({
  baseCurrency,
  policy,
}: Readonly<{
  baseCurrency: Currency;
  policy: EmergencyFundAnalysis["policyTargets"][number];
}>) {
  if (policy.fundingGap > 0) {
    return (
      <span className="text-amber-700 dark:text-amber-300">
        {formatCurrency(Math.round(policy.fundingGap), baseCurrency)} short
      </span>
    );
  }
  if (policy.availableAboveTarget > 0) {
    return (
      <span className="text-emerald-700 dark:text-emerald-300">
        {formatCurrency(Math.round(policy.availableAboveTarget), baseCurrency)}{" "}
        above target
      </span>
    );
  }
  return <span>On target</span>;
}

function ResultsSummary({
  analysis,
  currency,
}: Readonly<{
  analysis: EmergencyFundAnalysis;
  currency: Currency;
}>) {
  const coverage = analysis.accessibleCoverageMonths;
  return (
    <div className="grid gap-3 sm:grid-cols-3">
      <div>
        <p className="text-xs text-muted-foreground">Accessible now</p>
        <p className="text-lg font-semibold">
          {formatCurrency(Math.round(analysis.accessibleFunds), currency)}
        </p>
      </div>
      <div>
        <p className="text-xs text-muted-foreground">Reserve spending need</p>
        <p className="text-lg font-semibold">
          {formatCurrency(Math.round(analysis.monthlyEssentialNeed), currency)}
          /month
        </p>
      </div>
      <div>
        <p className="text-xs text-muted-foreground">Current coverage</p>
        <p className="text-lg font-semibold">
          {coverage == null
            ? "No spend basis"
            : `${coverage.toFixed(1)} months`}
        </p>
      </div>
    </div>
  );
}

function CurrentResultRow({
  result,
  currency,
}: Readonly<{
  result: EmergencyFundStressResult;
  currency: Currency;
}>) {
  return (
    <tr className="border-t">
      <td className="px-3 py-2 font-medium">Current accessible funds</td>
      <td className="px-3 py-2 text-right font-mono tabular-nums">
        {formatCurrency(Math.round(result.startingReserve), currency)}
      </td>
      <td className="px-3 py-2 text-right text-muted-foreground">
        Observed position
      </td>
      <td className="px-3 py-2">{stressDescription(result, currency)}</td>
    </tr>
  );
}

function PolicyResultRow({
  analysis,
  currency,
  policy,
}: Readonly<{
  analysis: EmergencyFundAnalysis;
  currency: Currency;
  policy: EmergencyFundAnalysis["policyTargets"][number];
}>) {
  const result = analysis.policyResults.find(
    ({ policyMonths }) => policyMonths === policy.months,
  );
  return (
    <tr className="border-t">
      <td className="px-3 py-2 font-medium">{policy.months} months</td>
      <td className="px-3 py-2 text-right font-mono tabular-nums">
        {formatCurrency(Math.round(policy.target), currency)}
      </td>
      <td className="px-3 py-2 text-right">
        <PolicyPosition baseCurrency={currency} policy={policy} />
      </td>
      <td className="px-3 py-2">{stressDescription(result, currency)}</td>
    </tr>
  );
}

function ResultsTable({
  analysis,
  currency,
}: Readonly<{
  analysis: EmergencyFundAnalysis;
  currency: Currency;
}>) {
  return (
    <div className="overflow-x-auto rounded-md border">
      <table className="w-full min-w-[720px] text-sm">
        <thead className="bg-muted/50 text-left text-xs text-muted-foreground">
          <tr>
            <th className="px-3 py-2">Policy</th>
            <th className="px-3 py-2 text-right">Target</th>
            <th className="px-3 py-2 text-right">Current position</th>
            <th className="px-3 py-2">Stress result</th>
          </tr>
        </thead>
        <tbody>
          {analysis.currentResults.map((result) => (
            <CurrentResultRow
              key={`current-${result.scenarioId}`}
              result={result}
              currency={currency}
            />
          ))}
          {analysis.policyTargets.map((policy) => (
            <PolicyResultRow
              key={policy.months}
              analysis={analysis}
              currency={currency}
              policy={policy}
            />
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function EmergencyFundResults({
  analysis,
  baseCurrency,
}: Readonly<{
  analysis: EmergencyFundAnalysis;
  baseCurrency: Currency;
}>) {
  return (
    <div className="space-y-4 border-t pt-5">
      <ResultsSummary analysis={analysis} currency={baseCurrency} />
      <ResultsTable analysis={analysis} currency={baseCurrency} />
      <p className="text-xs text-muted-foreground">
        Money above a selected policy is available for another use. It can be
        spent now, invested for the future, or kept as extra margin. This view
        reports the trade-off; it does not choose for the household.
      </p>
      {analysis.selectedDecisionCosts > 0 && (
        <p className="text-xs text-muted-foreground">
          The stress path includes{" "}
          {formatCurrency(
            Math.round(analysis.selectedDecisionCosts),
            baseCurrency,
          )}{" "}
          of selected decision costs already present in the household forecast.
        </p>
      )}
    </div>
  );
}
