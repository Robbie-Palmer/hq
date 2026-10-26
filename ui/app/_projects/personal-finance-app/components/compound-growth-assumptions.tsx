"use client";

import { type Dispatch, type SetStateAction, useId } from "react";
import type {
  Currency,
  GrowthCashFlow,
} from "@/app/_projects/personal-finance-app/domain";
import { formatCurrency } from "@/app/_projects/personal-finance-app/lib";
import { Input } from "@/components/ui/input";
import type {
  GrowthPlannerAccount,
  PlannerDraft,
} from "./compound-growth-planner-model";

type DraftPatch = (next: Partial<PlannerDraft>) => void;
type FlowPatch = (
  key: "recurringFlow" | "oneOffFlow",
  next: Partial<GrowthCashFlow>,
) => void;

function NumberField({
  label,
  onChange,
  step = "any",
  value,
}: Readonly<{
  label: string;
  onChange: (value: number) => void;
  step?: string;
  value: number;
}>) {
  const id = useId();
  return (
    <label className="grid gap-1 text-sm" htmlFor={id}>
      <span>{label}</span>
      <Input
        id={id}
        type="number"
        step={step}
        value={value}
        onChange={(event) => onChange(Number(event.target.value))}
      />
    </label>
  );
}

function PercentField({
  label,
  onChange,
  value,
}: Readonly<{
  label: string;
  onChange: (value: number) => void;
  value: number;
}>) {
  return (
    <NumberField
      label={label}
      step="0.1"
      value={Number((value * 100).toFixed(6))}
      onChange={(next) => onChange(next / 100)}
    />
  );
}

function SelectField<T extends string>({
  label,
  onChange,
  options,
  value,
}: Readonly<{
  label: string;
  onChange: (value: T) => void;
  options: ReadonlyArray<{ label: string; value: T }>;
  value: T;
}>) {
  return (
    <label className="grid gap-1 text-sm">
      <span>{label}</span>
      <select
        className="h-9 rounded-md border bg-background px-3"
        value={value}
        onChange={(event) => onChange(event.target.value as T)}
      >
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
    </label>
  );
}

function ScenarioFields({
  draft,
  patch,
  patchFlow,
}: Readonly<{
  draft: PlannerDraft;
  patch: DraftPatch;
  patchFlow: FlowPatch;
}>) {
  return (
    <>
      <label className="grid gap-1 text-sm" htmlFor="growth-scenario-name">
        <span>Scenario name</span>
        <Input
          id="growth-scenario-name"
          value={draft.name}
          onChange={(event) => patch({ name: event.target.value })}
        />
      </label>
      <label className="grid gap-1 text-sm" htmlFor="growth-start-date">
        <span>Start date</span>
        <Input
          id="growth-start-date"
          type="date"
          value={draft.startDate}
          onChange={(event) => {
            patch({ startDate: event.target.value });
            patchFlow("recurringFlow", { startDate: event.target.value });
          }}
        />
      </label>
      <NumberField
        label="Standalone principal"
        value={draft.principal}
        onChange={(principal) => patch({ principal })}
      />
      <NumberField
        label="Horizon, months"
        step="1"
        value={draft.horizonMonths}
        onChange={(horizonMonths) => patch({ horizonMonths })}
      />
    </>
  );
}

function RecurringFlowSettings({
  draft,
  patch,
  patchFlow,
}: Readonly<{
  draft: PlannerDraft;
  patch: DraftPatch;
  patchFlow: FlowPatch;
}>) {
  return (
    <>
      <SelectField
        label="Recurring direction"
        value={draft.recurringFlow.kind}
        options={[
          { label: "Contribution", value: "contribution" },
          { label: "Withdrawal", value: "withdrawal" },
        ]}
        onChange={(kind) => patchFlow("recurringFlow", { kind })}
      />
      <SelectField
        label="Recurring frequency"
        value={draft.recurringFlow.frequency}
        options={[
          { label: "Monthly", value: "monthly" },
          { label: "Quarterly", value: "quarterly" },
          { label: "Yearly", value: "yearly" },
        ]}
        onChange={(frequency) => patchFlow("recurringFlow", { frequency })}
      />
      <SelectField
        label="Contribution timing"
        value={draft.contributionTiming}
        options={[
          { label: "Beginning of period", value: "beginning" },
          { label: "End of period", value: "end" },
        ]}
        onChange={(contributionTiming) => patch({ contributionTiming })}
      />
    </>
  );
}

function RecurringFlowFields({
  draft,
  patch,
  patchFlow,
}: Readonly<{
  draft: PlannerDraft;
  patch: DraftPatch;
  patchFlow: FlowPatch;
}>) {
  return (
    <>
      <NumberField
        label="Recurring cash flow"
        value={draft.recurringFlow.amount}
        onChange={(amount) => patchFlow("recurringFlow", { amount })}
      />
      <RecurringFlowSettings
        draft={draft}
        patch={patch}
        patchFlow={patchFlow}
      />
    </>
  );
}

function OneOffFlowFields({
  draft,
  patchFlow,
}: Readonly<{
  draft: PlannerDraft;
  patchFlow: FlowPatch;
}>) {
  return (
    <>
      <NumberField
        label="One-off cash flow"
        value={draft.oneOffFlow.amount}
        onChange={(amount) => patchFlow("oneOffFlow", { amount })}
      />
      <SelectField
        label="One-off direction"
        value={draft.oneOffFlow.kind}
        options={[
          { label: "Contribution", value: "contribution" },
          { label: "Withdrawal", value: "withdrawal" },
        ]}
        onChange={(kind) => patchFlow("oneOffFlow", { kind })}
      />
      <label className="grid gap-1 text-sm" htmlFor="growth-one-off-date">
        <span>One-off date</span>
        <Input
          id="growth-one-off-date"
          type="date"
          value={draft.oneOffFlow.startDate}
          onChange={(event) =>
            patchFlow("oneOffFlow", { startDate: event.target.value })
          }
        />
      </label>
    </>
  );
}

function ReturnConventionFields({
  draft,
  patch,
}: Readonly<{ draft: PlannerDraft; patch: DraftPatch }>) {
  return (
    <>
      <SelectField
        label="Return convention"
        value={draft.returnConvention.kind}
        options={[
          { label: "Effective annual", value: "effective-annual" },
          { label: "Nominal annual", value: "nominal-annual" },
        ]}
        onChange={(kind) =>
          patch({
            returnConvention:
              kind === "effective-annual"
                ? { kind: "effective-annual" }
                : { kind: "nominal-annual", compoundingPeriods: 12 },
          })
        }
      />
      {draft.returnConvention.kind === "nominal-annual" ? (
        <NumberField
          label="Compounds per year"
          step="1"
          value={draft.returnConvention.compoundingPeriods}
          onChange={(compoundingPeriods) =>
            patch({
              returnConvention: {
                kind: "nominal-annual",
                compoundingPeriods,
              },
            })
          }
        />
      ) : null}
    </>
  );
}

function ReturnClassificationFields({
  draft,
  patch,
}: Readonly<{ draft: PlannerDraft; patch: DraftPatch }>) {
  return (
    <>
      <SelectField
        label="Account wrapper"
        value={draft.wrapper}
        options={[
          { label: "Taxable", value: "taxable" },
          { label: "ISA", value: "isa" },
          { label: "Pension", value: "pension" },
        ]}
        onChange={(wrapper) => patch({ wrapper })}
      />
      <PercentField
        label="Annual return"
        value={draft.annualReturn}
        onChange={(annualReturn) => patch({ annualReturn })}
      />
      <SelectField
        label="Return type"
        value={draft.returnType}
        options={[
          {
            label: "Guaranteed savings interest",
            value: "guaranteed-savings",
          },
          {
            label: "Uncertain investment return",
            value: "uncertain-investment",
          },
        ]}
        onChange={(returnType) => patch({ returnType })}
      />
    </>
  );
}

function RateAssumptionFields({
  draft,
  patch,
}: Readonly<{ draft: PlannerDraft; patch: DraftPatch }>) {
  return (
    <>
      <PercentField
        label="Annual fee"
        value={draft.annualFeeRate}
        onChange={(annualFeeRate) => patch({ annualFeeRate })}
      />
      <PercentField
        label="Tax on positive growth"
        value={draft.taxableGrowthTaxRate}
        onChange={(taxableGrowthTaxRate) => patch({ taxableGrowthTaxRate })}
      />
      <PercentField
        label="Future inflation"
        value={draft.futureInflationRate}
        onChange={(futureInflationRate) => patch({ futureInflationRate })}
      />
      <PercentField
        label="Return stress range"
        value={draft.stressReturnDelta}
        onChange={(stressReturnDelta) => patch({ stressReturnDelta })}
      />
      <PercentField
        label="Inflation stress range"
        value={draft.stressInflationDelta}
        onChange={(stressInflationDelta) => patch({ stressInflationDelta })}
      />
    </>
  );
}

function ReturnFields({
  draft,
  patch,
}: Readonly<{ draft: PlannerDraft; patch: DraftPatch }>) {
  return (
    <>
      <ReturnClassificationFields draft={draft} patch={patch} />
      <ReturnConventionFields draft={draft} patch={patch} />
      <RateAssumptionFields draft={draft} patch={patch} />
    </>
  );
}

function HouseholdAccountFields({
  accounts,
  currency,
  draft,
  toggleAccount,
}: Readonly<{
  accounts: readonly GrowthPlannerAccount[];
  currency: Currency;
  draft: PlannerDraft;
  toggleAccount: (accountId: string) => void;
}>) {
  if (accounts.length === 0) return null;
  return (
    <fieldset className="mt-5 grid gap-2">
      <legend className="text-sm font-medium">Link household accounts</legend>
      <p className="text-xs text-muted-foreground">
        Opening balances are added once. Recorded transfers and employer
        contributions need a shared deduplication key when included as cash
        flows.
      </p>
      <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
        {accounts.map((account) => (
          <label key={account.id} className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={draft.selectedAccountIds.includes(account.id)}
              onChange={() => toggleAccount(account.id)}
            />
            <span>
              {account.name} (
              {formatCurrency(account.latestBalance ?? 0, currency)})
            </span>
          </label>
        ))}
      </div>
    </fieldset>
  );
}

export function CompoundGrowthAssumptions({
  accounts,
  currency,
  draft,
  setDraft,
}: Readonly<{
  accounts: readonly GrowthPlannerAccount[];
  currency: Currency;
  draft: PlannerDraft;
  setDraft: Dispatch<SetStateAction<PlannerDraft>>;
}>) {
  const patch: DraftPatch = (next) =>
    setDraft((current) => ({ ...current, ...next }));
  const patchFlow: FlowPatch = (key, next) =>
    setDraft((current) => ({
      ...current,
      [key]: { ...current[key], ...next },
    }));
  const toggleAccount = (accountId: string) =>
    patch({
      selectedAccountIds: draft.selectedAccountIds.includes(accountId)
        ? draft.selectedAccountIds.filter((id) => id !== accountId)
        : [...draft.selectedAccountIds, accountId],
    });

  return (
    <details className="rounded-md border p-4" open>
      <summary className="cursor-pointer font-medium">Assumptions</summary>
      <div className="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <ScenarioFields draft={draft} patch={patch} patchFlow={patchFlow} />
        <RecurringFlowFields
          draft={draft}
          patch={patch}
          patchFlow={patchFlow}
        />
        <OneOffFlowFields draft={draft} patchFlow={patchFlow} />
        <ReturnFields draft={draft} patch={patch} />
      </div>
      <HouseholdAccountFields
        accounts={accounts}
        currency={currency}
        draft={draft}
        toggleAccount={toggleAccount}
      />
    </details>
  );
}
