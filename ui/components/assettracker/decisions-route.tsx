"use client";

import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { DecisionRecordLedger } from "./decision-record-ledger";
import { DecisionScenarioComparison } from "./decision-scenario-comparison";
import { ForecastAssumptionManager } from "./forecast-assumption-manager";
import { FutureCashFlowManager } from "./future-cash-flow-manager";
import { ItemisedScenarioPlanner } from "./itemised-scenario-planner";
import { JobMoveScenarioPlanner } from "./job-move-scenario-planner";

export function DecisionsRoute() {
  return (
    <Tabs defaultValue="jobs" className="space-y-5">
      <TabsList className="w-full justify-start overflow-x-auto sm:w-auto">
        <TabsTrigger value="compare">Compare</TabsTrigger>
        <TabsTrigger value="jobs">Job moves</TabsTrigger>
        <TabsTrigger value="scenarios">Scenarios</TabsTrigger>
        <TabsTrigger value="inputs">Forecast inputs</TabsTrigger>
        <TabsTrigger value="recorded">Recorded</TabsTrigger>
      </TabsList>
      <TabsContent value="compare" className="mt-0">
        <DecisionScenarioComparison />
      </TabsContent>
      <TabsContent value="jobs" className="mt-0">
        <JobMoveScenarioPlanner />
      </TabsContent>
      <TabsContent value="scenarios" className="mt-0">
        <ItemisedScenarioPlanner />
      </TabsContent>
      <TabsContent value="inputs" className="mt-0 space-y-6">
        <ForecastAssumptionManager />
        <FutureCashFlowManager />
      </TabsContent>
      <TabsContent value="recorded" className="mt-0">
        <DecisionRecordLedger />
      </TabsContent>
    </Tabs>
  );
}
