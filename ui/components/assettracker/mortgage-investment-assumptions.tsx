import { Input } from "@/components/ui/input";
import type { MortgageInvestmentComparisonInput } from "@/lib/domain/assettracker";

export type MortgageInvestmentAssumptions = Pick<
  MortgageInvestmentComparisonInput,
  | "availableCapital"
  | "monthlySurplus"
  | "horizonMonths"
  | "investmentAnnualReturn"
  | "investmentVolatility"
  | "investmentStressMultiple"
  | "investmentTaxRate"
  | "investmentAnnualFeeRate"
  | "penaltyFreeOverpayment"
  | "overpaymentChargeRate"
>;

export type MortgageInvestmentAssumptionField =
  keyof MortgageInvestmentAssumptions;

type FieldDefinition = {
  field: MortgageInvestmentAssumptionField;
  label: string;
};

const SECTIONS: ReadonlyArray<{
  title: string;
  columns: string;
  fields: FieldDefinition[];
}> = [
  {
    title: "Plan",
    columns: "sm:grid-cols-3",
    fields: [
      { field: "availableCapital", label: "Capital available now" },
      { field: "monthlySurplus", label: "Monthly surplus" },
      { field: "horizonMonths", label: "Comparison horizon, months" },
    ],
  },
  {
    title: "Investment",
    columns: "sm:grid-cols-2 lg:grid-cols-5",
    fields: [
      { field: "investmentAnnualReturn", label: "Annual return" },
      { field: "investmentVolatility", label: "Stress range" },
      { field: "investmentStressMultiple", label: "Stress multiple" },
      { field: "investmentAnnualFeeRate", label: "Annual fee" },
      { field: "investmentTaxRate", label: "Tax on gains" },
    ],
  },
  {
    title: "Mortgage product",
    columns: "sm:grid-cols-2",
    fields: [
      { field: "penaltyFreeOverpayment", label: "Penalty-free overpayment" },
      { field: "overpaymentChargeRate", label: "Charge above allowance" },
    ],
  },
];

const PERCENT_FIELDS = new Set<MortgageInvestmentAssumptionField>([
  "investmentAnnualReturn",
  "investmentVolatility",
  "investmentTaxRate",
  "investmentAnnualFeeRate",
  "overpaymentChargeRate",
]);

function AssumptionInput({
  definition,
  value,
  onChange,
}: Readonly<{
  definition: FieldDefinition;
  value: number;
  onChange: (field: MortgageInvestmentAssumptionField, value: number) => void;
}>) {
  const { field, label } = definition;
  const percent = PERCENT_FIELDS.has(field);
  const id = `mortgage-investment-${field}`;
  let step = "100";
  if (percent) step = "0.1";
  else if (field === "horizonMonths") step = "12";
  return (
    <label htmlFor={id} className="space-y-1 text-xs text-muted-foreground">
      <span>{label}</span>
      <Input
        id={id}
        aria-label={label}
        type="number"
        inputMode="decimal"
        min="0"
        step={step}
        value={percent ? value * 100 : value}
        onChange={(event) =>
          onChange(
            field,
            (Number(event.target.value) || 0) / (percent ? 100 : 1),
          )
        }
      />
    </label>
  );
}

export function MortgageInvestmentAssumptionControls({
  assumptions,
  onChange,
}: Readonly<{
  assumptions: MortgageInvestmentAssumptions;
  onChange: (field: MortgageInvestmentAssumptionField, value: number) => void;
}>) {
  return (
    <details className="rounded-md border p-4">
      <summary className="cursor-pointer text-sm font-medium">
        Adjust assumptions
      </summary>
      <div className="mt-4 space-y-5">
        {SECTIONS.map((section) => (
          <div key={section.title}>
            <h3 className="mb-3 text-xs font-medium text-muted-foreground">
              {section.title}
            </h3>
            <div className={`grid gap-3 ${section.columns}`}>
              {section.fields.map((definition) => (
                <AssumptionInput
                  key={definition.field}
                  definition={definition}
                  value={assumptions[definition.field]}
                  onChange={onChange}
                />
              ))}
            </div>
          </div>
        ))}
      </div>
    </details>
  );
}
