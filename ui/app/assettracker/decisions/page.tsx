import type { Metadata } from "next";
import { DecisionsRoute } from "@/components/assettracker/decisions-route";

export const metadata: Metadata = { title: "Decisions" };

export default function AssetTrackerDecisionsPage() {
  return (
    <div className="space-y-8">
      <div>
        <h1 className="mb-2 text-3xl font-bold sm:text-4xl">Decisions</h1>
        <p className="text-lg text-muted-foreground">
          Record financial choices and compare their expected and actual
          outcomes.
        </p>
      </div>
      <DecisionsRoute />
    </div>
  );
}
