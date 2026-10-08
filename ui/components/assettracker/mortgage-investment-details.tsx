import { format, parseISO } from "date-fns";
import type {
  MortgageInvestmentComparison,
  MortgageInvestmentOutcome,
} from "@/lib/domain/assettracker";
import type { MortgageInvestmentFormatters } from "./mortgage-investment-results";

const COLUMNS = [
  ["Mortgage at horizon", true],
  ["Payoff", false],
  ["Interest", true],
  ["Fees / charges", true],
  ["Mortgage cash, first year", true],
  ["Strategy investment", true],
  ["Liquid assets", true],
  ["Property", true],
  ["Home equity", true],
  ["Net worth", true],
  ["Stressed net worth", true],
  ["Drawdown exposure", true],
  ["Projected FI", false],
] as const;

export function MortgageInvestmentDetails({
  comparison,
  money,
  fiDate,
}: Readonly<{
  comparison: MortgageInvestmentComparison;
  money: MortgageInvestmentFormatters["money"];
  fiDate: MortgageInvestmentFormatters["fiDate"];
}>) {
  return (
    <details className="rounded-md border p-4">
      <summary className="cursor-pointer text-sm font-medium">
        All calculated measures
      </summary>
      <div className="mt-4 overflow-x-auto rounded-md border">
        <table
          className="w-full min-w-[1450px] text-sm"
          aria-label="Detailed mortgage strategy results"
        >
          <thead className="bg-muted/50 text-left text-xs text-muted-foreground">
            <tr>
              <th className="px-3 py-2 font-medium">Strategy</th>
              {COLUMNS.map(([column, numeric]) => (
                <th
                  className={`px-3 py-2 font-medium ${numeric ? "text-right" : ""}`}
                  key={column}
                >
                  {column}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {[comparison.overpay, comparison.invest].map((outcome) => (
              <DetailedResultRow
                key={outcome.strategy}
                outcome={outcome}
                money={money}
                fiDate={fiDate}
              />
            ))}
          </tbody>
        </table>
      </div>
    </details>
  );
}

function DetailedResultRow({
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
        className="whitespace-nowrap px-3 py-2 text-left font-medium"
      >
        {outcome.label}
      </th>
      <td className="px-3 py-2 text-right">{money(outcome.mortgageBalance)}</td>
      <td className="whitespace-nowrap px-3 py-2">
        {format(parseISO(outcome.mortgagePayoffDate), "MMM yyyy")}
      </td>
      <td className="px-3 py-2 text-right">{money(outcome.interestPaid)}</td>
      <td className="px-3 py-2 text-right">
        {money(outcome.mortgageFeesAndCharges)}
      </td>
      <td className="px-3 py-2 text-right">
        {money(outcome.firstYearMortgageCashRequired)}
      </td>
      <td className="px-3 py-2 text-right">
        {money(outcome.investmentBalance)}
      </td>
      <td className="px-3 py-2 text-right">{money(outcome.liquidAssets)}</td>
      <td className="px-3 py-2 text-right">{money(outcome.propertyValue)}</td>
      <td className="px-3 py-2 text-right">{money(outcome.homeEquity)}</td>
      <td className="px-3 py-2 text-right">{money(outcome.netWorth)}</td>
      <td className="px-3 py-2 text-right">
        {money(outcome.stressedNetWorth)}
      </td>
      <td className="px-3 py-2 text-right">
        {money(outcome.drawdownExposure)}
      </td>
      <td className="whitespace-nowrap px-3 py-2">
        {fiDate(outcome.projectedFiDate)}
      </td>
    </tr>
  );
}
