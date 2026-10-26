"use client";

import { type Dispatch, type SetStateAction, useId } from "react";
import type {
  Currency,
  GrowthCashFlow,
  GrowthScenario,
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
      value={value * 100}
      onChange={(next) => onChange(next / 100)}
    />
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
      <label className="grid gap-1 text-sm">
        <span>Recurring direction</span>
        <select
          className="h-9 rounded-md border bg-background px-3"
          value={draft.recurringFlow.kind}
          onChange={(event) =>
            patchFlow("recurringFlow", {
              kind: event.target.value as GrowthCashFlow["kind"],
            })
          }
        >
          <option value="contribution">Contribution</option>
          <option value="withdrawal">Withdrawal</option>
        </select>
      </label>
      <label className="grid gap-1 text-sm">
        <span>Recurring frequency</span>
        <select
          className="h-9 rounded-md border bg-background px-3"
          value={draft.recurringFlow.frequency}
          onChange={(event) =>
            patchFlow("recurringFlow", {
              frequency: event.target.value as GrowthCashFlow["frequency"],
            })
          }
        >
          <option value="monthly">Monthly</option>
          <option value="quarterly">Quarterly</option>
          <option value="yearly">Yearly</option>
        </select>
      </label>
      <label className="grid gap-1 text-sm">
        <span>Contribution timing</span>
        <select
          className="h-9 rounded-md border bg-background px-3"
          value={draft.contributionTiming}
          onChange={(event) =>
            patch({
              contributionTiming: event.target
                .value as GrowthScenario["contributionTiming"],
            })
          }
        >
          <option value="beginning">Beginning of period</option>
          <option value="end">End of period</option>
        </select>
      </label>
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
      <label className="grid gap-1 text-sm">
        <span>One-off direction</span>
        <select
          className="h-9 rounded-md border bg-background px-3"
          value={draft.oneOffFlow.kind}
          onChange={(event) =>
            patchFlow("oneOffFlow", {
              kind: event.target.value as GrowthCashFlow["kind"],
            })
          }
        >
          <option value="contribution">Contribution</option>
          <option value="withdrawal">Withdrawal</option>
        </select>
      </label>
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

function ReturnFields({
  draft,
  patch,
}: Readonly<{ draft: PlannerDraft; patch: DraftPatch }>) {
  return (
    <>
      <label className="grid gap-1 text-sm">
        <span>Account wrapper</span>
        <select
          className="h-9 rounded-md border bg-background px-3"
          value={draft.wrapper}
          onChange={(event) =>
            patch({ wrapper: event.target.value as GrowthScenario["wrapper"] })
          }
        >
          <option value="taxable">Taxable</option>
          <option value="isa">ISA</option>
          <option value="pension">Pension</option>
        </select>
      </label>
      <PercentField
        label="Annual return"
        value={draft.annualReturn}
        onChange={(annualReturn) => patch({ annualReturn })}
      />
      <label className="grid gap-1 text-sm">
        <span>Return convention</span>
        <select
          className="h-9 rounded-md border bg-background px-3"
          value={draft.returnConvention.kind}
          onChange={(event) =>
            patch({
              returnConvention:
                event.target.value === "effective-annual"
                  ? { kind: "effective-annual" }
                  : { kind: "nominal-annual", compoundingPeriods: 12 },
            })
          }
        >
          <option value="effective-annual">Effective annual</option>
          <option value="nominal-annual">Nominal annual</option>
        </select>
      </label>
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
      <label className="grid gap-1 text-sm">
        <span>Return type</span>
        <select
          className="h-9 rounded-md border bg-background px-3"
          value={draft.returnType}
          onChange={(event) =>
            patch({
              returnType: event.target.value as GrowthScenario["returnType"],
            })
          }
        >
          <option value="guaranteed-savings">
            Guaranteed savings interest
          </option>
          <option value="uncertain-investment">
            Uncertain investment return
          </option>
        </select>
      </label>
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
