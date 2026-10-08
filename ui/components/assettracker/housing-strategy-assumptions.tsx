import { Input } from "@/components/ui/input";
import type {
  HousingPlanningPosition,
  HousingStrategyAssumptions,
  HousingStrategyKind,
} from "@/lib/domain/assettracker";

export const HOUSING_STRATEGIES: HousingStrategyKind[] = [
  "stay",
  "sell-and-rent",
  "downsize",
  "equity-release",
];

export const HOUSING_STRATEGY_LABELS: Record<HousingStrategyKind, string> = {
  stay: "Stay",
  "sell-and-rent": "Sell and rent",
  downsize: "Downsize",
  "equity-release": "Equity release",
};

export type HousingMoneyField = Exclude<
  keyof HousingStrategyAssumptions,
  "kind" | "moveDate"
>;

type FieldDefinition = {
  field: HousingMoneyField;
  label: string;
};

const COMMON_FIELDS: FieldDefinition[] = [
  { field: "transactionCosts", label: "Transaction costs" },
  { field: "taxesAndFees", label: "Taxes or product fees" },
];

const STRATEGY_FIELDS: Record<HousingStrategyKind, FieldDefinition[]> = {
  stay: [
    { field: "annualOwnershipCost", label: "Annual ownership cost" },
    { field: "annualBorrowingCost", label: "Annual borrowing cost" },
  ],
  "sell-and-rent": [
    { field: "salePrice", label: "Sale price" },
    { field: "mortgageSettlement", label: "Mortgage settlement" },
    ...COMMON_FIELDS,
    { field: "annualRent", label: "Annual rent" },
  ],
  downsize: [
    { field: "salePrice", label: "Sale price" },
    { field: "mortgageSettlement", label: "Mortgage settlement" },
    ...COMMON_FIELDS,
    { field: "replacementHousingCost", label: "Replacement home" },
    { field: "annualOwnershipCost", label: "Annual ownership cost" },
    { field: "annualBorrowingCost", label: "Annual borrowing cost" },
  ],
  "equity-release": [
    { field: "equityReleaseAdvance", label: "Gross equity advance" },
    ...COMMON_FIELDS,
    { field: "annualOwnershipCost", label: "Annual ownership cost" },
    { field: "annualBorrowingCost", label: "Annual borrowing cost" },
  ],
};

export function createInitialHousingAssumptions(
  kind: HousingStrategyKind,
  position: HousingPlanningPosition,
): HousingStrategyAssumptions {
  const sellsHome = kind === "sell-and-rent" || kind === "downsize";
  return {
    kind,
    moveDate: position.asOfDate,
    salePrice: sellsHome ? position.homeValue : 0,
    mortgageSettlement: sellsHome ? position.mortgageBalance : 0,
    transactionCosts: 0,
    taxesAndFees: 0,
    replacementHousingCost: 0,
    annualRent: 0,
    annualOwnershipCost: 0,
    annualBorrowingCost: 0,
    equityReleaseAdvance: 0,
  };
}

function MoneyInput({
  definition,
  strategy,
  value,
  onChange,
}: Readonly<{
  definition: FieldDefinition;
  strategy: HousingStrategyKind;
  value: number;
  onChange: (field: HousingMoneyField, value: number) => void;
}>) {
  const { field, label } = definition;
  const id = `${strategy}-${field}`;
  return (
    <label htmlFor={id} className="space-y-1 text-xs text-muted-foreground">
      <span>{label}</span>
      <Input
        id={id}
        aria-label={`${HOUSING_STRATEGY_LABELS[strategy]} ${label}`}
        type="number"
        inputMode="decimal"
        min="0"
        step="100"
        value={value}
        onChange={(event) => onChange(field, Number(event.target.value) || 0)}
      />
    </label>
  );
}

function StrategyAssumptionEditor({
  assumptions,
  onChange,
}: Readonly<{
  assumptions: HousingStrategyAssumptions;
  onChange: (field: HousingMoneyField, value: number) => void;
}>) {
  return (
    <div className="grid gap-3 sm:grid-cols-2">
      {STRATEGY_FIELDS[assumptions.kind].map((definition) => (
        <MoneyInput
          key={definition.field}
          definition={definition}
          strategy={assumptions.kind}
          value={assumptions[definition.field]}
          onChange={onChange}
        />
      ))}
    </div>
  );
}

export function HousingAssumptionControls({
  asOfDate,
  assumptions,
  annualNonHousingExpenditure,
  moveDate,
  onAnnualSpendingChange,
  onMoveDateChange,
  onScenarioChange,
}: Readonly<{
  asOfDate: string;
  assumptions: HousingStrategyAssumptions[];
  annualNonHousingExpenditure: number;
  moveDate: string;
  onAnnualSpendingChange: (value: number) => void;
  onMoveDateChange: (value: string | null) => void;
  onScenarioChange: (
    kind: HousingStrategyKind,
    field: HousingMoneyField,
    value: number,
  ) => void;
}>) {
  return (
    <details className="rounded-md border p-4">
      <summary className="cursor-pointer text-sm font-medium">
        Adjust assumptions
      </summary>
      <div className="mt-4 space-y-4">
        <div className="grid gap-3 sm:grid-cols-2">
          <label
            htmlFor="housing-move-date"
            className="space-y-1 text-xs text-muted-foreground"
          >
            <span>Move or transaction date</span>
            <Input
              id="housing-move-date"
              aria-label="Housing move date"
              type="date"
              min={asOfDate}
              value={moveDate}
              onChange={(event) => onMoveDateChange(event.target.value || null)}
            />
          </label>
          <label
            htmlFor="annual-non-housing-spending"
            className="space-y-1 text-xs text-muted-foreground"
          >
            <span>Annual non-housing spending</span>
            <Input
              id="annual-non-housing-spending"
              aria-label="Annual non-housing spending assumption"
              type="number"
              inputMode="decimal"
              min="0"
              step="100"
              value={annualNonHousingExpenditure}
              onChange={(event) =>
                onAnnualSpendingChange(Number(event.target.value) || 0)
              }
            />
          </label>
        </div>

        <div className="grid gap-4 lg:grid-cols-2">
          {assumptions.map((scenario) => (
            <details className="rounded-md border p-4" key={scenario.kind}>
              <summary className="cursor-pointer text-sm font-medium">
                {HOUSING_STRATEGY_LABELS[scenario.kind]}
              </summary>
              <div className="mt-3">
                <StrategyAssumptionEditor
                  assumptions={scenario}
                  onChange={(field, value) =>
                    onScenarioChange(scenario.kind, field, value)
                  }
                />
              </div>
            </details>
          ))}
        </div>

        <p className="text-xs text-muted-foreground">
          Use quotes for lender, tenancy, conveyancing, tax, and product costs.
          Unknown values start at zero.
        </p>
      </div>
    </details>
  );
}
