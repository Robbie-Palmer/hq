"use client";

import {
  addMonths,
  differenceInCalendarMonths,
  format,
  parseISO,
} from "date-fns";
import { CopyIcon, PencilIcon, Trash2Icon } from "lucide-react";
import { type ReactNode, type SubmitEvent, useMemo, useState } from "react";
import {
  annualisedGrossPay,
  formatAssetTrackerError,
  type JobMoveScenario,
  type JobMoveScenarioComparison,
  type JobMoveScenarioInput,
  ownershipLabel,
  ownershipShare,
  personalOwnership,
  type SalaryPayFrequency,
  SUPPORTED_CURRENCIES,
} from "@/app/_projects/personal-finance-app/domain";
import {
  formatCurrency,
  todayIsoDate,
} from "@/app/_projects/personal-finance-app/lib";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useAssetTracker } from "./asset-tracker-provider";
import { JobMoveScenarioCharts } from "./job-move-scenario-charts";

const HORIZONS = [1, 3, 5, 10, 15, 20] as const;

function jobLossAnchorDate(valuationDate: string | null): string {
  const today = todayIsoDate();
  return valuationDate != null && valuationDate > today ? valuationDate : today;
}

function scenarioAtTransitionDate(
  scenario: JobMoveScenario,
  transitionDate: string,
): JobMoveScenario {
  return {
    ...scenario,
    transitionDate,
    currentRole:
      scenario.currentRole == null
        ? undefined
        : { ...scenario.currentRole, activeTo: transitionDate },
  };
}

type Draft = {
  name: string;
  householdMemberId: string;
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
  currentEmployer: string;
  currentAnnualTakeHomePay?: number;
  currentBaseGrossPay?: number;
  currentVariableGrossPay?: number;
  currentEmployeePensionContribution?: number;
  currentEmployerPensionContribution?: number;
  currentCurrency: (typeof SUPPORTED_CURRENCIES)[number];
  currentJurisdiction: string;
  currentRoleStart: string;
  destinationAccountId: string;
  pensionAccountId: string;
  replacedRecurringFlowIds: string[];
  includedFutureCashFlowIds: string[];
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

type Tracker = ReturnType<typeof useAssetTracker>;

function recurringFlowOwnership(tracker: Tracker, flowId: string) {
  return (
    tracker.recurringFlowOwnership[flowId] ??
    personalOwnership(tracker.household.members[0]?.id ?? "primary")
  );
}

function compensationFlowIdsForMember(
  tracker: Tracker,
  memberId: string,
): string[] {
  return tracker.recurringFlows
    .filter(
      (flow) =>
        ownershipShare(recurringFlowOwnership(tracker, flow.id), memberId) >
          0 && flow.compensationKind != null,
    )
    .map(({ id }) => id);
}

function scenarioDraft(
  scenario: JobMoveScenario,
  defaultMemberId: string,
): Draft {
  return {
    name: scenario.name,
    householdMemberId: scenario.householdMemberId ?? defaultMemberId,
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
    currentEmployer: scenario.currentRole?.employer ?? "",
    currentAnnualTakeHomePay: scenario.currentRole?.annualTakeHomePay,
    currentBaseGrossPay: scenario.currentRole?.baseGrossPay,
    currentVariableGrossPay: scenario.currentRole?.variableGrossPay,
    currentEmployeePensionContribution:
      scenario.currentRole?.annualEmployeePensionContribution,
    currentEmployerPensionContribution:
      scenario.currentRole?.annualEmployerPensionContribution,
    currentCurrency: scenario.currentRole?.currency ?? scenario.currency,
    currentJurisdiction:
      scenario.currentRole?.jurisdiction ?? scenario.jurisdiction,
    currentRoleStart: scenario.currentRole?.activeFrom ?? "",
    destinationAccountId: scenario.destinationAccountId ?? "",
    pensionAccountId: scenario.pensionAccountId ?? "",
    replacedRecurringFlowIds: scenario.replacedRecurringFlowIds,
    includedFutureCashFlowIds: scenario.includedFutureCashFlowIds ?? [],
  };
}

function inputFromDraft(draft: Draft): JobMoveScenarioInput {
  const currentRole =
    draft.currentEmployer.trim() === "" ||
    draft.currentAnnualTakeHomePay == null ||
    draft.currentRoleStart === ""
      ? undefined
      : {
          employer: draft.currentEmployer,
          annualTakeHomePay: draft.currentAnnualTakeHomePay,
          baseGrossPay: draft.currentBaseGrossPay,
          variableGrossPay: draft.currentVariableGrossPay,
          annualEmployeePensionContribution:
            draft.currentEmployeePensionContribution ?? 0,
          annualEmployerPensionContribution:
            draft.currentEmployerPensionContribution ?? 0,
          currency: draft.currentCurrency,
          jurisdiction: draft.currentJurisdiction,
          activeFrom: draft.currentRoleStart,
          activeTo: draft.transitionDate,
        };
  const scenario = {
    name: draft.name,
    householdMemberId: draft.householdMemberId,
    employmentStatus: draft.employmentStatus,
    transitionDate: draft.transitionDate,
    roleStartDate: draft.roleStartDate,
    employer: draft.employer,
    baseGrossPay: draft.baseGrossPay,
    variableGrossPay: draft.variableGrossPay,
    payFrequency: draft.payFrequency,
    currency: draft.currency,
    jurisdiction: draft.jurisdiction,
    employeePensionRate: draft.employeePensionRate,
    employeePensionMethod: draft.employeePensionMethod,
    employerPensionRate: draft.employerPensionRate,
    annualTakeHomeOverride: draft.annualTakeHomeOverride,
    annualSpendingOverride: draft.annualSpendingOverride,
    currentRole,
    destinationAccountId: draft.destinationAccountId,
    pensionAccountId: draft.pensionAccountId,
    includedFutureCashFlowIds: draft.includedFutureCashFlowIds,
    replacedRecurringFlowIds: draft.replacedRecurringFlowIds,
  };
  if (draft.employmentStatus === "unemployed") {
    return {
      ...scenario,
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
    ...scenario,
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
  const defaultMemberId =
    tracker.household.activeScope.kind === "member"
      ? tracker.household.activeScope.memberId
      : (tracker.household.members[0]?.id ?? "");
  const openAccounts = tracker.accountDetails.filter(({ isOpen }) => isOpen);
  const defaultIncomeAccount =
    openAccounts.find(({ assetType }) => assetType === "cash")?.id ?? "";
  const defaultPensionAccount =
    openAccounts.find(({ name }) => /pension/i.test(name))?.id ?? "";
  const defaultFlowIds = compensationFlowIdsForMember(tracker, defaultMemberId);
  const currentSalary = (tracker.currentSalaryHistory ?? []).at(-1);
  const currentCompensation =
    tracker.financialIndependence?.currentCompensation;
  const [draft, setDraft] = useState<Draft>(() =>
    editing == null
      ? {
          name: "",
          householdMemberId: defaultMemberId,
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
          currentEmployer: currentSalary?.employer ?? "",
          currentAnnualTakeHomePay: currentCompensation?.annualTakeHomeIncome,
          currentBaseGrossPay:
            currentSalary == null
              ? undefined
              : (currentSalary.baseSalary ??
                annualisedGrossPay(currentSalary) ??
                undefined),
          currentVariableGrossPay: currentSalary?.variablePay,
          currentEmployeePensionContribution:
            currentCompensation?.annualEmployeePensionContribution,
          currentEmployerPensionContribution:
            currentCompensation?.annualEmployerPensionContribution,
          currentCurrency: currentSalary?.currency ?? tracker.baseCurrency,
          currentJurisdiction: currentSalary?.jurisdiction ?? "England",
          currentRoleStart:
            currentSalary?.effectiveStart ?? tracker.valuationDate ?? "",
          destinationAccountId: defaultIncomeAccount,
          pensionAccountId: defaultPensionAccount,
          replacedRecurringFlowIds: defaultFlowIds,
          includedFutureCashFlowIds: [],
        }
      : scenarioDraft(editing, defaultMemberId),
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
  const toggleFutureCashFlow = (id: string, checked: boolean) =>
    update(
      "includedFutureCashFlowIds",
      checked
        ? Array.from(new Set([...draft.includedFutureCashFlowIds, id]))
        : draft.includedFutureCashFlowIds.filter(
            (candidate) => candidate !== id,
          ),
    );
  const selectMember = (memberId: string) =>
    setDraft((current) => ({
      ...current,
      householdMemberId: memberId,
      replacedRecurringFlowIds: compensationFlowIdsForMember(tracker, memberId),
    }));
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
    selectMember,
    toggleFlow,
    toggleFutureCashFlow,
    tracker,
    update,
  };
}

function HouseholdMemberField({
  members,
  selectMember,
  value,
}: Readonly<{
  members: Tracker["household"]["members"];
  selectMember(memberId: string): void;
  value: string;
}>) {
  return (
    <Field id="job-household-member" label="Whose employment changes?">
      <select
        id="job-household-member"
        required
        className="h-9 w-full rounded-md border bg-background px-3 text-sm"
        value={value}
        onChange={(event) => selectMember(event.target.value)}
      >
        {members.map((member) => (
          <option key={member.id} value={member.id}>
            {member.displayName}
          </option>
        ))}
      </select>
    </Field>
  );
}

function ScenarioIdentityFields({
  draft,
  members,
  selectMember,
  update,
}: Readonly<{
  draft: Draft;
  members: Tracker["household"]["members"];
  selectMember(memberId: string): void;
  update: DraftUpdate;
}>) {
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
      <HouseholdMemberField
        members={members}
        selectMember={selectMember}
        value={draft.householdMemberId}
      />
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

function OptionalMoneyField({
  id,
  label,
  onChange,
  value,
}: Readonly<{
  id: string;
  label: string;
  onChange(value: number | undefined): void;
  value?: number;
}>) {
  return (
    <Field id={id} label={label}>
      <Input
        id={id}
        type="number"
        min="0"
        step="0.01"
        value={value ?? ""}
        onChange={(event) =>
          onChange(
            event.target.value === "" ? undefined : Number(event.target.value),
          )
        }
      />
    </Field>
  );
}

function CurrentRoleIdentityFields({
  draft,
  update,
}: Readonly<{ draft: Draft; update: DraftUpdate }>) {
  return (
    <>
      <Field id="current-role-employer" label="Current employer">
        <Input
          id="current-role-employer"
          value={draft.currentEmployer}
          onChange={(event) => update("currentEmployer", event.target.value)}
        />
      </Field>
      <Field id="current-role-start" label="Current role started">
        <Input
          id="current-role-start"
          type="date"
          value={draft.currentRoleStart}
          onChange={(event) => update("currentRoleStart", event.target.value)}
        />
      </Field>
    </>
  );
}

function CurrentRoleCompensationFields({
  draft,
  update,
}: Readonly<{ draft: Draft; update: DraftUpdate }>) {
  return (
    <>
      <OptionalMoneyField
        id="current-role-take-home"
        label="Annual take-home pay"
        value={draft.currentAnnualTakeHomePay}
        onChange={(value) => update("currentAnnualTakeHomePay", value)}
      />
      <OptionalMoneyField
        id="current-role-base-gross"
        label="Current annual base gross"
        value={draft.currentBaseGrossPay}
        onChange={(value) => update("currentBaseGrossPay", value)}
      />
      <OptionalMoneyField
        id="current-role-variable-gross"
        label="Annual variable gross"
        value={draft.currentVariableGrossPay}
        onChange={(value) => update("currentVariableGrossPay", value)}
      />
      <OptionalMoneyField
        id="current-role-employee-pension"
        label="Annual employee pension"
        value={draft.currentEmployeePensionContribution}
        onChange={(value) =>
          update("currentEmployeePensionContribution", value)
        }
      />
      <OptionalMoneyField
        id="current-role-employer-pension"
        label="Annual employer pension"
        value={draft.currentEmployerPensionContribution}
        onChange={(value) =>
          update("currentEmployerPensionContribution", value)
        }
      />
    </>
  );
}

function CurrentRoleContextFields({
  draft,
  update,
}: Readonly<{ draft: Draft; update: DraftUpdate }>) {
  return (
    <>
      <Field id="current-role-currency" label="Current role currency">
        <select
          id="current-role-currency"
          className="h-9 w-full rounded-md border bg-background px-3 text-sm"
          value={draft.currentCurrency}
          onChange={(event) =>
            update(
              "currentCurrency",
              event.target.value as Draft["currentCurrency"],
            )
          }
        >
          {SUPPORTED_CURRENCIES.map((currency) => (
            <option key={currency} value={currency}>
              {currency}
            </option>
          ))}
        </select>
      </Field>
      <Field id="current-role-jurisdiction" label="Current role jurisdiction">
        <Input
          id="current-role-jurisdiction"
          value={draft.currentJurisdiction}
          onChange={(event) =>
            update("currentJurisdiction", event.target.value)
          }
        />
      </Field>
    </>
  );
}

function CurrentRoleFields(
  props: Readonly<{ draft: Draft; update: DraftUpdate }>,
) {
  return (
    <details className="rounded-md border p-3 sm:col-span-2 lg:col-span-3">
      <summary className="cursor-pointer text-xs font-medium">
        Current role facts
      </summary>
      <p className="mt-2 text-xs text-muted-foreground">
        Record these facts explicitly. The comparison uses flow IDs only to
        route money, never a flow name to infer employment.
      </p>
      <div className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        <CurrentRoleIdentityFields {...props} />
        <CurrentRoleCompensationFields {...props} />
        <CurrentRoleContextFields {...props} />
      </div>
    </details>
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
  tracker,
  toggleFlow,
}: Readonly<{
  draft: Draft;
  flows: ReturnType<typeof useAssetTracker>["recurringFlows"];
  tracker: Tracker;
  toggleFlow(id: string, checked: boolean): void;
}>) {
  const memberFlows = flows.filter(
    (flow) =>
      ownershipShare(
        recurringFlowOwnership(tracker, flow.id),
        draft.householdMemberId,
      ) > 0,
  );
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
        {memberFlows.map((flow) => (
          <label key={flow.id} className="flex items-center gap-2 text-xs">
            <input
              type="checkbox"
              aria-label={`${flow.name} · ${ownershipLabel(
                recurringFlowOwnership(tracker, flow.id),
                tracker.household.members,
              )}`}
              checked={draft.replacedRecurringFlowIds.includes(flow.id)}
              onChange={(event) => toggleFlow(flow.id, event.target.checked)}
            />
            <span>
              {flow.name}
              <span className="text-muted-foreground">
                {` · ${ownershipLabel(
                  recurringFlowOwnership(tracker, flow.id),
                  tracker.household.members,
                )}`}
              </span>
            </span>
          </label>
        ))}
      </div>
    </fieldset>
  );
}

function PathCashFlowSelection({
  cashFlows,
  draft,
  toggle,
}: Readonly<{
  cashFlows: Tracker["futureCashFlows"];
  draft: Draft;
  toggle(id: string, checked: boolean): void;
}>) {
  if (cashFlows.length === 0) return null;
  return (
    <fieldset className="space-y-2">
      <legend className="text-xs font-medium">
        Receipts and payments in this path
      </legend>
      <p className="text-xs text-muted-foreground">
        Choose generic cash-flow records such as redundancy cash, notice pay,
        benefits, or one-off costs. They stay out of the employed baseline and
        other saved paths.
      </p>
      <div className="grid gap-2 sm:grid-cols-2">
        {cashFlows.map((cashFlow) => (
          <label key={cashFlow.id} className="flex items-center gap-2 text-xs">
            <input
              type="checkbox"
              checked={draft.includedFutureCashFlowIds.includes(cashFlow.id)}
              onChange={(event) => toggle(cashFlow.id, event.target.checked)}
            />
            <span>{cashFlow.name}</span>
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
        <ScenarioIdentityFields
          draft={model.draft}
          members={model.tracker.household.members}
          selectMember={model.selectMember}
          update={model.update}
        />
        <CurrentRoleFields draft={model.draft} update={model.update} />
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
        tracker={model.tracker}
        toggleFlow={model.toggleFlow}
      />
      <PathCashFlowSelection
        cashFlows={model.tracker.futureCashFlows ?? []}
        draft={model.draft}
        toggle={model.toggleFutureCashFlow}
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
  memberNames: ReadonlyMap<string, string>,
  cashFlowNames: ReadonlyMap<string, string>,
) {
  const rows: Array<[string, string]> = [
    [
      "Household member",
      scenario.householdMemberId == null
        ? "Not assigned (legacy scenario)"
        : (memberNames.get(scenario.householdMemberId) ??
          scenario.householdMemberId),
    ],
    ["Current income stops from", scenario.transitionDate],
    [
      "Current-role flows replaced",
      scenario.replacedRecurringFlowIds
        .map((id) => flowNames.get(id) ?? id)
        .join(", "),
    ],
  ];
  if (scenario.currentRole != null) {
    rows.push(
      ["Current employer", scenario.currentRole.employer],
      [
        "Current role dates",
        `${scenario.currentRole.activeFrom} to ${scenario.currentRole.activeTo}`,
      ],
      [
        "Current annual take-home",
        formatCurrency(
          scenario.currentRole.annualTakeHomePay,
          scenario.currentRole.currency,
        ),
      ],
      ["Current role jurisdiction", scenario.currentRole.jurisdiction],
    );
  }
  if ((scenario.includedFutureCashFlowIds?.length ?? 0) > 0) {
    rows.push([
      "Path-only receipts and payments",
      (scenario.includedFutureCashFlowIds ?? [])
        .map((id) => cashFlowNames.get(id) ?? id)
        .join(", "),
    ]);
  }
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
  const memberNames = new Map(
    tracker.household.members.map(({ id, displayName }) => [id, displayName]),
  );
  const cashFlowNames = new Map(
    (tracker.futureCashFlows ?? []).map(({ id, name }) => [id, name]),
  );
  const rows = assumptionRows(scenario, flowNames, memberNames, cashFlowNames);
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
      "Cash at horizon",
      formatCurrency(horizon.baseline.cashBalance, currency),
      formatCurrency(horizon.scenario.cashBalance, currency),
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
      "Accessible retirement capital",
      formatCurrency(
        horizon.baseline.accessibleRetirementCapital ??
          horizon.baseline.liquidBalance,
        currency,
      ),
      formatCurrency(
        horizon.scenario.accessibleRetirementCapital ??
          horizon.scenario.liquidBalance,
        currency,
      ),
    ],
    [
      "Pension capital",
      formatCurrency(horizon.baseline.pensionCapital ?? 0, currency),
      formatCurrency(horizon.scenario.pensionCapital ?? 0, currency),
    ],
    [
      "Reserve coverage",
      horizon.baseline.emergencyFundMonths == null
        ? "Unavailable"
        : `${horizon.baseline.emergencyFundMonths.toFixed(1)} months`,
      horizon.scenario.emergencyFundMonths == null
        ? "Unavailable"
        : `${horizon.scenario.emergencyFundMonths.toFixed(1)} months`,
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
    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
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
  spendingLabel,
  transitionDate,
}: Readonly<{
  horizonYears: number;
  setHorizonYears(value: number): void;
  spendingLabel: string;
  transitionDate: string;
}>) {
  return (
    <div className="flex flex-wrap items-start justify-between gap-3">
      <div>
        <div className="flex flex-wrap items-center gap-2">
          <h4 className="text-sm font-medium">Baseline comparison</h4>
          <Badge
            variant={
              spendingLabel.startsWith("Manual") ? "secondary" : "outline"
            }
          >
            {spendingLabel}
          </Badge>
        </div>
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

function timingPoint(
  comparison: JobMoveScenarioComparison,
): ComparisonPoint | undefined {
  return comparison.timeline.at(-1);
}

function JobLossTimingHeader({ onPreset }: Readonly<{ onPreset(): void }>) {
  return (
    <div className="flex flex-wrap items-start justify-between gap-2">
      <div>
        <h5 className="text-xs font-medium">Compare job-loss timing</h5>
        <p className="text-xs text-muted-foreground">
          Both options are measured on the same end date, so the difference
          comes from how long household income continues before the job ends.
        </p>
      </div>
      <Button type="button" size="sm" variant="outline" onClick={onPreset}>
        Compare 1 month vs 3 months
      </Button>
    </div>
  );
}

function JobLossDateField({
  id,
  label,
  onChange,
  value,
}: Readonly<{
  id: string;
  label: string;
  onChange(value: string): void;
  value: string;
}>) {
  return (
    <Field id={id} label={label}>
      <Input
        id={id}
        type="date"
        value={value}
        onChange={(event) => {
          if (event.target.value !== "") onChange(event.target.value);
        }}
      />
    </Field>
  );
}

function JobLossTimingCard({
  currency,
  date,
  point,
}: Readonly<{
  currency: (typeof SUPPORTED_CURRENCIES)[number];
  date: string;
  point: ComparisonPoint;
}>) {
  return (
    <div className="rounded-md bg-background p-3 text-xs">
      <p className="font-medium">
        Job loss {format(parseISO(date), "d MMM yyyy")}
      </p>
      <dl className="mt-2 grid grid-cols-2 gap-x-3 gap-y-1">
        <dt className="text-muted-foreground">Net worth</dt>
        <dd className="text-right">
          {formatCurrency(point.scenario.totalBalance, currency)}
        </dd>
        <dt className="text-muted-foreground">Liquid assets</dt>
        <dd className="text-right">
          {formatCurrency(point.scenario.liquidBalance, currency)}
        </dd>
        <dt className="text-muted-foreground">Total runway</dt>
        <dd className="text-right">
          {point.scenario.totalMonths.toFixed(1)} months
        </dd>
      </dl>
    </div>
  );
}

type JobLossTimingComparisonProps = Readonly<{
  alternativeDate: string;
  horizonYears: number;
  primaryComparison: JobMoveScenarioComparison;
  primaryDate: string;
  scenario: JobMoveScenario;
  setAlternativeDate(value: string): void;
  setPrimaryDate(value: string): void;
}>;

function useJobLossTimingModel({
  alternativeDate,
  horizonYears,
  primaryComparison,
  primaryDate,
  scenario,
  setAlternativeDate,
  setPrimaryDate,
}: JobLossTimingComparisonProps) {
  const tracker = useAssetTracker();
  const commonEndDate = addMonths(parseISO(primaryDate), horizonYears * 12);
  const alternativeHorizonMonths = Math.max(
    1,
    differenceInCalendarMonths(commonEndDate, parseISO(alternativeDate)),
  );
  const alternativeComparison = useMemo(
    () =>
      tracker.compareJobMoveScenario(
        scenarioAtTransitionDate(scenario, alternativeDate),
        alternativeHorizonMonths,
      ),
    [
      alternativeDate,
      alternativeHorizonMonths,
      scenario,
      tracker.compareJobMoveScenario,
    ],
  );
  const valuationDate = jobLossAnchorDate(tracker.valuationDate);
  const usePreset = () => {
    setPrimaryDate(format(addMonths(parseISO(valuationDate), 1), "yyyy-MM-dd"));
    setAlternativeDate(
      format(addMonths(parseISO(valuationDate), 3), "yyyy-MM-dd"),
    );
  };
  return {
    alternative: timingPoint(alternativeComparison),
    currency: tracker.baseCurrency,
    primary: timingPoint(primaryComparison),
    usePreset,
  };
}

function JobLossTimingComparison({
  alternativeDate,
  horizonYears,
  primaryComparison,
  primaryDate,
  scenario,
  setAlternativeDate,
  setPrimaryDate,
}: JobLossTimingComparisonProps) {
  const model = useJobLossTimingModel({
    alternativeDate,
    horizonYears,
    primaryComparison,
    primaryDate,
    scenario,
    setAlternativeDate,
    setPrimaryDate,
  });

  return (
    <section className="space-y-3 rounded-md border bg-muted/20 p-3">
      <JobLossTimingHeader onPreset={model.usePreset} />
      <div className="grid gap-3 sm:grid-cols-2">
        <JobLossDateField
          id="job-loss-primary-date"
          label="Expected job loss date"
          onChange={setPrimaryDate}
          value={primaryDate}
        />
        <JobLossDateField
          id="job-loss-alternative-date"
          label="Compare with job loss on"
          onChange={setAlternativeDate}
          value={alternativeDate}
        />
      </div>
      {model.primary != null && model.alternative != null && (
        <div className="grid gap-3 sm:grid-cols-2">
          <JobLossTimingCard
            currency={model.currency}
            date={primaryDate}
            point={model.primary}
          />
          <JobLossTimingCard
            currency={model.currency}
            date={alternativeDate}
            point={model.alternative}
          />
        </div>
      )}
    </section>
  );
}

function useComparisonModel(scenario: JobMoveScenario) {
  const tracker = useAssetTracker();
  const [horizonYears, setHorizonYears] = useState(
    scenario.employmentStatus === "unemployed" ? 10 : 5,
  );
  const [primaryDate, setPrimaryDate] = useState(scenario.transitionDate);
  const valuationDate = jobLossAnchorDate(tracker.valuationDate);
  const threeMonthsDate = format(
    addMonths(parseISO(valuationDate), 3),
    "yyyy-MM-dd",
  );
  const initialAlternativeDate = format(
    addMonths(parseISO(valuationDate), primaryDate === threeMonthsDate ? 1 : 3),
    "yyyy-MM-dd",
  );
  const [alternativeDate, setAlternativeDate] = useState(
    initialAlternativeDate,
  );
  const scenarioAtDate = useMemo(
    () => scenarioAtTransitionDate(scenario, primaryDate),
    [primaryDate, scenario],
  );
  const comparison = useMemo(
    () => tracker.compareJobMoveScenario(scenarioAtDate, horizonYears * 12),
    [horizonYears, scenarioAtDate, tracker.compareJobMoveScenario],
  );
  return {
    alternativeDate,
    comparison,
    horizonYears,
    primaryDate,
    scenarioAtDate,
    setAlternativeDate,
    setHorizonYears,
    setPrimaryDate,
    spendingLabel: comparisonSpendingLabel(
      scenario,
      tracker.financialIndependence?.spendingBasis.kind,
    ),
    tracker,
  };
}

function comparisonSpendingLabel(
  scenario: JobMoveScenario,
  spendingKind: "manual" | "reconciled" | undefined,
): string {
  if (scenario.annualSpendingOverride != null)
    return "Scenario spending override";
  return spendingKind === "manual" ? "Manual spending" : "Reconciled spending";
}

function Comparison({ scenario }: Readonly<{ scenario: JobMoveScenario }>) {
  const model = useComparisonModel(scenario);
  const { comparison, horizonYears, primaryDate, scenarioAtDate, tracker } =
    model;
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
        setHorizonYears={model.setHorizonYears}
        spendingLabel={model.spendingLabel}
        transitionDate={primaryDate}
      />
      {scenario.employmentStatus === "unemployed" && (
        <JobLossTimingComparison
          alternativeDate={model.alternativeDate}
          horizonYears={horizonYears}
          primaryComparison={comparison}
          primaryDate={primaryDate}
          scenario={scenario}
          setAlternativeDate={model.setAlternativeDate}
          setPrimaryDate={model.setPrimaryDate}
        />
      )}
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
      <AssumptionSummary scenario={scenarioAtDate} />
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

function useJobMoveScenarioControls() {
  const tracker = useAssetTracker();
  const defaultScenario = useMemo<JobMoveScenario>(() => {
    const valuationDate = jobLossAnchorDate(tracker.valuationDate);
    const transitionDate = format(
      addMonths(parseISO(valuationDate), 1),
      "yyyy-MM-dd",
    );
    const householdMemberId =
      tracker.household.activeScope.kind === "member"
        ? tracker.household.activeScope.memberId
        : tracker.household.members[0]?.id;
    const timestamp = `${transitionDate}T00:00:00Z`;
    return {
      id: "default-job-loss",
      name: "Lose my job",
      householdMemberId,
      employmentStatus: "unemployed",
      transitionDate,
      baseGrossPay: 0,
      variableGrossPay: 0,
      payFrequency: "monthly",
      currency: tracker.baseCurrency,
      jurisdiction: "England",
      employeePensionRate: 0,
      employeePensionMethod: "salarySacrifice",
      employerPensionRate: 0,
      replacedRecurringFlowIds:
        householdMemberId == null
          ? []
          : compensationFlowIdsForMember(tracker, householdMemberId),
      createdAt: timestamp,
      updatedAt: timestamp,
    };
  }, [tracker]);
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
    tracker.jobMoveScenarios[0] ??
    defaultScenario;
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
    defaultScenario,
    run,
    selected,
    selectedId,
    setEditingId,
    setSelectedId,
    tracker,
  };
}

function ScenarioPlannerHeader({
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
  controls,
}: Readonly<{ controls: ReturnType<typeof useJobMoveScenarioControls> }>) {
  if (controls.tracker.jobMoveScenarios.length === 0) {
    return controls.editingId == null ? (
      <article className="rounded-md border border-primary p-3">
        <div className="flex flex-wrap items-center gap-2">
          <p className="font-medium">{controls.defaultScenario.name}</p>
          <Badge variant="outline">Default scenario</Badge>
        </div>
        <p className="mt-1 text-xs text-muted-foreground">
          Current employment income stops from{" "}
          {controls.defaultScenario.transitionDate}.
        </p>
      </article>
    ) : null;
  }
  return (
    <div className="grid gap-3 sm:grid-cols-2">
      {controls.tracker.jobMoveScenarios.map((scenario) => (
        <ScenarioCard
          key={scenario.id}
          scenario={scenario}
          selected={controls.selected?.id === scenario.id}
          onSelect={() => controls.setSelectedId(scenario.id)}
          onEdit={() => controls.setEditingId(scenario.id)}
          onDuplicate={() =>
            void controls.run(() =>
              controls.tracker.duplicateJobMoveScenario(scenario.id),
            )
          }
          onDelete={() =>
            void controls.run(async () => {
              await controls.tracker.deleteJobMoveScenario(scenario.id);
              if (controls.selectedId === scenario.id) {
                controls.setSelectedId("");
              }
            })
          }
        />
      ))}
    </div>
  );
}

export function JobMoveScenarioPlanner() {
  const controls = useJobMoveScenarioControls();
  return (
    <section className="space-y-4" aria-labelledby="job-move-heading">
      <ScenarioPlannerHeader
        adding={controls.editingId != null}
        onAdd={() => controls.setEditingId("new")}
      />
      {controls.editingId != null && (
        <ScenarioForm
          key={`form:${controls.editingId}`}
          editing={controls.editing}
          onCancel={() => controls.setEditingId(null)}
          onSaved={(id) => {
            if (id != null) controls.setSelectedId(id);
            controls.setEditingId(null);
          }}
        />
      )}
      <ScenarioCards controls={controls} />
      {controls.actionError != null && (
        <p role="alert" className="text-sm text-destructive">
          {controls.actionError}
        </p>
      )}
      {controls.selected != null && (
        <Comparison
          key={`comparison:${controls.selected.id}`}
          scenario={controls.selected}
        />
      )}
    </section>
  );
}
