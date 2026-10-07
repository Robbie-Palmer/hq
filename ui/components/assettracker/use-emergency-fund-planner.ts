import { useEffect, useMemo, useRef, useState } from "react";
import {
  defaultEmergencyFundAccountPolicy,
  type EmergencyFundAccountPolicy,
  type EmergencyFundDerivedFacts,
  type EmergencyFundPlanInput,
  EmergencyFundPlanInputSchema,
  type EmergencyFundStressScenario,
  formatAssetTrackerError,
  includeAllEmergencyFundAccounts,
} from "@/lib/domain/assettracker";
import { useAssetTracker } from "./asset-tracker-provider";

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

function commaSeparatedNumbers(value: string): number[] {
  return value
    .split(",")
    .map((item) => Number(item.trim()))
    .filter((item) => Number.isFinite(item) && item > 0);
}

function commaSeparatedText(value: string): string[] {
  return value
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

export function useEmergencyFundPlanner() {
  const context = useAssetTracker();
  const plans = context.emergencyFundPlans ?? [];
  const activePlan = plans.find(({ status }) => status === "active");
  const fallback = useMemo(
    () => initialPlan(context.emergencyFundFacts, context.accountDetails),
    [context.accountDetails, context.emergencyFundFacts],
  );
  const currentPlan = useMemo(
    () =>
      includeAllEmergencyFundAccounts(
        activePlan ?? fallback,
        context.accountDetails,
      ),
    [activePlan, context.accountDetails, fallback],
  );
  const planKey = activePlan?.id ?? null;
  const loadedPlanKey = useRef(planKey);
  const [draft, setDraft] = useState<EmergencyFundPlanInput>(currentPlan);
  const [coverageText, setCoverageText] = useState(() =>
    currentPlan.coverageMonths.join(", "),
  );
  const [missingDataText, setMissingDataText] = useState(() =>
    currentPlan.missingData.join(", "),
  );
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const analyseDraft = context.analyseEmergencyFundDraft;

  useEffect(() => {
    if (loadedPlanKey.current === planKey) return;
    loadedPlanKey.current = planKey;
    setDraft(currentPlan);
    setCoverageText(currentPlan.coverageMonths.join(", "));
    setMissingDataText(currentPlan.missingData.join(", "));
  }, [currentPlan, planKey]);

  useEffect(() => {
    setDraft((current) =>
      includeAllEmergencyFundAccounts(current, context.accountDetails),
    );
  }, [context.accountDetails]);

  const analysis = useMemo(() => {
    try {
      return analyseDraft?.(draft) ?? null;
    } catch {
      return null;
    }
  }, [analyseDraft, draft]);

  function updateDraft(update: Partial<EmergencyFundPlanInput>) {
    setDraft((current) => ({ ...current, ...update }));
  }

  function updateCoverage(value: string) {
    setCoverageText(value);
    updateDraft({ coverageMonths: commaSeparatedNumbers(value) });
  }

  function updateMissingData(value: string) {
    setMissingDataText(value);
    updateDraft({ missingData: commaSeparatedText(value) });
  }

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

  function updateScenario(
    index: number,
    update: Partial<EmergencyFundStressScenario>,
  ) {
    setDraft((current) => ({
      ...current,
      stressScenarios: current.stressScenarios.map((scenario, itemIndex) =>
        itemIndex === index ? { ...scenario, ...update } : scenario,
      ),
    }));
  }

  async function save() {
    setSaving(true);
    try {
      if (context.saveEmergencyFundPlan == null) {
        throw new TypeError("Emergency-fund persistence is unavailable");
      }
      await context.saveEmergencyFundPlan(
        EmergencyFundPlanInputSchema.parse(draft),
      );
      setError(null);
    } catch (cause) {
      setError(formatAssetTrackerError(cause));
    } finally {
      setSaving(false);
    }
  }

  return {
    ...context,
    activePlan,
    analysis,
    coverageText,
    draft,
    error,
    missingDataText,
    save,
    saving,
    updateCoverage,
    updateDraft,
    updateMissingData,
    updatePolicy,
    updateScenario,
  };
}
