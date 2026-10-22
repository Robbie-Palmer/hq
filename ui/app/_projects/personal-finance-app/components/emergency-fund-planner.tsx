"use client";

import { EmergencyFundFacts } from "./emergency-fund-facts";
import {
  MissingDataWarning,
  PlannerHeader,
  ReservePreferences,
  SaveControls,
  StressAssumptions,
} from "./emergency-fund-planner-controls";
import { EmergencyFundResults } from "./emergency-fund-results";
import { EmergencyFundSources } from "./emergency-fund-sources";
import { useEmergencyFundPlanner } from "./use-emergency-fund-planner";

export function EmergencyFundPlanner() {
  const planner = useEmergencyFundPlanner();
  if (planner.household?.activeScope.kind === "member") {
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
      <PlannerHeader activePlan={planner.activePlan} />
      <EmergencyFundFacts
        baseCurrency={planner.baseCurrency}
        facts={planner.emergencyFundFacts}
      />
      <ReservePreferences
        draft={planner.draft}
        coverageText={planner.coverageText}
        missingDataText={planner.missingDataText}
        onDraftChange={planner.updateDraft}
        onCoverageChange={planner.updateCoverage}
        onMissingDataChange={planner.updateMissingData}
      />
      <MissingDataWarning items={planner.draft.missingData} />
      <EmergencyFundSources
        accounts={planner.accountDetails}
        analysis={planner.analysis}
        baseCurrency={planner.baseCurrency}
        policies={planner.draft.accountPolicies}
        onPolicyChange={planner.updatePolicy}
      />
      <StressAssumptions
        scenarios={planner.draft.stressScenarios}
        onChange={planner.updateScenario}
      />
      {planner.analysis && (
        <EmergencyFundResults
          analysis={planner.analysis}
          baseCurrency={planner.baseCurrency}
        />
      )}
      <SaveControls
        saving={planner.saving}
        hasActivePlan={planner.activePlan != null}
        error={planner.error}
        onSave={planner.save}
      />
    </section>
  );
}
