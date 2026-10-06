"use client";

import { useEffect, useId, useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  defaultEmergencyFundAccountPolicy,
  type EmergencyFundAccountPolicy,
  type EmergencyFundDerivedFacts,
  type EmergencyFundPlanInput,
  EmergencyFundPlanInputSchema,
  formatAssetTrackerError,
} from "@/lib/domain/assettracker";
import { useAssetTracker } from "./asset-tracker-provider";
import { EmergencyFundFacts } from "./emergency-fund-facts";
import { EmergencyFundResults } from "./emergency-fund-results";
import { EmergencyFundSources } from "./emergency-fund-sources";

function numberValue(value: string): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function saveButtonLabel(saving: boolean, hasActivePlan: boolean): string {
  if (saving) return "Saving…";
  if (hasActivePlan) return "Save as new version";
  return "Save reserve plan";
}

function Field({
  label,
  value,
  onChange,
  min = 0,
  max,
  step = 1,
  suffix,
}: Readonly<{
  label: string;
  value: number;
  onChange(value: number): void;
  min?: number;
  max?: number;
  step?: number;
  suffix?: string;
}>) {
  const inputId = useId();
  return (
    <div className="grid gap-1 text-sm">
      <label htmlFor={inputId} className="text-xs text-muted-foreground">
        {label}
      </label>
      <span className="flex items-center gap-2">
        <Input
          id={inputId}
          type="number"
          min={min}
          max={max}
          step={step}
          value={value}
          onChange={(event) => onChange(numberValue(event.target.value))}
        />
        {suffix && (
          <span className="text-xs text-muted-foreground">{suffix}</span>
        )}
      </span>
    </div>
  );
}

function initialPlan(
  facts: EmergencyFundDerivedFacts,
  accounts: ReturnType<typeof useAssetTracker>["accountDetails"],
): EmergencyFundPlanInput {
  const monthly = facts.essentialMonthlyExpenditure ?? 0;
  return {
    name: "Household emergency reserves",
    essentialMonthlyExpenditure: Math.round(monthly),
    annualIrregularEssentialCosts: 0,
    monthlyDebtPayments: facts.monthlyDebtPayments,
    employmentMonthlyIncome: facts.employmentMonthlyIncome ?? 0,
    monthlySideIncome: facts.monthlySideIncome,
    accessNeedDays: 7,
    missingData: [
      ...(facts.essentialMonthlyExpenditure == null
        ? ["Reconciled household spending"]
        : []),
      ...(facts.employmentMonthlyIncome == null
        ? ["Active take-home income flow"]
        : []),
      "Essential and non-essential spending classification",
      "Irregular essential costs",
    ],
    coverageMonths: [3, 6, 9],
    accountPolicies: accounts.map(defaultEmergencyFundAccountPolicy),
    stressScenarios: [
      {
        id: "income-and-cost-shock",
        name: "Income loss and unexpected cost",
        durationMonths: 12,
        employmentIncomeLossRate: 1,
        sideIncomeDelayMonths: 2,
        unexpectedCost: Math.round(monthly),
        annualInflationRate: facts.annualInflationRate,
      },
    ],
  };
}

export function EmergencyFundPlanner() {
  const context = useAssetTracker();
  const {
    accountDetails,
    analyseEmergencyFundDraft,
    baseCurrency,
    emergencyFundFacts,
    saveEmergencyFundPlan,
  } = context;
  const emergencyFundPlans = context.emergencyFundPlans ?? [];
  const activePlan = emergencyFundPlans.find(
    ({ status }) => status === "active",
  );
  const fallback = useMemo(
    () => initialPlan(emergencyFundFacts, accountDetails),
    [accountDetails, emergencyFundFacts],
  );
  const [draft, setDraft] = useState<EmergencyFundPlanInput>(
    activePlan ?? fallback,
  );
  const [coverageText, setCoverageText] = useState(() =>
    (activePlan ?? fallback).coverageMonths.join(", "),
  );
  const [missingDataText, setMissingDataText] = useState(() =>
    (activePlan ?? fallback).missingData.join(", "),
  );
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    const plan = activePlan ?? fallback;
    setDraft(plan);
    setCoverageText(plan.coverageMonths.join(", "));
    setMissingDataText(plan.missingData.join(", "));
  }, [activePlan, fallback]);

  const analysis = useMemo(() => {
    try {
      return typeof analyseEmergencyFundDraft === "function"
        ? analyseEmergencyFundDraft(draft)
        : null;
    } catch {
      return null;
    }
  }, [analyseEmergencyFundDraft, draft]);

  function updatePolicy(
    accountId: string,
    update: Partial<EmergencyFundAccountPolicy>,
  ) {
    setDraft((current) => ({
      ...current,
      accountPolicies: current.accountPolicies.map((policy) =>
        policy.accountId === accountId ? { ...policy, ...update } : policy,
      ),
    }));
  }

  async function save() {
    setSaving(true);
    try {
      if (typeof saveEmergencyFundPlan !== "function") {
        throw new TypeError("Emergency-fund persistence is unavailable");
      }
      await saveEmergencyFundPlan(EmergencyFundPlanInputSchema.parse(draft));
      setError(null);
    } catch (cause) {
      setError(formatAssetTrackerError(cause));
    } finally {
      setSaving(false);
    }
  }

  if (context.household?.activeScope.kind === "member") {
    return (
      <section className="rounded-lg border p-4 sm:p-6">
        <h3 className="font-semibold">Emergency reserve plan</h3>
        <p className="mt-1 text-sm text-muted-foreground">
          Switch the account scope to Household to review and save the shared
          emergency reserve plan.
        </p>
      </section>
    );
  }

  return (
    <section className="space-y-5 rounded-lg border p-4 sm:p-6">
      <div className="flex flex-col justify-between gap-3 sm:flex-row sm:items-start">
        <div>
          <h3 className="font-semibold">Emergency reserve plan</h3>
          <p className="mt-1 max-w-3xl text-sm text-muted-foreground">
            Compare household-selected reserve policies against income loss,
            delayed side income, unexpected costs, inflation, and selected
            decisions. There is no preset correct number of months.
          </p>
        </div>
        <div className="text-xs text-muted-foreground sm:text-right">
          {activePlan == null ? (
            <p>Not saved yet</p>
          ) : (
            <>
              <p>Version {activePlan.version}</p>
              <p>{new Date(activePlan.createdAt).toLocaleDateString()}</p>
            </>
          )}
        </div>
      </div>

      <EmergencyFundFacts
        baseCurrency={baseCurrency}
        facts={emergencyFundFacts}
      />

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Field
          label="Irregular essentials per year"
          value={draft.annualIrregularEssentialCosts}
          onChange={(value) =>
            setDraft((current) => ({
              ...current,
              annualIrregularEssentialCosts: value,
            }))
          }
        />
        <Field
          label="Funds needed within"
          value={draft.accessNeedDays}
          suffix="days"
          onChange={(value) =>
            setDraft((current) => ({ ...current, accessNeedDays: value }))
          }
        />
        <div className="grid gap-1 text-sm sm:col-span-2">
          <label
            htmlFor="emergency-fund-coverage-months"
            className="text-xs text-muted-foreground"
          >
            Policies to compare, in months
          </label>
          <Input
            id="emergency-fund-coverage-months"
            value={coverageText}
            onChange={(event) => {
              setCoverageText(event.target.value);
              setDraft((current) => ({
                ...current,
                coverageMonths: event.target.value
                  .split(",")
                  .map((value) => Number(value.trim()))
                  .filter((value) => Number.isFinite(value) && value > 0),
              }));
            }}
          />
        </div>
        <div className="grid gap-1 text-sm lg:col-span-1">
          <label
            htmlFor="emergency-fund-missing-data"
            className="text-xs text-muted-foreground"
          >
            Missing or uncertain facts
          </label>
          <Input
            id="emergency-fund-missing-data"
            value={missingDataText}
            onChange={(event) => {
              setMissingDataText(event.target.value);
              setDraft((current) => ({
                ...current,
                missingData: event.target.value
                  .split(",")
                  .map((value) => value.trim())
                  .filter(Boolean),
              }));
            }}
          />
        </div>
      </div>

      {draft.missingData.length > 0 && (
        <div className="rounded-md border border-amber-500/40 bg-amber-500/5 p-3 text-sm">
          <p className="font-medium">Review before choosing a policy</p>
          <p className="mt-1 text-muted-foreground">
            {draft.missingData.join("; ")}
          </p>
        </div>
      )}

      <EmergencyFundSources
        accounts={accountDetails}
        analysis={analysis}
        baseCurrency={baseCurrency}
        policies={draft.accountPolicies}
        onPolicyChange={updatePolicy}
      />

      <div className="space-y-3">
        <div>
          <h4 className="text-sm font-medium">Stress assumptions</h4>
          <p className="text-xs text-muted-foreground">
            These are explicit what-if events, not probability scores. Inflation
            comes from the shared tracker setting.
          </p>
        </div>
        {draft.stressScenarios.map((scenario, index) => (
          <div
            key={scenario.id}
            className="grid gap-3 rounded-md bg-muted/40 p-3 sm:grid-cols-2 lg:grid-cols-4"
          >
            <Field
              label="Duration"
              value={scenario.durationMonths}
              suffix="months"
              onChange={(value) =>
                setDraft((current) => ({
                  ...current,
                  stressScenarios: current.stressScenarios.map(
                    (item, itemIndex) =>
                      itemIndex === index
                        ? { ...item, durationMonths: value }
                        : item,
                  ),
                }))
              }
            />
            <Field
              label="Employment income lost"
              value={scenario.employmentIncomeLossRate * 100}
              max={100}
              suffix="%"
              onChange={(value) =>
                setDraft((current) => ({
                  ...current,
                  stressScenarios: current.stressScenarios.map(
                    (item, itemIndex) =>
                      itemIndex === index
                        ? { ...item, employmentIncomeLossRate: value / 100 }
                        : item,
                  ),
                }))
              }
            />
            <Field
              label="Side-income delay"
              value={scenario.sideIncomeDelayMonths}
              suffix="months"
              onChange={(value) =>
                setDraft((current) => ({
                  ...current,
                  stressScenarios: current.stressScenarios.map(
                    (item, itemIndex) =>
                      itemIndex === index
                        ? { ...item, sideIncomeDelayMonths: value }
                        : item,
                  ),
                }))
              }
            />
            <Field
              label="Unexpected cost"
              value={scenario.unexpectedCost}
              onChange={(value) =>
                setDraft((current) => ({
                  ...current,
                  stressScenarios: current.stressScenarios.map(
                    (item, itemIndex) =>
                      itemIndex === index
                        ? { ...item, unexpectedCost: value }
                        : item,
                  ),
                }))
              }
            />
          </div>
        ))}
      </div>

      {analysis && (
        <EmergencyFundResults analysis={analysis} baseCurrency={baseCurrency} />
      )}

      <div className="flex flex-wrap items-center gap-3">
        <Button type="button" onClick={save} disabled={saving}>
          {saveButtonLabel(saving, activePlan != null)}
        </Button>
        {error && <p className="text-sm text-destructive">{error}</p>}
      </div>
    </section>
  );
}
