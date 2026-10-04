import type { MortgageCalculatorResult } from "@/lib/domain/assettracker";

type FormatMoney = (value: number) => string;

function percentage(value: number): string {
  return `${(value * 100).toFixed(1)}%`;
}

export function MortgageCalculatorHighlights({
  result,
  money,
}: Readonly<{
  result: MortgageCalculatorResult;
  money: FormatMoney;
}>) {
  const { selected } = result;
  return (
    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
      {[
        ["Mortgage", money(selected.openingLoan)],
        ["Loan to value", percentage(selected.loanToValue)],
        ["First payment", money(selected.initialMonthlyPayment)],
        ["Cash retained", money(selected.retainedLiquidity)],
      ].map(([label, value]) => (
        <div key={label} className="rounded-md border p-3">
          <p className="text-xs text-muted-foreground">{label}</p>
          <p className="mt-1 text-lg font-semibold">{value}</p>
        </div>
      ))}
    </div>
  );
}

export function MortgageDepositComparison({
  result,
  money,
}: Readonly<{
  result: MortgageCalculatorResult;
  money: FormatMoney;
}>) {
  return (
    <div className="overflow-x-auto rounded-md border">
      <table
        className="w-full min-w-[760px] text-sm"
        aria-label="Mortgage deposit comparison"
      >
        <thead className="bg-muted/50 text-left text-xs text-muted-foreground">
          <tr>
            <th className="px-3 py-2 font-medium">Deposit</th>
            <th className="px-3 py-2 text-right font-medium">LTV</th>
            <th className="px-3 py-2 text-right font-medium">Cash retained</th>
            <th className="px-3 py-2 text-right font-medium">First payment</th>
            <th className="px-3 py-2 text-right font-medium">Total interest</th>
            <th className="px-3 py-2 text-right font-medium">Payoff</th>
          </tr>
        </thead>
        <tbody>
          {result.depositOptions.map((option) => (
            <tr
              key={option.depositAmount}
              className={
                option.depositAmount === result.selected.depositAmount
                  ? "border-t bg-muted/30 font-medium"
                  : "border-t"
              }
            >
              <th className="whitespace-nowrap px-3 py-2 text-left">
                {money(option.depositAmount)} (
                {percentage(option.depositPercentage)})
              </th>
              <td className="whitespace-nowrap px-3 py-2 text-right">
                {percentage(option.loanToValue)}
              </td>
              <td className="whitespace-nowrap px-3 py-2 text-right">
                {money(option.retainedLiquidity)}
              </td>
              <td className="whitespace-nowrap px-3 py-2 text-right">
                {money(option.initialMonthlyPayment)}
              </td>
              <td className="whitespace-nowrap px-3 py-2 text-right">
                {money(option.totalInterest)}
              </td>
              <td className="whitespace-nowrap px-3 py-2 text-right">
                {option.payoffDate}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function MortgageRateStress({
  result,
  money,
}: Readonly<{
  result: MortgageCalculatorResult;
  money: FormatMoney;
}>) {
  return (
    <div>
      <h3 className="mb-2 text-sm font-medium">Rate stress</h3>
      <div className="overflow-x-auto rounded-md border">
        <table
          className="w-full min-w-[620px] text-sm"
          aria-label="Mortgage rate stress"
        >
          <thead className="bg-muted/50 text-left text-xs text-muted-foreground">
            <tr>
              <th className="px-3 py-2 font-medium">Rate change</th>
              <th className="px-3 py-2 text-right font-medium">Initial rate</th>
              <th className="px-3 py-2 text-right font-medium">After fix</th>
              <th className="px-3 py-2 text-right font-medium">
                First payment
              </th>
              <th className="px-3 py-2 text-right font-medium">
                Total interest
              </th>
            </tr>
          </thead>
          <tbody>
            {result.rateStress.map((stress) => (
              <tr key={stress.rateAdjustment} className="border-t">
                <th className="px-3 py-2 text-left">
                  {stress.rateAdjustment === 0
                    ? "Assumption"
                    : `${stress.rateAdjustment > 0 ? "+" : ""}${percentage(stress.rateAdjustment)}`}
                </th>
                <td className="px-3 py-2 text-right">
                  {percentage(stress.initialAnnualRate)}
                </td>
                <td className="px-3 py-2 text-right">
                  {percentage(stress.followOnAnnualRate)}
                </td>
                <td className="px-3 py-2 text-right">
                  {money(stress.initialMonthlyPayment)}
                </td>
                <td className="px-3 py-2 text-right">
                  {money(stress.totalInterest)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

export function MortgageScheduleDetails({
  result,
  money,
}: Readonly<{
  result: MortgageCalculatorResult;
  money: FormatMoney;
}>) {
  return (
    <details className="rounded-md border p-4">
      <summary className="cursor-pointer text-sm font-medium">
        First 12 scheduled payments
      </summary>
      <div className="mt-4 overflow-x-auto rounded-md border">
        <table
          className="w-full min-w-[760px] text-xs"
          aria-label="Mortgage calculator schedule"
        >
          <thead className="bg-muted/50 text-left text-muted-foreground">
            <tr>
              <th className="px-2 py-2 font-medium">Date</th>
              <th className="px-2 py-2 text-right font-medium">Required</th>
              <th className="px-2 py-2 text-right font-medium">Interest</th>
              <th className="px-2 py-2 text-right font-medium">Principal</th>
              <th className="px-2 py-2 text-right font-medium">Overpayment</th>
              <th className="px-2 py-2 text-right font-medium">Charge</th>
              <th className="px-2 py-2 text-right font-medium">Balance</th>
            </tr>
          </thead>
          <tbody>
            {result.selected.schedule.slice(0, 12).map((row) => (
              <tr key={row.date} className="border-t">
                <td className="whitespace-nowrap px-2 py-2">{row.date}</td>
                {[
                  row.totalDue,
                  row.interest,
                  row.principal,
                  row.overpayment,
                  row.overpaymentCharge,
                  row.closingBalance,
                ].map((value, index) => (
                  <td
                    key={`${row.date}-${index}`}
                    className="whitespace-nowrap px-2 py-2 text-right"
                  >
                    {money(value)}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="mt-3 text-xs text-muted-foreground">
        Values round to pennies each month. The first period uses daily interest
        when its start date is supplied.
      </p>
    </details>
  );
}
