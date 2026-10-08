import type { MortgageInvestmentSensitivity } from "@/lib/domain/assettracker";
import type { MortgageInvestmentFormatters } from "./mortgage-investment-results";

export function MortgageInvestmentSensitivityTable({
  sensitivity,
  mortgageRates,
  investmentReturns,
  money,
  percent,
}: Readonly<{
  sensitivity: MortgageInvestmentSensitivity[];
  mortgageRates: number[];
  investmentReturns: number[];
  money: MortgageInvestmentFormatters["money"];
  percent: MortgageInvestmentFormatters["percent"];
}>) {
  const advantages = new Map(
    sensitivity.map((entry) => [
      `${entry.mortgageRate}:${entry.investmentReturn}`,
      entry.investNetWorthAdvantage,
    ]),
  );
  return (
    <div>
      <h3 className="text-sm font-medium">Rate sensitivity</h3>
      <p className="mt-1 text-xs text-muted-foreground">
        Positive values favour investing. Negative values favour overpaying.
      </p>
      <div className="mt-3 overflow-x-auto rounded-md border">
        <table
          className="w-full min-w-[560px] text-sm"
          aria-label="Mortgage and investment return sensitivity"
        >
          <thead className="bg-muted/50 text-xs text-muted-foreground">
            <tr>
              <th className="px-3 py-2 text-left font-medium">Mortgage rate</th>
              {investmentReturns.map((rate, index) => (
                <th
                  className="px-3 py-2 text-right font-medium"
                  key={`${rate}:${index}`}
                >
                  Investment {percent(rate)}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {mortgageRates.map((mortgageRate, mortgageRateIndex) => (
              <tr
                className="border-t"
                key={`${mortgageRate}:${mortgageRateIndex}`}
              >
                <th scope="row" className="px-3 py-2 text-left font-medium">
                  {percent(mortgageRate)}
                </th>
                {investmentReturns.map((investmentReturn, returnIndex) => (
                  <td
                    className="px-3 py-2 text-right"
                    key={`${investmentReturn}:${returnIndex}`}
                  >
                    {money(
                      advantages.get(`${mortgageRate}:${investmentReturn}`) ??
                        0,
                    )}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
