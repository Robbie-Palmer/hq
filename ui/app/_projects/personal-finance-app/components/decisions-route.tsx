"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { DecisionRecordLedger } from "./decision-record-ledger";
import { DecisionScenarioComparison } from "./decision-scenario-comparison";
import { ForecastAssumptionManager } from "./forecast-assumption-manager";
import { ForeignExchangeDecisionWorkspace } from "./foreign-exchange-decision-workspace";
import { FutureCashFlowManager } from "./future-cash-flow-manager";
import { ItemisedScenarioPlanner } from "./itemised-scenario-planner";
import { JobMoveScenarioPlanner } from "./job-move-scenario-planner";

const availableTabs = new Set([
  "compare",
  "currency",
  "scenarios",
  "inputs",
  "recorded",
]);

export function DecisionsRoute() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const requestedTab = searchParams.get("tab");
  const currentTab = availableTabs.has(requestedTab ?? "")
    ? (requestedTab ?? "jobs")
    : "jobs";

  function onTabChange(value: string) {
    const params = new URLSearchParams(searchParams.toString());
    if (value === "jobs") params.delete("tab");
    else params.set("tab", value);
    const query = params.toString();
    router.replace(`/assettracker/decisions${query ? `?${query}` : ""}`, {
      scroll: false,
    });
  }

  return (
    <Tabs
      key={currentTab}
      defaultValue={currentTab}
      onValueChange={onTabChange}
      className="space-y-5"
    >
      <TabsList className="w-full justify-start overflow-x-auto sm:w-auto">
        <TabsTrigger value="compare">Compare</TabsTrigger>
        <TabsTrigger value="currency">Currency</TabsTrigger>
        <TabsTrigger value="jobs">Job moves</TabsTrigger>
        <TabsTrigger value="scenarios">Scenarios</TabsTrigger>
        <TabsTrigger value="inputs">Forecast inputs</TabsTrigger>
        <TabsTrigger value="recorded">Recorded</TabsTrigger>
      </TabsList>
      <TabsContent value="compare" className="mt-0">
        <DecisionScenarioComparison />
      </TabsContent>
      <TabsContent value="currency" className="mt-0">
        <ForeignExchangeDecisionWorkspace />
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
