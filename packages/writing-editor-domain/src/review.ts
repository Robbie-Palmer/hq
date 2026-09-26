import { createTwoFilesPatch } from "diff";
import { z } from "zod";

import { canonicalJson } from "./canonical-json";
import { DecisionSchema, type Decision } from "./decisions";
import {
  compareFindings,
  FindingSchema,
  type Finding,
  verifyFindingSource,
} from "./findings";
import {
  ProposalSchema,
  type Proposal,
  verifyProposalSource,
} from "./proposals";
import { compareSuggestions, type Suggestion } from "./suggestions";

export const ReviewRecordsSchema = z.object({
  documentId: z.string().trim().min(1),
  revision: z.string().trim().min(1),
  findings: z.array(FindingSchema).default([]),
  proposals: z.array(ProposalSchema).default([]),
}).strict();

export type ReviewRecords = z.infer<typeof ReviewRecordsSchema>;

export class ReviewConflictError extends Error {
  readonly conflicts: string[];

  constructor(message: string, conflicts: string[]) {
    const formattedConflicts = conflicts.map((conflict) => `- ${conflict}`).join("\n");
    super(`${message}:\n${formattedConflicts}`);
    this.name = "ReviewConflictError";
    this.conflicts = conflicts;
  }
}

export function prepareReviewRecords(input: unknown, source: string): ReviewRecords {
  const records = ReviewRecordsSchema.parse(input);
  const conflicts: string[] = [];
  const seenIds = new Set<string>();

  for (const record of [...records.findings, ...records.proposals]) {
    conflicts.push(...recordConflicts(record, records, source, seenIds));
  }

  for (const proposal of records.proposals) {
    conflicts.push(...proposalOverlapConflicts(proposal));
  }

  if (conflicts.length > 0) {
    throw new ReviewConflictError("review records do not match the source", conflicts);
  }

  return {
    ...records,
    findings: [...records.findings].sort(compareFindings),
    proposals: [...records.proposals].sort(compareProposals),
  };
}

function recordConflicts(
  record: Finding | Proposal,
  records: ReviewRecords,
  source: string,
  seenIds: Set<string>,
): string[] {
  const conflicts: string[] = [];
  const sourceReference = record.recordType === "writing-finding"
    ? record.source
    : record.suggestions[0]?.source;
  if (!sourceReference) return conflicts;
  const id = recordId(record);
  if (sourceReference.documentId !== records.documentId) {
    conflicts.push(
      `${id} refers to document ${sourceReference.documentId}, expected ${records.documentId}`,
    );
  }
  if (sourceReference.revision !== records.revision) {
    conflicts.push(
      `${id} refers to revision ${sourceReference.revision}, expected ${records.revision}`,
    );
  }
  if (seenIds.has(id)) conflicts.push(`duplicate record ${id}`);
  seenIds.add(id);

  const verification = record.recordType === "writing-finding"
    ? verifyFindingSource(record, source)
    : verifyProposalSource(record, source);
  if (!verification.ok) {
    conflicts.push(
      `${id} failed source verification: ${verification.conflicts.map(({ kind }) => kind).join(", ")}`,
    );
  }
  return conflicts;
}

export function renderFinding(finding: Finding): string {
  return [
    `Finding ${finding.findingId}`,
    `bytes ${finding.span.startByte}..${finding.span.endByte} | ${finding.category} | ${finding.producer.id}@${finding.producer.version}`,
    finding.span.sourceText,
    finding.reason,
  ].join("\n");
}

export function renderProposalDiff(
  proposal: Proposal,
  source: string,
  path: string,
): string {
  const proposed = applyByteEdits(
    source,
    proposal.suggestions.map(suggestionEdit),
  );
  const revision = proposal.suggestions[0]?.source.revision ?? "source";
  return createTwoFilesPatch(
    `a/${path}`,
    `b/${path}`,
    source,
    proposed,
    revision,
    "proposed",
    { context: 3 },
  );
}

export function validateRecordedDecisions(
  decisions: unknown[],
  proposals: Proposal[],
): Decision[] {
  const byId = new Map(proposals.map((proposal) => [proposal.proposalId, proposal]));
  const seen = new Set<string>();
  return decisions.map((input) => {
    const decision = DecisionSchema.parse(input);
    if (seen.has(decision.proposalId)) {
      throw new ReviewConflictError("decision log is invalid", [
        `duplicate decision for ${decision.proposalId}`,
      ]);
    }
    seen.add(decision.proposalId);
    const proposal = byId.get(decision.proposalId);
    if (!proposal || canonicalJson(proposal) !== canonicalJson(decision.proposal)) {
      throw new ReviewConflictError("decision log is invalid", [
        `${decision.proposalId} does not match a current proposal`,
      ]);
    }
    return decision;
  });
}

export function applyDecisions(source: string, decisions: Decision[]): string {
  const edits = decisions.flatMap((decision) => decisionEdits(decision));
  const conflicts = overlappingEditConflicts(edits);
  if (conflicts.length > 0) {
    throw new ReviewConflictError("accepted decisions overlap", conflicts);
  }
  return applyByteEdits(source, edits);
}

type ByteEdit = {
  startByte: number;
  endByte: number;
  replacement: string;
  ownerId: string;
};

function decisionEdits(decision: Decision): ByteEdit[] {
  if (decision.outcome === "rejected") return [];
  if (decision.outcome === "accepted") {
    return decision.proposal.suggestions.map(suggestionEdit);
  }
  const suggestions = decision.proposal.suggestions;
  const first = suggestions[0];
  const last = suggestions.at(-1);
  if (!first || !last) return [];
  return [{
    startByte: first.span.startByte,
    endByte: last.span.endByte,
    replacement: decision.replacement,
    ownerId: decision.proposalId,
  }];
}

function suggestionEdit(suggestion: Suggestion): ByteEdit {
  return {
    startByte: suggestion.span.startByte,
    endByte: suggestion.span.endByte,
    replacement: suggestion.replacement,
    ownerId: suggestion.suggestionId,
  };
}

function applyByteEdits(source: string, edits: ByteEdit[]): string {
  const bytes = Buffer.from(source, "utf8");
  const sorted = [...edits].sort(
    (left, right) => right.startByte - left.startByte || right.endByte - left.endByte,
  );
  let result = bytes;
  for (const edit of sorted) {
    result = Buffer.concat([
      result.subarray(0, edit.startByte),
      Buffer.from(edit.replacement, "utf8"),
      result.subarray(edit.endByte),
    ]);
  }
  return result.toString("utf8");
}

function proposalOverlapConflicts(proposal: Proposal): string[] {
  return overlappingEditConflicts(proposal.suggestions.map(suggestionEdit)).map(
    (conflict) => `${proposal.proposalId}: ${conflict}`,
  );
}

function overlappingEditConflicts(edits: ByteEdit[]): string[] {
  const sorted = [...edits].sort(
    (left, right) => left.startByte - right.startByte || left.endByte - right.endByte,
  );
  const conflicts: string[] = [];
  for (let index = 1; index < sorted.length; index += 1) {
    const previous = sorted[index - 1];
    const current = sorted[index];
    if (!previous || !current) continue;
    const overlaps = current.startByte < previous.endByte ||
      (current.startByte === previous.startByte &&
        current.endByte === current.startByte &&
        previous.endByte === previous.startByte);
    if (overlaps) {
      conflicts.push(
        `${previous.ownerId} at ${previous.startByte}..${previous.endByte} overlaps ${current.ownerId} at ${current.startByte}..${current.endByte}`,
      );
    }
  }
  return conflicts;
}

function compareProposals(left: Proposal, right: Proposal): number {
  const leftFirst = left.suggestions[0];
  const rightFirst = right.suggestions[0];
  if (!leftFirst || !rightFirst) return 0;
  return compareSuggestions(leftFirst, rightFirst) ||
    compareAscending(left.proposalId, right.proposalId);
}

function recordId(record: Finding | Proposal): string {
  return record.recordType === "writing-finding"
    ? record.findingId
    : record.proposalId;
}

function compareAscending(left: string, right: string): number {
  if (left < right) return -1;
  if (left > right) return 1;
  return 0;
}
