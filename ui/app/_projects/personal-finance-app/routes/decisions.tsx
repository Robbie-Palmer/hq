import { DecisionsRoute } from "../components/decisions-route";

export function AssetTrackerDecisions() {
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
