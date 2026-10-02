import type { Metadata } from "next";

export const metadata: Metadata = { title: "Decisions" };

export default function AssetTrackerDecisionsPage() {
  return (
    <div className="space-y-8">
      <div>
        <h1 className="mb-2 text-4xl font-bold">Decisions</h1>
        <p className="text-lg text-muted-foreground">
          Record financial choices and compare their expected and actual
          outcomes.
        </p>
      </div>
      <div className="rounded-lg border border-dashed px-6 py-12 text-center">
        <h2 className="text-lg font-semibold">No decision records yet</h2>
        <p className="mt-2 text-sm text-muted-foreground">
          Decision recording is not available in this version of Asset Tracker.
        </p>
      </div>
    </div>
  );
}
