import { z } from "zod";

import { canonicalJson } from "./canonical-json";
import {
  ContextCitationSchema,
  ContextWarningSchema,
} from "./proposals";
import { sha256 } from "./suggestions";

export const EditorialGraphNodeSchema = z.looseObject({
  id: z.string().trim().min(1),
  name: z.string().trim().min(1),
  type: z.string().trim().min(1),
  href: z.string().trim().min(1).optional(),
});

export const EditorialGraphEdgeSchema = z.looseObject({
  source: z.string().trim().min(1),
  target: z.string().trim().min(1),
  type: z.string().trim().min(1),
});

export const EvidenceSignalSchema = z.object({
  id: z.string().trim().min(1),
  label: z.string().trim().min(1),
  href: z.string().trim().min(1).optional(),
  observedAt: z.iso.datetime(),
  validUntil: z.iso.datetime().optional(),
}).strict();

export const EditorialGraphSnapshotSchema = z.object({
  retrievedAt: z.iso.datetime(),
  nodes: z.array(EditorialGraphNodeSchema),
  edges: z.array(EditorialGraphEdgeSchema),
  evidenceSignals: z.array(EvidenceSignalSchema).default([]),
}).strict();

export const PassageContextQuerySchema = z.object({
  projectId: z.string().trim().min(1),
  adrIds: z.array(z.string().trim().min(1)).default([]),
  terminologyIds: z.array(z.string().trim().min(1)).default([]),
  evidenceIds: z.array(z.string().trim().min(1)).default([]),
}).strict();

export const RetrievedPassageContextSchema = z.object({
  retrievedAt: z.iso.datetime(),
  graphContentHash: z.string().regex(/^sha256:[a-f0-9]{64}$/),
  citations: z.array(ContextCitationSchema).min(1),
  warnings: z.array(ContextWarningSchema),
}).strict();

export type RetrievedPassageContext = z.infer<typeof RetrievedPassageContextSchema>;

export function retrievePassageContext(input: {
  snapshot: z.input<typeof EditorialGraphSnapshotSchema>;
  query: z.input<typeof PassageContextQuerySchema>;
}): RetrievedPassageContext {
  const snapshot = EditorialGraphSnapshotSchema.parse(input.snapshot);
  const query = PassageContextQuerySchema.parse(input.query);
  const state: RetrievalState = {
    snapshot,
    query,
    nodes: new Map(snapshot.nodes.map((node) => [node.id, node])),
    signals: new Map(snapshot.evidenceSignals.map((signal) => [signal.id, signal])),
    citations: [],
    warnings: [{
      code: "fact-check-required",
      message: "Retrieved context is advisory; the author must verify facts before publication.",
    }],
  };
  addProjectContext(state);
  addAdrContext(state);
  addTerminologyContext(state);
  addEvidenceContext(state);

  return RetrievedPassageContextSchema.parse({
    retrievedAt: snapshot.retrievedAt,
    graphContentHash: sha256(canonicalJson({
      nodes: snapshot.nodes,
      edges: snapshot.edges,
    })),
    citations: state.citations,
    warnings: state.warnings,
  });
}

type GraphNode = z.infer<typeof EditorialGraphNodeSchema>;
type GraphSnapshot = z.infer<typeof EditorialGraphSnapshotSchema>;
type ContextQuery = z.infer<typeof PassageContextQuerySchema>;
type Citation = z.infer<typeof ContextCitationSchema>;
type Warning = z.infer<typeof ContextWarningSchema>;
type EvidenceSignal = z.infer<typeof EvidenceSignalSchema>;

type RetrievalState = {
  snapshot: GraphSnapshot;
  query: ContextQuery;
  nodes: Map<string, GraphNode>;
  signals: Map<string, EvidenceSignal>;
  citations: Citation[];
  warnings: Warning[];
};

function addProjectContext(state: RetrievalState): void {
  const project = state.nodes.get(state.query.projectId);
  if (project?.type === "project") {
    state.citations.push(nodeCitation("project", project));
  } else {
    state.citations.push(missingCitation("project", state.query.projectId));
    state.warnings.push(missingWarning(state.query.projectId, "project"));
  }
}

function addAdrContext(state: RetrievalState): void {
  for (const adrId of state.query.adrIds) {
    const adr = state.nodes.get(adrId);
    const linked = state.snapshot.edges.some(
      (edge) =>
        edge.type === "PART_OF_PROJECT" &&
        edge.source === adrId && edge.target === state.query.projectId,
    );
    if (adr?.type === "adr" && linked) {
      state.citations.push(nodeCitation("adr", adr));
    } else {
      state.citations.push(missingCitation("adr", adrId));
      state.warnings.push(missingWarning(adrId, "ADR linked to the selected project"));
    }
  }
}

function addTerminologyContext(state: RetrievalState): void {
  const sources = new Set([state.query.projectId, ...state.query.adrIds]);
  for (const terminologyId of state.query.terminologyIds) {
    const term = state.nodes.get(terminologyId);
    const linked = state.snapshot.edges.some(
      (edge) =>
        sources.has(edge.source) &&
        edge.target === terminologyId &&
        (edge.type === "USES_TECHNOLOGY" || edge.type === "HAS_TAG"),
    );
    if (term && linked) {
      state.citations.push(nodeCitation("terminology", term));
    } else {
      state.citations.push(missingCitation("terminology", terminologyId));
      state.warnings.push({
        code: "terminology-context-missing",
        subjectId: terminologyId,
        message: `No established terminology source was retrieved for ${terminologyId}.`,
      });
    }
  }
}

function addEvidenceContext(state: RetrievalState): void {
  for (const evidenceId of state.query.evidenceIds) {
    const signal = state.signals.get(evidenceId);
    if (!signal) {
      state.citations.push(missingCitation("evidence", evidenceId));
      state.warnings.push(missingWarning(evidenceId, "evidence signal"));
      continue;
    }
    const freshness = evidenceFreshness(signal.validUntil, state.snapshot.retrievedAt);
    state.citations.push({
      kind: "evidence",
      id: signal.id,
      label: signal.label,
      ...(signal.href ? { href: signal.href } : {}),
      freshness,
      observedAt: signal.observedAt,
    });
    if (freshness === "stale") {
      state.warnings.push({
        code: "stale-evidence",
        subjectId: signal.id,
        message: `${signal.label} expired before the context snapshot was retrieved.`,
      });
    } else if (freshness === "unassessed") {
      state.warnings.push({
        code: "unassessed-evidence",
        subjectId: signal.id,
        message: `${signal.label} has no freshness deadline.`,
      });
    }
  }
}

function nodeCitation(
  kind: "project" | "adr" | "terminology",
  node: GraphNode,
): z.infer<typeof ContextCitationSchema> {
  return {
    kind,
    id: node.id,
    label: node.name,
    ...(node.href ? { href: node.href } : {}),
    freshness: "not-applicable",
  };
}

function missingCitation(
  kind: "project" | "adr" | "terminology" | "evidence",
  id: string,
): z.infer<typeof ContextCitationSchema> {
  return { kind, id, label: id, freshness: "missing" };
}

function missingWarning(
  subjectId: string,
  expected: string,
): z.infer<typeof ContextWarningSchema> {
  return {
    code: "missing-context",
    subjectId,
    message: `The knowledge graph did not supply the requested ${expected}: ${subjectId}.`,
  };
}

function evidenceFreshness(
  validUntil: string | undefined,
  retrievedAt: string,
): "fresh" | "stale" | "unassessed" {
  if (!validUntil) return "unassessed";
  return Date.parse(validUntil) >= Date.parse(retrievedAt) ? "fresh" : "stale";
}
