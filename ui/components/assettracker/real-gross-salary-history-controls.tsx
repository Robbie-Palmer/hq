import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  InflationIndexSchema,
  SalaryAmountKindSchema,
} from "@/lib/domain/assettracker";
import type { RealGrossSalaryHistoryView } from "./use-real-gross-salary-history";

export const SALARY_AMOUNT_LABELS = {
  annualSalary: "Annual salary rate",
  periodPay: "Actual period earnings",
} as const;

type ControlsProps = Pick<
  RealGrossSalaryHistoryView,
  | "amountKind"
  | "inflationIndex"
  | "people"
  | "person"
  | "referencePeriod"
  | "release"
  | "selectIndex"
  | "setAmountKind"
  | "setReferencePeriod"
  | "setSelectedPerson"
>;

function PersonControl(props: ControlsProps) {
  return (
    <div className="space-y-1.5 text-sm">
      <span className="font-medium">Person</span>
      <Select value={props.person} onValueChange={props.setSelectedPerson}>
        <SelectTrigger className="w-full" aria-label="Salary person">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {props.people.map((name) => (
            <SelectItem key={name} value={name}>
              {name}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}

function AmountControl(props: ControlsProps) {
  return (
    <div className="space-y-1.5 text-sm">
      <span className="font-medium">Gross figure</span>
      <Select
        value={props.amountKind}
        onValueChange={(value) =>
          props.setAmountKind(SalaryAmountKindSchema.parse(value))
        }
      >
        <SelectTrigger className="w-full" aria-label="Gross salary figure">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {SalaryAmountKindSchema.options.map((kind) => (
            <SelectItem key={kind} value={kind}>
              {SALARY_AMOUNT_LABELS[kind]}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}

function InflationControl(props: ControlsProps) {
  return (
    <div className="space-y-1.5 text-sm">
      <span className="font-medium">Inflation index</span>
      <Select value={props.inflationIndex} onValueChange={props.selectIndex}>
        <SelectTrigger className="w-full" aria-label="Salary inflation index">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {InflationIndexSchema.options.map((index) => (
            <SelectItem key={index} value={index}>
              {index}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}

function ReferenceMonthControl(props: ControlsProps) {
  return (
    <div className="space-y-1.5 text-sm">
      <label htmlFor="salary-reference-month" className="font-medium">
        Reference month
      </label>
      <Input
        id="salary-reference-month"
        aria-label="Salary reference month"
        type="month"
        value={props.referencePeriod}
        min={props.release?.source.coverageFrom}
        max={props.release?.source.coverageThrough}
        onChange={(event) => {
          if (event.target.value !== "") {
            props.setReferencePeriod(event.target.value);
          }
        }}
      />
    </div>
  );
}

export function RealGrossSalaryControls(props: ControlsProps) {
  return (
    <div className="grid gap-3 rounded-lg border bg-muted/20 p-4 sm:grid-cols-2 lg:grid-cols-4">
      <PersonControl {...props} />
      <AmountControl {...props} />
      <InflationControl {...props} />
      <ReferenceMonthControl {...props} />
    </div>
  );
}
