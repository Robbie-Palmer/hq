import { formatCurrency } from "@/lib/assettracker";
import type {
  Currency,
  EmergencyFundDerivedFacts,
} from "@/lib/domain/assettracker";

function factItems(facts: EmergencyFundDerivedFacts, currency: Currency) {
  const money = (value: number) =>
    `${formatCurrency(Math.round(value), currency)}/month`;
  return [
    {
      label: "Spending baseline",
      value:
        facts.essentialMonthlyExpenditure == null
          ? "Missing"
          : money(
              facts.essentialMonthlyExpenditure + facts.monthlyDebtPayments,
            ),
      source: "Reconciled current spending, including debt payments",
    },
    {
      label: "Debt payments",
      value: money(facts.monthlyDebtPayments),
      source: "Active recurring liability payments",
    },
    {
      label: "Employment income",
      value:
        facts.employmentMonthlyIncome == null
          ? "Missing"
          : money(facts.employmentMonthlyIncome),
      source: "Active take-home income flows",
    },
    {
      label: "Side income",
      value: money(facts.monthlySideIncome),
      source: "Active side-income flows",
    },
    {
      label: "Inflation",
      value: `${(facts.annualInflationRate * 100).toFixed(1)}%`,
      source: "Shared tracker setting",
    },
  ];
}

export function EmergencyFundFacts({
  baseCurrency,
  facts,
}: Readonly<{
  baseCurrency: Currency;
  facts: EmergencyFundDerivedFacts;
}>) {
  const items = factItems(facts, baseCurrency);
  return (
    <div className="space-y-3">
      <div>
        <h4 className="text-sm font-medium">Facts from the tracker</h4>
        <p className="text-xs text-muted-foreground">
          These update from reconciled spending, recurring flows, and the shared
          inflation setting. The reserve plan does not override them.
        </p>
      </div>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
        {items.map((item) => (
          <div key={item.label} className="rounded-md bg-muted/40 p-3">
            <p className="text-xs text-muted-foreground">{item.label}</p>
            <p className="font-medium">{item.value}</p>
            <p className="text-xs text-muted-foreground">{item.source}</p>
          </div>
        ))}
      </div>
    </div>
  );
}
