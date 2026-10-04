export type UnresolvedAuthoredTerm = {
  id: string;
  kind: "ingredient" | "equipment";
  rawText: string;
  normalizedText: string;
  locale: string;
  sourceContext: {
    flow: "recipe" | "pantry" | "diet" | "equipment";
    resourceId?: string;
    field?: string;
  };
  provenance: {
    kind: "user" | "import";
    actorUserId: string;
    importJobId?: string;
  };
  candidateMatches: Array<{ slug: string; score: number }>;
  frequency: number;
  resolutionStatus: "unresolved";
};
