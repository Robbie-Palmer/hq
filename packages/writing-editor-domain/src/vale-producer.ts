import { execFileSync } from "node:child_process";

import { z } from "zod";

import { createFinding, type Finding } from "./findings";
import { createProposal, type Proposal } from "./proposals";
import {
  createSuggestion,
  sourceReference,
} from "./suggestions";

export const UNSLOP_RULE_CLASSIFICATION = {
  "Unslop.AIVocabulary": "finding-only",
  "Unslop.AnnouncedDistinction": "finding-only",
  "Unslop.ChatbotPhrases": "finding-only",
  "Unslop.ContrastFormula": "finding-only",
  "Unslop.CurlyQuotes": "safely-rewritable",
  "Unslop.CutoffDisclaimer": "finding-only",
  "Unslop.EmDash": "finding-only",
  "Unslop.FillerPhrases": "finding-only",
  "Unslop.IngClauses": "finding-only",
  "Unslop.MetaphorNouns": "finding-only",
  "Unslop.NotJustBut": "finding-only",
  "Unslop.PlainWords": "finding-only",
  "Unslop.PlainWordsSafe": "safely-rewritable",
  "Unslop.Promotional": "finding-only",
  "Unslop.Puffery": "finding-only",
  "Unslop.ServesAs": "finding-only",
  "Unslop.Sycophancy": "finding-only",
  "Unslop.VagueAttribution": "finding-only",
} as const;

export type UnslopRuleClassification =
  typeof UNSLOP_RULE_CLASSIFICATION[keyof typeof UNSLOP_RULE_CLASSIFICATION];

const ValeAlertSchema = z.looseObject({
  Span: z.tuple([z.number().int().positive(), z.number().int().positive()]),
  Check: z.string().trim().min(1),
  Message: z.string().trim().min(1),
  Severity: z.enum(["error", "warning", "suggestion"]),
  Match: z.string().min(1),
  Line: z.number().int().positive(),
});
const ValeJsonSchema = z.record(z.string(), z.array(ValeAlertSchema));
type ValeAlert = z.infer<typeof ValeAlertSchema>;

export type DeterministicProducerResult = {
  documentId: string;
  revision: string;
  findings: Finding[];
  proposals: Proposal[];
};

export function runValeDeterministicProducer(options: {
  source: string;
  sourcePath: string;
  documentId: string;
  revision: string;
  configPath: string;
  valeBinary?: string;
}): DeterministicProducerResult {
  const valeBinary = options.valeBinary ?? "vale";
  const version = valeVersion(valeBinary);
  const output = execFileSync(valeBinary, [
    "--no-exit",
    "--no-global",
    "--config",
    options.configPath,
    "--minAlertLevel",
    "suggestion",
    "--output",
    "JSON",
    options.sourcePath,
  ], { encoding: "utf8", maxBuffer: 20 * 1024 * 1024 });
  const parsed = ValeJsonSchema.parse(JSON.parse(output || "{}"));
  const resolvedSourcePath = normalizePath(options.sourcePath);
  const alerts = Object.entries(parsed).flatMap(([reportedPath, records]) => {
    if (normalizePath(reportedPath) !== resolvedSourcePath) {
      throw new Error(`Vale returned an unexpected source path: ${reportedPath}`);
    }
    return records;
  });
  return valeAlertsToReviewRecords({
    source: options.source,
    documentId: options.documentId,
    revision: options.revision,
    producerVersion: `vale@${version}`,
    alerts,
  });
}

export function valeAlertsToReviewRecords(options: {
  source: string;
  documentId: string;
  revision: string;
  producerVersion: string;
  alerts: unknown[];
}): DeterministicProducerResult {
  const source = sourceReference(options.documentId, options.revision, options.source);
  const findings: Finding[] = [];
  const proposals: Proposal[] = [];

  for (const input of options.alerts) {
    const alert = ValeAlertSchema.parse(input);
    const span = sourcePosition(options.source, alert);
    const classification = ruleClassification(alert.Check);
    const producer = {
      id: "vale-deterministic",
      version: options.producerVersion,
      provenance: { kind: "rule" as const, ruleId: alert.Check },
    };
    if (classification === "safely-rewritable") {
      if (alert.Check === "Unslop.PlainWordsSafe" &&
        hasAdjacentLetter(options.source, span)) {
        throw new Error(
          `${alert.Check} matched ${JSON.stringify(span.sourceText)} inside a larger word`,
        );
      }
      const replacement = safeReplacement(alert.Check, span.sourceText);
      if (replacement === undefined) {
        throw new Error(
          `${alert.Check} is classified as safely rewritable but has no exact replacement for ${JSON.stringify(span.sourceText)}`,
        );
      }
      proposals.push(createProposal([createSuggestion({
        producer,
        source,
        span,
        replacement,
        category: category(alert.Check),
        reason: alert.Message,
        confidence: 1,
      })]));
      continue;
    }
    findings.push(createFinding({
      producer,
      source,
      span,
      category: category(alert.Check),
      reason: alert.Message,
    }));
  }

  return {
    documentId: options.documentId,
    revision: options.revision,
    findings,
    proposals,
  };
}

function ruleClassification(check: string): UnslopRuleClassification {
  if (!check.startsWith("Unslop.")) return "finding-only";
  const classification = UNSLOP_RULE_CLASSIFICATION[
    check as keyof typeof UNSLOP_RULE_CLASSIFICATION
  ];
  if (!classification) {
    throw new Error(`Unslop rule ${check} has no rewrite safety classification`);
  }
  return classification;
}

function safeReplacement(check: string, match: string): string | undefined {
  if (check === "Unslop.CurlyQuotes") {
    return match.replaceAll("“", '"').replaceAll("”", '"');
  }
  if (check !== "Unslop.PlainWordsSafe") return undefined;
  const replacements: Record<string, string> = {
    commence: "begin",
    endeavor: "try",
    endeavour: "try",
    expedite: "speed up",
    numerous: "many",
    utilise: "use",
    utilize: "use",
  };
  const replacement = replacements[match.toLowerCase()];
  if (!replacement) return undefined;
  return /^[A-Z]/.test(match)
    ? replacement[0]?.toUpperCase() + replacement.slice(1)
    : replacement;
}

function hasAdjacentLetter(
  source: string,
  span: { startByte: number; endByte: number },
): boolean {
  const bytes = Buffer.from(source, "utf8");
  const before = Array.from(bytes.subarray(0, span.startByte).toString("utf8")).at(-1);
  const after = Array.from(bytes.subarray(span.endByte).toString("utf8"))[0];
  return (before !== undefined && /\p{L}/u.test(before)) ||
    (after !== undefined && /\p{L}/u.test(after));
}

function sourcePosition(source: string, alert: ValeAlert) {
  const lines = source.split("\n");
  const line = lines[alert.Line - 1];
  if (line === undefined) throw new Error(`Vale reported missing line ${alert.Line}`);
  const characters = Array.from(line);
  const startCharacter = alert.Span[0] - 1;
  const endCharacter = alert.Span[1];
  if (startCharacter >= characters.length || endCharacter > characters.length) {
    throw new Error(`Vale span ${alert.Line}:${alert.Span[0]}-${alert.Span[1]} is outside the source line`);
  }
  const priorLines = lines.slice(0, alert.Line - 1).join("\n");
  const lineStart = alert.Line === 1 ? "" : `${priorLines}\n`;
  const prefix = characters.slice(0, startCharacter).join("");
  const sourceText = characters.slice(startCharacter, endCharacter).join("");
  const startByte = Buffer.byteLength(lineStart + prefix, "utf8");
  return {
    startByte,
    endByte: startByte + Buffer.byteLength(sourceText, "utf8"),
    sourceText,
  };
}

function valeVersion(binary: string): string {
  const output = execFileSync(binary, ["--version"], { encoding: "utf8" }).trim();
  const match = /^vale version (\d+\.\d+\.\d+)$/.exec(output);
  if (!match?.[1]) throw new Error(`cannot parse Vale version from ${JSON.stringify(output)}`);
  return match[1];
}

function normalizePath(value: string): string {
  return value.replaceAll("\\", "/").replace(/^\.\//, "");
}

function category(check: string): string {
  return `style/${check.split(".").map(kebabCase).join("/")}`;
}

function kebabCase(value: string): string {
  return value.replace(/([a-z0-9])([A-Z])/g, "$1-$2").toLowerCase();
}
