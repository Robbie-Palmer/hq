"use client";

import { format, parseISO } from "date-fns";
import { CopyIcon, PencilIcon, Trash2Icon } from "lucide-react";
import { type ReactNode, type SubmitEvent, useMemo, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { formatCurrency } from "@/lib/assettracker";
import {
  formatAssetTrackerError,
  type JobMoveScenario,
  type JobMoveScenarioComparison,
  type JobMoveScenarioInput,
  type SalaryPayFrequency,
  SUPPORTED_CURRENCIES,
} from "@/lib/domain/assettracker";
import { useAssetTracker } from "./asset-tracker-provider";
import { JobMoveScenarioCharts } from "./job-move-scenario-charts";

const HORIZONS = [1, 3, 5, 10] as const;

type Draft = {
  name: string;
  employmentStatus: "employed" | "unemployed";
  transitionDate: string;
  roleStartDate: string;
  employer: string;
  baseGrossPay: number;
  variableGrossPay: number;
  payFrequency: SalaryPayFrequency;
  currency: (typeof SUPPORTED_CURRENCIES)[number];
  jurisdiction: string;
  employeePensionRate: number;
  employeePensionMethod: "salarySacrifice" | "netPay";
  employerPensionRate: number;
  annualTakeHomeOverride?: number;
  annualSpendingOverride?: number;
  destinationAccountId: string;
  pensionAccountId: string;
  replacedRecurringFlowIds: string[];
};

function Field({
  id,
  label,
  children,
}: Readonly<{ id: string; label: string; children: ReactNode }>) {
  return (
    <div className="space-y-1.5">
      <label htmlFor={id} className="text-xs font-medium">
        {label}
      </label>
      {children}
    </div>
  );
}

function scenarioDraft(scenario: JobMoveScenario): Draft {
  return {
    name: scenario.name,
    employmentStatus: scenario.employmentStatus,
    transitionDate: scenario.transitionDate,
    roleStartDate: scenario.roleStartDate ?? "",
    employer: scenario.employer ?? "",
    baseGrossPay: scenario.baseGrossPay,
    variableGrossPay: scenario.variableGrossPay,
    payFrequency: scenario.payFrequency,
    currency: scenario.currency,
    jurisdiction: scenario.jurisdiction,
    employeePensionRate: scenario.employeePensionRate,
    employeePensionMethod: scenario.employeePensionMethod,
    employerPensionRate: scenario.employerPensionRate,
    annualTakeHomeOverride: scenario.annualTakeHomeOverride,
    annualSpendingOverride: scenario.annualSpendingOverride,
    destinationAccountId: scenario.destinationAccountId ?? "",
    pensionAccountId: scenario.pensionAccountId ?? "",
    replacedRecurringFlowIds: scenario.replacedRecurringFlowIds,
  };
}

function inputFromDraft(draft: Draft): JobMoveScenarioInput {
  if (draft.employmentStatus === "unemployed") {
    return {
      ...draft,
      roleStartDate: undefined,
      employer: undefined,
      baseGrossPay: 0,
      variableGrossPay: 0,
      employeePensionRate: 0,
      employerPensionRate: 0,
      annualTakeHomeOverride: undefined,
      destinationAccountId: undefined,
      pensionAccountId: undefined,
    };
  }
  return {
    ...draft,
    employer: draft.employer || undefined,
    roleStartDate: draft.roleStartDate || undefined,
    annualTakeHomeOverride: draft.annualTakeHomeOverride,
    destinationAccountId: draft.destinationAccountId || undefined,
    pensionAccountId: draft.pensionAccountId || undefined,
  };
}

type DraftUpdate = <K extends keyof Draft>(key: K, value: Draft[K]) => void;
type AccountOption = ReturnType<
  typeof useAssetTracker
>["accountDetails"][number];

function useScenarioForm(
  editing: JobMoveScenario | null,
  onSaved: (id?: string) => void,
) {
  const tracker = useAssetTracker();
  const openAccounts = tracker.accountDetails.filter(({ isOpen }) => isOpen);
  const defaultIncomeAccount =
    openAccounts.find(({ assetType }) => assetType === "cash")?.id ?? "";
  const defaultPensionAccount =
    openAccounts.find(({ name }) => /pension/i.test(name))?.id ?? "";
  const defaultFlowIds = tracker.recurringFlows
    .filter(
      (flow) =>
        flow.compensationKind != null || /salary|pay|pension/i.test(flow.name),
    )
    .map(({ id }) => id);
  const [draft, setDraft] = useState<Draft>(() =>
    editing == null
      ? {
          name: "",
          employmentStatus: "employed",
          transitionDate: tracker.valuationDate ?? "",
          roleStartDate: tracker.valuationDate ?? "",
          employer: "",
          baseGrossPay: 0,
          variableGrossPay: 0,
          payFrequency: "monthly",
          currency: tracker.baseCurrency,
          jurisdiction: "England",
          employeePensionRate: 0,
          employeePensionMethod: "salarySacrifice",
          employerPensionRate: 0,
          destinationAccountId: defaultIncomeAccount,
          pensionAccountId: defaultPensionAccount,
          replacedRecurringFlowIds: defaultFlowIds,
        }
      : scenarioDraft(editing),
  );
  const [state, setState] = useState<"idle" | "saving">("idle");
  const [error, setError] = useState<string | null>(null);
  const update: DraftUpdate = (key, value) =>
    setDraft((current) => ({ ...current, [key]: value }));
  const toggleFlow = (id: string, checked: boolean) =>
    update(
      "replacedRecurringFlowIds",
      checked
        ? Array.from(new Set([...draft.replacedRecurringFlowIds, id]))
        : draft.replacedRecurringFlowIds.filter(
            (candidate) => candidate !== id,
          ),
    );
  const submit = async (event: SubmitEvent<HTMLFormElement>) => {
    event.preventDefault();
    setState("saving");
    setError(null);
    try {
      await tracker.saveJobMoveScenario({
        id: editing?.id,
        scenario: inputFromDraft(draft),
      });
      onSaved(editing?.id);
    } catch (cause) {
      setError(
        cause instanceof Error && cause.message.startsWith("Enter an annual")
          ? cause.message
          : formatAssetTrackerError(cause),
      );
    } finally {
      setState("idle");
    }
  };
  return {
    draft,
    error,
    openAccounts,
    state,
    submit,
    toggleFlow,
    tracker,
    update,
  };
}

function ScenarioIdentityFields({
  draft,
  update,
}: Readonly<{ draft: Draft; update: DraftUpdate }>) {
  return (
    <>
      <Field id="job-scenario-name" label="Scenario name">
        <Input
          id="job-scenario-name"
          required
          value={draft.name}
          onChange={(event) => update("name", event.target.value)}
        />
      </Field>
      <Field id="job-employment-status" label="Outcome">
        <select
          id="job-employment-status"
          className="h-9 w-full rounded-md border bg-background px-3 text-sm"
          value={draft.employmentStatus}
          onChange={(event) =>
            update(
              "employmentStatus",
              event.target.value as Draft["employmentStatus"],
            )
          }
        >
          <option value="employed">Move to a new role</option>
          <option value="unemployed">Leave without another role</option>
        </select>
      </Field>
      <Field id="job-transition-date" label="Current income stops from">
        <Input
          id="job-transition-date"
          type="date"
          required
          value={draft.transitionDate}
          onChange={(event) => update("transitionDate", event.target.value)}
        />
      </Field>
      <ScenarioSpendingField draft={draft} update={update} />
    </>
  );
}

function ScenarioSpendingField({
  draft,
  update,
}: Readonly<{ draft: Draft; update: DraftUpdate }>) {
  return (
    <Field id="job-spending-override" label="Annual spending in scenario">
      <Input
        id="job-spending-override"
        type="number"
        min="0.01"
        step="0.01"
        placeholder="Uses the current forecast when blank"
        value={draft.annualSpendingOverride ?? ""}
        onChange={(event) =>
          update(
            "annualSpendingOverride",
            event.target.value === "" ? undefined : Number(event.target.value),
          )
        }
      />
    </Field>
  );
}

function RoleIdentityPayFields({
  draft,
  update,
}: Readonly<{ draft: Draft; update: DraftUpdate }>) {
  return (
    <>
      <Field id="job-role-start" label="New role starts">
        <Input
          id="job-role-start"
          type="date"
          required
          value={draft.roleStartDate}
          onChange={(event) => update("roleStartDate", event.target.value)}
        />
      </Field>
      <Field id="job-employer" label="Prospective employer">
        <Input
          id="job-employer"
          required
          value={draft.employer}
          onChange={(event) => update("employer", event.target.value)}
        />
      </Field>
      <Field id="job-base-gross" label="Annual base gross">
        <Input
          id="job-base-gross"
          type="number"
          min="0"
          step="0.01"
          required
          value={draft.baseGrossPay}
          onChange={(event) =>
            update("baseGrossPay", Number(event.target.value))
          }
        />
      </Field>
      <Field id="job-variable-gross" label="Expected annual variable gross">
        <Input
          id="job-variable-gross"
          type="number"
          min="0"
          step="0.01"
          value={draft.variableGrossPay}
          onChange={(event) =>
            update("variableGrossPay", Number(event.target.value))
          }
        />
      </Field>
    </>
  );
}

function PayContextFields({
  draft,
  update,
}: Readonly<{ draft: Draft; update: DraftUpdate }>) {
  return (
    <>
      <Field id="job-pay-frequency" label="Pay frequency">
        <select
          id="job-pay-frequency"
          className="h-9 w-full rounded-md border bg-background px-3 text-sm"
          value={draft.payFrequency}
          onChange={(event) =>
            update("payFrequency", event.target.value as SalaryPayFrequency)
          }
        >
          <option value="weekly">Weekly</option>
          <option value="fortnightly">Fortnightly</option>
          <option value="fourWeekly">Every four weeks</option>
          <option value="monthly">Monthly</option>
          <option value="quarterly">Quarterly</option>
          <option value="annual">Annual</option>
          <option value="irregular">Irregular</option>
        </select>
      </Field>
      <Field id="job-currency" label="Currency">
        <select
          id="job-currency"
          className="h-9 w-full rounded-md border bg-background px-3 text-sm"
          value={draft.currency}
          onChange={(event) =>
            update("currency", event.target.value as Draft["currency"])
          }
        >
          {SUPPORTED_CURRENCIES.map((currency) => (
            <option key={currency} value={currency}>
              {currency}
            </option>
          ))}
        </select>
      </Field>
      <Field id="job-jurisdiction" label="Tax jurisdiction">
        <Input
          id="job-jurisdiction"
          required
          value={draft.jurisdiction}
          onChange={(event) => update("jurisdiction", event.target.value)}
        />
      </Field>
    </>
  );
}

function RolePayFields(props: Readonly<{ draft: Draft; update: DraftUpdate }>) {
  return (
    <>
      <RoleIdentityPayFields {...props} />
      <PayContextFields {...props} />
    </>
  );
}

function EmployeePensionFields({
  draft,
  update,
}: Readonly<{ draft: Draft; update: DraftUpdate }>) {
  return (
    <>
      <Field id="job-employee-pension" label="Employee pension rate (%)">
        <Input
          id="job-employee-pension"
          type="number"
          min="0"
          max="100"
          step="0.1"
          value={draft.employeePensionRate * 100}
          onChange={(event) =>
            update("employeePensionRate", Number(event.target.value) / 100)
          }
        />
      </Field>
      <Field id="job-pension-method" label="Employee pension method">
        <select
          id="job-pension-method"
          className="h-9 w-full rounded-md border bg-background px-3 text-sm"
          value={draft.employeePensionMethod}
          onChange={(event) =>
            update(
              "employeePensionMethod",
              event.target.value as Draft["employeePensionMethod"],
            )
          }
        >
          <option value="salarySacrifice">Salary sacrifice</option>
          <option value="netPay">Net pay</option>
        </select>
      </Field>
    </>
  );
}

function EmployerPensionFields({
  draft,
  update,
}: Readonly<{ draft: Draft; update: DraftUpdate }>) {
  return (
    <>
      <Field id="job-employer-pension" label="Employer pension rate (%)">
        <Input
          id="job-employer-pension"
          type="number"
          min="0"
          max="100"
          step="0.1"
          value={draft.employerPensionRate * 100}
          onChange={(event) =>
            update("employerPensionRate", Number(event.target.value) / 100)
          }
        />
      </Field>
      <Field id="job-take-home-override" label="Annual take-home override">
        <Input
          id="job-take-home-override"
          type="number"
          min="0"
          step="0.01"
          placeholder="Only needed when tax rules are unavailable"
          value={draft.annualTakeHomeOverride ?? ""}
          onChange={(event) =>
            update(
              "annualTakeHomeOverride",
              event.target.value === ""
                ? undefined
                : Number(event.target.value),
            )
          }
        />
      </Field>
    </>
  );
}

function PensionFields(props: Readonly<{ draft: Draft; update: DraftUpdate }>) {
  return (
    <>
      <EmployeePensionFields {...props} />
      <EmployerPensionFields {...props} />
    </>
  );
}

function AccountFields({
  accounts,
  draft,
  update,
}: Readonly<{ accounts: AccountOption[]; draft: Draft; update: DraftUpdate }>) {
  const options = accounts.map((account) => (
    <option key={account.id} value={account.id}>
      {account.name} ({account.currency})
    </option>
  ));
  return (
    <>
      <Field id="job-income-account" label="Take-home account">
        <select
          id="job-income-account"
          required
          className="h-9 w-full rounded-md border bg-background px-3 text-sm"
          value={draft.destinationAccountId}
          onChange={(event) =>
            update("destinationAccountId", event.target.value)
          }
        >
          <option value="">Choose an account</option>
          {options}
        </select>
      </Field>
      <Field id="job-pension-account" label="Pension account">
        <select
          id="job-pension-account"
          className="h-9 w-full rounded-md border bg-background px-3 text-sm"
          value={draft.pensionAccountId}
          onChange={(event) => update("pensionAccountId", event.target.value)}
        >
          <option value="">No pension account</option>
          {options}
        </select>
      </Field>
    </>
  );
}

function FlowSelection({
  draft,
  flows,
  toggleFlow,
}: Readonly<{
  draft: Draft;
  flows: ReturnType<typeof useAssetTracker>["recurringFlows"];
  toggleFlow(id: string, checked: boolean): void;
}>) {
  return (
    <fieldset className="space-y-2">
      <legend className="text-xs font-medium">
        Current-role flows that stop
      </legend>
      <p className="text-xs text-muted-foreground">
        Select pay, pension, or other flows tied to the current job. Side income
        can continue unchanged.
      </p>
      <div className="grid gap-2 sm:grid-cols-2">
        {flows.map((flow) => (
          <label key={flow.id} className="flex items-center gap-2 text-xs">
            <input
              type="checkbox"
              checked={draft.replacedRecurringFlowIds.includes(flow.id)}
              onChange={(event) => toggleFlow(flow.id, event.target.checked)}
            />
            {flow.name}
          </label>
        ))}
      </div>
    </fieldset>
  );
}

function ScenarioFormHeader({ editing }: Readonly<{ editing: boolean }>) {
  return (
    <div>
      <h4 className="text-sm font-medium">
        {editing ? "Edit scenario" : "Add a job-move scenario"}
      </h4>
      <p className="text-xs text-muted-foreground">
        Every value here is hypothetical. Saving it does not change accepted
        salary history.
      </p>
    </div>
  );
}

function ScenarioFormNotes({ unemployed }: Readonly<{ unemployed: boolean }>) {
  return (
    <>
      {unemployed && (
        <p className="rounded-md bg-muted/50 p-3 text-xs text-muted-foreground">
          This models income stopping indefinitely. Quitting, redundancy, and
          dismissal use the same forecast. Add notice pay, severance, or
          benefits as separate forecast cash flows when they apply.
        </p>
      )}
      <p className="text-xs text-muted-foreground">
        Base and variable pay are annual assumptions. Pension rates apply to
        their total. The forecast smooths pay and pensions into monthly cash
        flows. It assumes no other taxable income, standard National Insurance
        category A, and no company director treatment.
      </p>
    </>
  );
}

function ScenarioFormActions({
  onCancel,
  saving,
}: Readonly<{ onCancel(): void; saving: boolean }>) {
  return (
    <div className="flex gap-2">
      <Button type="submit" size="sm" disabled={saving}>
        {saving ? "Saving…" : "Save scenario"}
      </Button>
      <Button type="button" size="sm" variant="ghost" onClick={onCancel}>
        Cancel
      </Button>
    </div>
  );
}

function ScenarioForm({
  editing,
  onCancel,
  onSaved,
}: Readonly<{
  editing: JobMoveScenario | null;
  onCancel(): void;
  onSaved(id?: string): void;
}>) {
  const model = useScenarioForm(editing, onSaved);
  return (
    <form onSubmit={model.submit} className="space-y-4 rounded-lg border p-4">
      <ScenarioFormHeader editing={editing != null} />
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        <ScenarioIdentityFields draft={model.draft} update={model.update} />
        {model.draft.employmentStatus === "employed" && (
          <>
            <RolePayFields draft={model.draft} update={model.update} />
            <PensionFields draft={model.draft} update={model.update} />
            <AccountFields
              accounts={model.openAccounts}
              draft={model.draft}
              update={model.update}
            />
          </>
        )}
      </div>
      <FlowSelection
        draft={model.draft}
        flows={model.tracker.recurringFlows}
        toggleFlow={model.toggleFlow}
      />
      <ScenarioFormNotes
        unemployed={model.draft.employmentStatus === "unemployed"}
      />
      {model.error != null && (
        <p role="alert" className="text-sm text-destructive">
          {model.error}
        </p>
      )}
      <ScenarioFormActions
        onCancel={onCancel}
        saving={model.state === "saving"}
      />
    </form>
  );
}

function formatFiDate(date: string | null) {
  return date == null ? "Not sustained in this horizon" : date.slice(0, 7);
}

function payFrequencyLabel(frequency: SalaryPayFrequency) {
  if (frequency === "fourWeekly") return "Every four weeks";
  return frequency[0]?.toUpperCase() + frequency.slice(1);
}

function assumptionRows(
  scenario: JobMoveScenario,
  flowNames: ReadonlyMap<string, string>,
) {
  const rows: Array<[string, string]> = [
    ["Current income stops from", scenario.transitionDate],
    [
      "Current-role flows replaced",
      scenario.replacedRecurringFlowIds
        .map((id) => flowNames.get(id) ?? id)
        .join(", "),
    ],
  ];
  if (scenario.annualSpendingOverride != null) {
    rows.push([
      "Annual spending in scenario",
      formatCurrency(scenario.annualSpendingOverride, scenario.currency),
    ]);
  }
  if (scenario.employmentStatus === "employed") {
    rows.push(
      ["Prospective employer", scenario.employer ?? "Not entered"],
      ["New role starts", scenario.roleStartDate ?? "Not entered"],
      [
        "Annual base gross",
        formatCurrency(scenario.baseGrossPay, scenario.currency),
      ],
      [
        "Expected annual variable gross",
        formatCurrency(scenario.variableGrossPay, scenario.currency),
      ],
      ["Pay frequency", payFrequencyLabel(scenario.payFrequency)],
      ["Tax jurisdiction", scenario.jurisdiction],
      [
        "Employee pension",
        `${(scenario.employeePensionRate * 100).toFixed(1)}% by ${scenario.employeePensionMethod === "salarySacrifice" ? "salary sacrifice" : "net pay"}`,
      ],
      [
        "Employer pension",
        `${(scenario.employerPensionRate * 100).toFixed(1)}%`,
      ],
    );
    if (scenario.annualTakeHomeOverride != null) {
      rows.push([
        "Annual take-home fallback",
        formatCurrency(scenario.annualTakeHomeOverride, scenario.currency),
      ]);
    }
  }
  return rows;
}

function AssumptionSummary({
  scenario,
}: Readonly<{ scenario: JobMoveScenario }>) {
  const tracker = useAssetTracker();
  const flowNames = new Map(
    tracker.recurringFlows.map(({ id, name }) => [id, name]),
  );
  const rows = assumptionRows(scenario, flowNames);
  return (
    <details className="rounded-md border p-3">
      <summary className="cursor-pointer text-xs font-medium">
        Review hypothetical inputs
      </summary>
      <dl className="mt-3 grid gap-x-4 gap-y-2 text-xs sm:grid-cols-2">
        {rows.map(([label, value]) => (
          <div key={label}>
            <dt className="text-muted-foreground">{label}</dt>
            <dd>{value}</dd>
          </div>
        ))}
      </dl>
    </details>
  );
}

type ComparisonPoint = JobMoveScenarioComparison["timeline"][number];

function comparisonCardRows(
  comparison: JobMoveScenarioComparison,
  currency: (typeof SUPPORTED_CURRENCIES)[number],
  horizon: ComparisonPoint,
) {
  const pensionTotal =
    comparison.compensation.scenarioAnnualEmployeePensionContribution +
    comparison.compensation.scenarioAnnualEmployerPensionContribution;
  return [
    [
      "Monthly take-home",
      comparison.compensation.baselineAnnualTakeHomePay == null
        ? "Unavailable"
        : formatCurrency(
            comparison.compensation.baselineAnnualTakeHomePay / 12,
            comparison.compensation.currency,
          ),
      formatCurrency(
        comparison.compensation.scenarioAnnualTakeHomePay / 12,
        comparison.compensation.currency,
      ),
    ],
    [
      "Annual pension",
      comparison.compensation.baselineAnnualPensionContribution == null
        ? "Unavailable"
        : formatCurrency(
            comparison.compensation.baselineAnnualPensionContribution,
            comparison.compensation.currency,
          ),
      formatCurrency(pensionTotal, comparison.compensation.currency),
    ],
    [
      "Net worth at horizon",
      formatCurrency(horizon.baseline.totalBalance, currency),
      formatCurrency(horizon.scenario.totalBalance, currency),
    ],
    [
      "Liquid assets at horizon",
      formatCurrency(horizon.baseline.liquidBalance, currency),
      formatCurrency(horizon.scenario.liquidBalance, currency),
    ],
    [
      "Total runway at horizon",
      `${horizon.baseline.totalMonths.toFixed(1)} months`,
      `${horizon.scenario.totalMonths.toFixed(1)} months`,
    ],
  ];
}

function ComparisonCards({
  comparison,
  currency,
  horizon,
}: Readonly<{
  comparison: JobMoveScenarioComparison;
  currency: (typeof SUPPORTED_CURRENCIES)[number];
  horizon: ComparisonPoint;
}>) {
  const rows = comparisonCardRows(comparison, currency, horizon);
  return (
    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
      {rows.map(([label, baseline, projected]) => (
        <div key={label} className="rounded-md bg-muted/40 p-3 text-xs">
          <p className="text-muted-foreground">{label}</p>
          <p className="mt-1 font-medium">{projected}</p>
          <p className="text-muted-foreground">Baseline {baseline}</p>
        </div>
      ))}
    </div>
  );
}

function CalculationPanel({
  calculation,
}: Readonly<{ calculation: JobMoveScenarioComparison["calculation"] }>) {
  if (calculation.kind === "tax-derived") {
    return (
      <p className="mt-1 text-muted-foreground">
        Calculated with {calculation.taxYear} reviewed rules, calculation{" "}
        {calculation.calculationVersion}, dataset{" "}
        {calculation.ruleDatasetVersion}.
      </p>
    );
  }
  if (calculation.kind === "manual-override") {
    return (
      <p className="mt-1 text-muted-foreground">
        User-supplied annual take-home override. The shared tax model could not
        calculate this offer: {calculation.reasons.join(" ")}
      </p>
    );
  }
  return (
    <p className="mt-1 text-muted-foreground">
      No replacement employment income or pension contribution is assumed.
    </p>
  );
}

function ComparisonDetails({
  comparison,
}: Readonly<{ comparison: JobMoveScenarioComparison }>) {
  return (
    <div className="grid gap-3 sm:grid-cols-2">
      <div className="rounded-md border p-3 text-xs">
        <p className="font-medium">Sustained FI date</p>
        <p className="mt-1">
          Scenario{" "}
          {formatFiDate(comparison.financialIndependenceDates.scenario)}
        </p>
        <p className="text-muted-foreground">
          Baseline{" "}
          {formatFiDate(comparison.financialIndependenceDates.baseline)}
        </p>
      </div>
      <div className="rounded-md border p-3 text-xs">
        <p className="font-medium">Take-home calculation</p>
        <CalculationPanel calculation={comparison.calculation} />
      </div>
    </div>
  );
}

function ComparisonHeader({
  horizonYears,
  setHorizonYears,
  transitionDate,
}: Readonly<{
  horizonYears: number;
  setHorizonYears(value: number): void;
  transitionDate: string;
}>) {
  return (
    <div className="flex flex-wrap items-start justify-between gap-3">
      <div>
        <h4 className="text-sm font-medium">Baseline comparison</h4>
        <p className="text-xs text-muted-foreground">
          The selected horizon starts when current income stops on{" "}
          {format(parseISO(transitionDate), "d MMM yyyy")}. Both paths use the
          same assumptions up to that date.
        </p>
      </div>
      <select
        aria-label="Job-move comparison horizon"
        className="h-8 rounded-md border bg-background px-2 text-xs"
        value={horizonYears}
        onChange={(event) => setHorizonYears(Number(event.target.value))}
      >
        {HORIZONS.map((years) => (
          <option key={years} value={years}>
            {years} {years === 1 ? "year" : "years"}
          </option>
        ))}
      </select>
    </div>
  );
}

function Comparison({ scenario }: Readonly<{ scenario: JobMoveScenario }>) {
  const tracker = useAssetTracker();
  const [horizonYears, setHorizonYears] = useState(
    scenario.employmentStatus === "unemployed" ? 10 : 5,
  );
  const comparison = useMemo(
    () => tracker.compareJobMoveScenario(scenario.id, horizonYears * 12),
    [horizonYears, scenario.id, tracker.compareJobMoveScenario],
  );
  const horizon = comparison.timeline.at(-1);
  if (horizon == null) {
    return (
      <p className="rounded-md border border-dashed p-4 text-sm text-muted-foreground">
        Add reconciled spending and current account values to compare this
        scenario.
      </p>
    );
  }
  return (
    <div className="space-y-4 rounded-lg border p-4">
      <ComparisonHeader
        horizonYears={horizonYears}
        setHorizonYears={setHorizonYears}
        transitionDate={scenario.transitionDate}
      />
      <ComparisonCards
        comparison={comparison}
        currency={tracker.baseCurrency}
        horizon={horizon}
      />
      <JobMoveScenarioCharts
        comparison={comparison}
        currency={tracker.baseCurrency}
      />
      <p className="text-xs text-muted-foreground">
        Monthly spending draws from every asset account in liquidity order. Cash
        goes first, then other liquid accounts, then illiquid assets. The charts
        combine balances across the current household view.
      </p>
      <AssumptionSummary scenario={scenario} />
      <ComparisonDetails comparison={comparison} />
      {comparison.warnings.map((warning) => (
        <p
          key={warning}
          className="rounded-md border border-amber-500/40 bg-amber-500/10 p-3 text-xs"
        >
          {warning}
        </p>
      ))}
    </div>
  );
}

function useJobMoveManager() {
  const tracker = useAssetTracker();
  const [editingId, setEditingId] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState(
    tracker.jobMoveScenarios[0]?.id ?? "",
  );
  const [actionError, setActionError] = useState<string | null>(null);
  const editing =
    editingId == null || editingId === "new"
      ? null
      : (tracker.jobMoveScenarios.find(({ id }) => id === editingId) ?? null);
  const selected =
    tracker.jobMoveScenarios.find(({ id }) => id === selectedId) ??
    tracker.jobMoveScenarios[0];
  const run = async (action: () => Promise<void>) => {
    setActionError(null);
    try {
      await action();
    } catch (cause) {
      setActionError(formatAssetTrackerError(cause));
    }
  };
  return {
    actionError,
    editing,
    editingId,
    run,
    selected,
    selectedId,
    setEditingId,
    setSelectedId,
    tracker,
  };
}

function ManagerHeader({
  adding,
  onAdd,
}: Readonly<{ adding: boolean; onAdd(): void }>) {
  return (
    <div className="flex flex-wrap items-start justify-between gap-3">
      <div>
        <h3 id="job-move-heading" className="text-sm font-medium">
          Job moves and income loss
        </h3>
        <p className="text-xs text-muted-foreground">
          Compare offers or an open-ended period without employment. These are
          local assumptions, never observed salary records.
        </p>
      </div>
      {!adding && (
        <Button size="sm" onClick={onAdd}>
          Add scenario
        </Button>
      )}
    </div>
  );
}

function ScenarioCardActions({
  name,
  onDelete,
  onDuplicate,
  onEdit,
}: Readonly<{
  name: string;
  onDelete(): void;
  onDuplicate(): void;
  onEdit(): void;
}>) {
  return (
    <div className="mt-3 flex gap-1">
      <Button
        type="button"
        variant="ghost"
        size="icon-sm"
        aria-label={`Edit ${name}`}
        onClick={onEdit}
      >
        <PencilIcon />
      </Button>
      <Button
        type="button"
        variant="ghost"
        size="icon-sm"
        aria-label={`Duplicate ${name}`}
        onClick={onDuplicate}
      >
        <CopyIcon />
      </Button>
      <Button
        type="button"
        variant="ghost"
        size="icon-sm"
        aria-label={`Delete ${name}`}
        onClick={onDelete}
      >
        <Trash2Icon />
      </Button>
    </div>
  );
}

function ScenarioCard({
  scenario,
  selected,
  onDelete,
  onDuplicate,
  onEdit,
  onSelect,
}: Readonly<{
  scenario: JobMoveScenario;
  selected: boolean;
  onDelete(): void;
  onDuplicate(): void;
  onEdit(): void;
  onSelect(): void;
}>) {
  const description =
    scenario.employmentStatus === "unemployed"
      ? `No replacement role from ${scenario.transitionDate}`
      : `${scenario.employer} from ${scenario.roleStartDate}`;
  return (
    <article
      className={`rounded-md border p-3 ${selected ? "border-primary" : ""}`}
    >
      <button type="button" className="w-full text-left" onClick={onSelect}>
        <div className="flex flex-wrap items-center gap-2">
          <p className="font-medium">{scenario.name}</p>
          <Badge variant="outline">Hypothetical</Badge>
        </div>
        <p className="mt-1 text-xs text-muted-foreground">{description}</p>
      </button>
      <ScenarioCardActions
        name={scenario.name}
        onEdit={onEdit}
        onDuplicate={onDuplicate}
        onDelete={onDelete}
      />
    </article>
  );
}

function ScenarioCards({
  model,
}: Readonly<{ model: ReturnType<typeof useJobMoveManager> }>) {
  if (model.tracker.jobMoveScenarios.length === 0) {
    return model.editingId == null ? (
      <p className="rounded-md border border-dashed p-4 text-sm text-muted-foreground">
        No hypothetical job moves yet.
      </p>
    ) : null;
  }
  return (
    <div className="grid gap-3 sm:grid-cols-2">
      {model.tracker.jobMoveScenarios.map((scenario) => (
        <ScenarioCard
          key={scenario.id}
          scenario={scenario}
          selected={model.selected?.id === scenario.id}
          onSelect={() => model.setSelectedId(scenario.id)}
          onEdit={() => model.setEditingId(scenario.id)}
          onDuplicate={() =>
            void model.run(() =>
              model.tracker.duplicateJobMoveScenario(scenario.id),
            )
          }
          onDelete={() =>
            void model.run(async () => {
              await model.tracker.deleteJobMoveScenario(scenario.id);
              if (model.selectedId === scenario.id) model.setSelectedId("");
            })
          }
        />
      ))}
    </div>
  );
}

export function JobMoveScenarioManager() {
  const model = useJobMoveManager();
  return (
    <section className="space-y-4" aria-labelledby="job-move-heading">
      <ManagerHeader
        adding={model.editingId != null}
        onAdd={() => model.setEditingId("new")}
      />
      {model.editingId != null && (
        <ScenarioForm
          key={`form:${model.editingId}`}
          editing={model.editing}
          onCancel={() => model.setEditingId(null)}
          onSaved={(id) => {
            if (id != null) model.setSelectedId(id);
            model.setEditingId(null);
          }}
        />
      )}
      <ScenarioCards model={model} />
      {model.actionError != null && (
        <p role="alert" className="text-sm text-destructive">
          {model.actionError}
        </p>
      )}
      {model.selected != null && (
        <Comparison
          key={`comparison:${model.selected.id}`}
          scenario={model.selected}
        />
      )}
    </section>
  );
}
