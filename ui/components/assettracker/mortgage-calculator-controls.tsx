import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type {
  MortgageCalculatorAssumptions,
  MortgageRepaymentType,
} from "@/lib/domain/assettracker";
import { repaymentTypeLabel } from "@/lib/domain/assettracker";

type NumberField = {
  field: keyof MortgageCalculatorAssumptions;
  label: string;
  percent?: boolean;
  step?: string;
};

function normalizeNumber(definition: NumberField, rawValue: string) {
  if (rawValue === "") return null;
  const parsed = Number(rawValue);
  if (!Number.isFinite(parsed)) return null;
  const value = parsed / (definition.percent ? 100 : 1);
  if (definition.field === "purchasePrice") return Math.max(value, 1);
  if (definition.field === "termMonths") {
    return Math.min(Math.max(Math.round(value), 1), 1_200);
  }
  if (definition.percent) return Math.min(Math.max(value, 0), 1);
  return Math.max(value, 0);
}

const SECTIONS: ReadonlyArray<{ title: string; fields: NumberField[] }> = [
  {
    title: "Property and funds",
    fields: [
      { field: "purchasePrice", label: "Property price", step: "1000" },
      { field: "availableFunds", label: "Funds available", step: "1000" },
      { field: "depositAmount", label: "Deposit or equity", step: "1000" },
    ],
  },
  {
    title: "Mortgage product",
    fields: [
      { field: "initialAnnualRate", label: "Initial rate", percent: true },
      { field: "termMonths", label: "Term, months", step: "12" },
      { field: "followOnAnnualRate", label: "Rate after fix", percent: true },
      { field: "refinanceFee", label: "Refinance fee", step: "100" },
    ],
  },
  {
    title: "Costs and overpayments",
    fields: [
      { field: "purchaseFees", label: "Purchase fees", step: "100" },
      { field: "taxes", label: "Purchase taxes", step: "100" },
      { field: "transactionCosts", label: "Transaction costs", step: "100" },
      { field: "monthlyOverpayment", label: "Monthly overpayment", step: "50" },
      {
        field: "overpaymentAllowance",
        label: "Annual overpayment allowance",
        step: "500",
      },
      {
        field: "overpaymentChargeRate",
        label: "Charge above allowance",
        percent: true,
      },
    ],
  },
];

function NumberInput({
  definition,
  value,
  onChange,
}: Readonly<{
  definition: NumberField;
  value: number;
  onChange: (value: number) => void;
}>) {
  const id = `mortgage-calculator-${definition.field}`;
  return (
    <label htmlFor={id} className="space-y-1 text-xs text-muted-foreground">
      <span>{definition.label}</span>
      <Input
        id={id}
        aria-label={definition.label}
        type="number"
        inputMode="decimal"
        min="0"
        step={definition.step ?? "0.1"}
        value={definition.percent ? value * 100 : value}
        onChange={(event) => {
          const next = normalizeNumber(definition, event.target.value);
          if (next != null) onChange(next);
        }}
      />
    </label>
  );
}

export function MortgageCalculatorControls({
  assumptions,
  onChange,
}: Readonly<{
  assumptions: MortgageCalculatorAssumptions;
  onChange: (next: MortgageCalculatorAssumptions) => void;
}>) {
  const setNumber = (
    field: keyof MortgageCalculatorAssumptions,
    value: number,
  ) => onChange({ ...assumptions, [field]: value });
  const setDate = (
    field: "accrualStartDate" | "firstPaymentDate" | "fixedPeriodEnd",
    value: string,
  ) => {
    if (field === "firstPaymentDate" && value === "") return;
    onChange({ ...assumptions, [field]: value || undefined });
  };

  return (
    <details className="rounded-md border p-4">
      <summary className="cursor-pointer text-sm font-medium">
        Adjust mortgage assumptions
      </summary>
      <div className="mt-4 space-y-5">
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <div className="space-y-1 text-xs text-muted-foreground">
            <span>Repayment type</span>
            <Select
              value={assumptions.repaymentType}
              onValueChange={(value: MortgageRepaymentType) =>
                onChange({ ...assumptions, repaymentType: value })
              }
            >
              <SelectTrigger aria-label="Repayment type" className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {(["repayment", "interest-only"] as const).map((value) => (
                  <SelectItem key={value} value={value}>
                    {repaymentTypeLabel(value)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          {(
            [
              ["accrualStartDate", "Interest starts"],
              ["firstPaymentDate", "First payment"],
              ["fixedPeriodEnd", "Fixed period ends"],
            ] as const
          ).map(([field, label]) => (
            <label
              key={field}
              htmlFor={`mortgage-calculator-${field}`}
              className="space-y-1 text-xs text-muted-foreground"
            >
              <span>{label}</span>
              <Input
                id={`mortgage-calculator-${field}`}
                aria-label={label}
                type="date"
                value={assumptions[field] ?? ""}
                onChange={(event) => setDate(field, event.target.value)}
              />
            </label>
          ))}
        </div>
        {SECTIONS.map((section) => (
          <section key={section.title}>
            <h3 className="mb-3 text-xs font-medium text-muted-foreground">
              {section.title}
            </h3>
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {section.fields.map((definition) => (
                <NumberInput
                  key={definition.field}
                  definition={definition}
                  value={assumptions[definition.field] as number}
                  onChange={(value) => setNumber(definition.field, value)}
                />
              ))}
            </div>
          </section>
        ))}
        <p className="text-xs text-muted-foreground">
          Rates are planning assumptions, not lender offers. Enter quoted fees
          and taxes for the transaction you are considering.
        </p>
      </div>
    </details>
  );
}
