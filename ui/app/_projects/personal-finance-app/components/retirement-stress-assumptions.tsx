"use client";

import type { Dispatch, ReactNode, SetStateAction } from "react";
import type { RetirementAssumptionSet } from "@/app/_projects/personal-finance-app/domain";
import { Input } from "@/components/ui/input";
import type { RetirementStressDraft } from "./retirement-stress-planner-model";

type DraftSetter = Dispatch<SetStateAction<RetirementStressDraft>>;
type DraftDateKey =
  | "startDate"
  | "plannedRetirementDate"
  | "delayedIncomeStartDate"
  | "pensionAccessDate"
  | "housingReleaseDate";
type DraftNumberKey =
  | "annualSpending"
  | "annualNetEmploymentIncome"
  | "delayedIncomeAnnual"
  | "taxableWithdrawalTaxRate"
  | "pensionWithdrawalTaxRate"
  | "annualEmployeePensionContribution"
  | "annualEmployerPensionContribution"
  | "lowerIncomeRate"
  | "housingReleaseTax"
  | "housingReleaseFees"
  | "housingRetainedValue";
type AssumptionNumberKey = Exclude<
  keyof RetirementAssumptionSet,
  "id" | "name"
>;

const DATE_FIELDS: Array<{ id: string; key: DraftDateKey; label: string }> = [
  { id: "retirement-start-date", key: "startDate", label: "Projection start" },
  {
    id: "planned-retirement-date",
    key: "plannedRetirementDate",
    label: "Planned retirement date",
  },
  {
    id: "delayed-income-start",
    key: "delayedIncomeStartDate",
    label: "Delayed income starts",
  },
  {
    id: "pension-access-date",
    key: "pensionAccessDate",
    label: "Pension access date",
  },
  {
    id: "housing-release-date",
    key: "housingReleaseDate",
    label: "Home equity release date",
  },
];

const NUMBER_FIELDS: Array<{
  id: string;
  key: DraftNumberKey;
  label: string;
  max?: number;
  scale?: number;
  step: number;
}> = [
  {
    id: "annual-household-spending",
    key: "annualSpending",
    label: "Annual household spending",
    step: 100,
  },
  {
    id: "annual-net-employment-income",
    key: "annualNetEmploymentIncome",
    label: "Annual net employment income",
    step: 100,
  },
  {
    id: "delayed-retirement-income",
    key: "delayedIncomeAnnual",
    label: "Annual delayed retirement income",
    step: 100,
  },
  {
    id: "taxable-withdrawal-tax",
    key: "taxableWithdrawalTaxRate",
    label: "Taxable withdrawal tax, %",
    max: 99,
    scale: 100,
    step: 0.1,
  },
  {
    id: "pension-withdrawal-tax",
    key: "pensionWithdrawalTaxRate",
    label: "Pension withdrawal tax, %",
    max: 99,
    scale: 100,
    step: 0.1,
  },
  {
    id: "employee-pension-contribution",
    key: "annualEmployeePensionContribution",
    label: "Annual gross employee pension contribution",
    step: 100,
  },
  {
    id: "employer-pension-contribution",
    key: "annualEmployerPensionContribution",
    label: "Annual employer pension contribution",
    step: 100,
  },
  {
    id: "lower-replacement-income",
    key: "lowerIncomeRate",
    label: "Reduced-work net income, %",
    max: 100,
    scale: 100,
    step: 1,
  },
  {
    id: "housing-release-tax",
    key: "housingReleaseTax",
    label: "Home equity release tax",
    step: 100,
  },
  {
    id: "housing-release-fees",
    key: "housingReleaseFees",
    label: "Home equity release fees",
    step: 100,
  },
  {
    id: "housing-retained-value",
    key: "housingRetainedValue",
    label: "Home value retained after release",
    step: 100,
  },
];

const ASSUMPTION_FIELDS: Array<{
  key: AssumptionNumberKey;
  label: string;
  min?: number;
  scale?: number;
  step: number;
}> = [
  { key: "annualReturn", label: "annual return, %", scale: 100, step: 0.1 },
  { key: "annualInflation", label: "inflation, %", scale: 100, step: 0.1 },
  {
    key: "annualSpendingChange",
    label: "real spending change, %",
    scale: 100,
    step: 0.1,
  },
  {
    key: "annualFeeRate",
    label: "annual fees, %",
    min: 0,
    scale: 100,
    step: 0.1,
  },
  {
    key: "longevityYears",
    label: "longevity horizon, years",
    min: 30,
    step: 1,
  },
  {
    key: "earlyReturnShock",
    label: "early return shock, %",
    scale: 100,
    step: 1,
  },
  {
    key: "earlyReturnShockYears",
    label: "shock duration, years",
    min: 0,
    step: 1,
  },
];

function Field({
  id,
  label,
  children,
}: Readonly<{ id: string; label: string; children: ReactNode }>) {
  return (
    <label className="grid gap-1.5 text-sm" htmlFor={id}>
      <span className="font-medium">{label}</span>
      {children}
    </label>
  );
}

function numberValue(value: string): number {
  return value === "" ? 0 : Number(value);
}

function DraftFields({
  draft,
  setDraft,
}: Readonly<{ draft: RetirementStressDraft; setDraft: DraftSetter }>) {
  const update = (key: keyof RetirementStressDraft, value: number | string) =>
    setDraft((current) => ({ ...current, [key]: value }));
  return (
    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
      <Field id="housing-strategy" label="Housing strategy">
        <select
          className="h-9 rounded-md border border-input bg-transparent px-3 text-sm shadow-xs"
          id="housing-strategy"
          value={draft.housingStrategy}
          onChange={(event) =>
            setDraft((current) => ({
              ...current,
              housingStrategy: event.target.value as
                | "retain-home"
                | "release-equity",
            }))
          }
        >
          <option value="retain-home">Retain home</option>
          <option value="release-equity">Release home equity</option>
        </select>
      </Field>
      {DATE_FIELDS.map((field) => (
        <Field key={field.key} id={field.id} label={field.label}>
          <Input
            id={field.id}
            type="date"
            value={draft[field.key]}
            onChange={(event) => update(field.key, event.target.value)}
          />
        </Field>
      ))}
      {NUMBER_FIELDS.map((field) => {
        const scale = field.scale ?? 1;
        return (
          <Field key={field.key} id={field.id} label={field.label}>
            <Input
              id={field.id}
              min={0}
              max={field.max}
              step={field.step}
              type="number"
              value={draft[field.key] * scale}
              onChange={(event) =>
                update(field.key, numberValue(event.target.value) / scale)
              }
            />
          </Field>
        );
      })}
    </div>
  );
}

function StartingFacts(
  props: Readonly<{ draft: RetirementStressDraft; setDraft: DraftSetter }>,
) {
  return (
    <fieldset className="space-y-3 rounded-lg border p-4">
      <legend className="px-1 font-semibold">Shared household facts</legend>
      <DraftFields {...props} />
    </fieldset>
  );
}

function AssumptionSetEditor({
  assumption,
  update,
}: Readonly<{
  assumption: RetirementAssumptionSet;
  update(changes: Partial<RetirementAssumptionSet>): void;
}>) {
  return (
    <fieldset className="space-y-3 rounded-lg border p-4">
      <legend className="px-1 font-semibold">{assumption.name}</legend>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Field id={`${assumption.id}-name`} label={`${assumption.name} name`}>
          <Input
            id={`${assumption.id}-name`}
            value={assumption.name}
            onChange={(event) => update({ name: event.target.value })}
          />
        </Field>
        {ASSUMPTION_FIELDS.map((field) => {
          const scale = field.scale ?? 1;
          return (
            <Field
              key={field.key}
              id={`${assumption.id}-${field.key}`}
              label={`${assumption.name} ${field.label}`}
            >
              <Input
                id={`${assumption.id}-${field.key}`}
                type="number"
                min={field.min}
                step={field.step}
                value={assumption[field.key] * scale}
                onChange={(event) =>
                  update({
                    [field.key]: numberValue(event.target.value) / scale,
                  })
                }
              />
            </Field>
          );
        })}
      </div>
    </fieldset>
  );
}

export function RetirementStressAssumptions({
  draft,
  setDraft,
}: Readonly<{ draft: RetirementStressDraft; setDraft: DraftSetter }>) {
  const updateAssumption = (
    id: string,
    changes: Partial<RetirementAssumptionSet>,
  ) =>
    setDraft((current) => ({
      ...current,
      assumptionSets: current.assumptionSets.map((assumption) =>
        assumption.id === id ? { ...assumption, ...changes } : assumption,
      ),
    }));
  return (
    <div className="space-y-4">
      <StartingFacts draft={draft} setDraft={setDraft} />
      <section className="space-y-3">
        <div>
          <h3 className="font-semibold">Named stress assumptions</h3>
          <p className="text-sm text-muted-foreground">
            Default returns assume a 100% equity portfolio and apply across the
            whole portfolio. Adjust them for cash, bonds, or other asset mixes.
            Every input is explicit, and early shocks apply before the steady
            return. Pension contributions are gross deposits and do not infer
            tax relief beyond the entered amount. Releasing home equity repays
            tracked mortgages before adding the remainder to the first
            withdrawal account.
          </p>
        </div>
        {draft.assumptionSets.map((assumption) => (
          <AssumptionSetEditor
            key={assumption.id}
            assumption={assumption}
            update={(changes) => updateAssumption(assumption.id, changes)}
          />
        ))}
      </section>
    </div>
  );
}
