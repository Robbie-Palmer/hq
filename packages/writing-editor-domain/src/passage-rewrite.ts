import { diffChars } from "diff";
import { z } from "zod";

import {
  PassageEvidenceGateSchema,
  type Proposal,
  createProposal,
} from "./proposals";
import {
  RetrievedPassageContextSchema,
} from "./passage-context";
import {
  createSuggestion,
  ProducerSchema,
  sourceReference,
  type Suggestion,
  Utf8SpanSchema,
} from "./suggestions";

export const PassageRewriteRequestSchema = z.object({
  documentId: z.string().trim().min(1),
  revision: z.string().trim().min(1),
  source: z.string(),
  passage: Utf8SpanSchema,
  proposedPassage: z.string(),
  reason: z.string().trim().min(1),
  producer: ProducerSchema,
  context: RetrievedPassageContextSchema,
  evidenceGate: PassageEvidenceGateSchema,
}).strict();

export type PassageRewriteRequest = z.input<typeof PassageRewriteRequestSchema>;

export function createPassageRewrite(input: PassageRewriteRequest): Proposal {
  const request = PassageRewriteRequestSchema.parse(input);
  verifySelectedPassage(request.source, request.passage);
  if (request.passage.sourceText === request.proposedPassage) {
    throw new Error("a passage rewrite must change the selected passage");
  }

  const reference = sourceReference(
    request.documentId,
    request.revision,
    request.source,
  );
  let sourceByteOffset = request.passage.startByte;
  let original = "";
  let replacement = "";
  let segment = 0;
  const suggestions: Suggestion[] = [];

  const flush = () => {
    if (original === "" && replacement === "") return;
    segment += 1;
    const startByte = sourceByteOffset;
    const endByte = startByte + Buffer.byteLength(original, "utf8");
    suggestions.push(createSuggestion({
      producer: request.producer,
      source: reference,
      span: { startByte, endByte, sourceText: original },
      replacement,
      category: "passage-rewrite",
      reason: `Grouped passage rewrite segment ${segment}: ${request.reason}`,
    }));
    sourceByteOffset = endByte;
    original = "";
    replacement = "";
  };

  for (const change of diffChars(request.passage.sourceText, request.proposedPassage)) {
    if (change.added) {
      replacement += change.value;
    } else if (change.removed) {
      original += change.value;
    } else {
      flush();
      sourceByteOffset += Buffer.byteLength(change.value, "utf8");
    }
  }
  flush();

  if (suggestions.length === 0) {
    throw new Error("the passage rewrite did not produce an actionable suggestion");
  }
  if (sourceByteOffset !== request.passage.endByte) {
    throw new Error("the passage rewrite did not consume the selected source bytes");
  }

  return createProposal(suggestions, {
    review: {
      kind: "passage-rewrite",
      passage: request.passage,
      proposedText: request.proposedPassage,
      reason: request.reason,
      context: request.context,
      authority: { factChecking: "author", publication: "author" },
      evidenceGate: request.evidenceGate,
      defaultLoopEligible: request.evidenceGate.decision === "adopt",
    },
  });
}

function verifySelectedPassage(
  source: string,
  passage: z.infer<typeof Utf8SpanSchema>,
): void {
  const bytes = Buffer.from(source, "utf8");
  if (passage.endByte > bytes.byteLength) {
    throw new Error("the selected passage is outside the source");
  }
  if (!isUtf8Boundary(bytes, passage.startByte) || !isUtf8Boundary(bytes, passage.endByte)) {
    throw new Error("the selected passage must use UTF-8 byte boundaries");
  }
  if (!bytes.subarray(passage.startByte, passage.endByte).equals(
    Buffer.from(passage.sourceText, "utf8"),
  )) {
    throw new Error("the selected passage does not match the source bytes");
  }
}

function isUtf8Boundary(bytes: Uint8Array, offset: number): boolean {
  const byte = bytes[offset];
  return byte === undefined || (byte & 0xc0) !== 0x80;
}
