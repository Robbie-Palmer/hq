import { formatCurrency } from "@/lib/assettracker";
import type {
  Currency,
  EmergencyFundAnalysis,
  EmergencyFundPlanInput,
  EmergencyFundStressResult,
} from "@/lib/domain/assettracker";

function percentage(value: number): string {
  return `${(value * 100).toFixed(0)}%`;
}

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

export function EmergencyFundResults({
  analysis,
  baseCurrency,
  plan,
}: Readonly<{
  analysis: EmergencyFundAnalysis;
  baseCurrency: Currency;
  plan: EmergencyFundPlanInput;
}>) {
  return (
    <div className="space-y-4 border-t pt-5">
      <div className="grid gap-3 sm:grid-cols-3">
        <div>
          <p className="text-xs text-muted-foreground">Accessible now</p>
          <p className="text-lg font-semibold">
            {formatCurrency(Math.round(analysis.accessibleFunds), baseCurrency)}
          </p>
        </div>
        <div>
          <p className="text-xs text-muted-foreground">
            Reviewed essential need
          </p>
          <p className="text-lg font-semibold">
            {formatCurrency(
              Math.round(analysis.monthlyEssentialNeed),
              baseCurrency,
            )}
            /month
          </p>
        </div>
        <div>
          <p className="text-xs text-muted-foreground">Current coverage</p>
          <p className="text-lg font-semibold">
            {analysis.accessibleCoverageMonths == null
              ? "No spend basis"
              : `${analysis.accessibleCoverageMonths.toFixed(1)} months`}
          </p>
        </div>
      </div>

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
              <tr key={`current-${result.scenarioId}`} className="border-t">
                <td className="px-3 py-2 font-medium">
                  Current accessible funds
                </td>
                <td className="px-3 py-2 text-right font-mono tabular-nums">
                  {formatCurrency(
                    Math.round(result.startingReserve),
                    baseCurrency,
                  )}
                </td>
                <td className="px-3 py-2 text-right text-muted-foreground">
                  Observed position
                </td>
                <td className="px-3 py-2">
                  {stressDescription(result, baseCurrency)}
                </td>
              </tr>
            ))}
            {analysis.policyTargets.map((policy) => {
              const result = analysis.policyResults.find(
                ({ policyMonths }) => policyMonths === policy.months,
              );
              return (
                <tr key={policy.months} className="border-t">
                  <td className="px-3 py-2 font-medium">
                    {policy.months} months
                  </td>
                  <td className="px-3 py-2 text-right font-mono tabular-nums">
                    {formatCurrency(Math.round(policy.target), baseCurrency)}
                  </td>
                  <td className="px-3 py-2 text-right">
                    {policy.fundingGap > 0 ? (
                      <span className="text-amber-700 dark:text-amber-300">
                        {formatCurrency(
                          Math.round(policy.fundingGap),
                          baseCurrency,
                        )}{" "}
                        short
                      </span>
                    ) : policy.availableAboveTarget > 0 ? (
                      <span className="text-emerald-700 dark:text-emerald-300">
                        {formatCurrency(
                          Math.round(policy.availableAboveTarget),
                          baseCurrency,
                        )}{" "}
                        above target
                      </span>
                    ) : (
                      <span>On target</span>
                    )}
                  </td>
                  <td className="px-3 py-2">
                    {stressDescription(result, baseCurrency)}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <p className="text-xs text-muted-foreground">
        Money above a selected policy is available for another use. It can be
        spent now, invested for the future, or kept as extra margin. This view
        reports the trade-off; it does not choose for the household. Income
        reliability is currently {percentage(plan.employmentIncomeReliability)}{" "}
        and side-income reliability is {percentage(plan.sideIncomeReliability)}.
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
