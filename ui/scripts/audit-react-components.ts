#!/usr/bin/env tsx

import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";
import hotspotBaseline from "./react-component-hotspot-baseline.json";

const require = createRequire(import.meta.url);

export const componentLimits = {
  lines: 60,
  nesting: 4,
  responsibility: 30,
  renderComplexity: 10,
} as const;

export interface ComponentLimits {
  lines: number;
  nesting: number;
  renderComplexity: number;
  responsibility: number;
}

export interface FunctionMetrics {
  component_responsibility: number;
  line: number;
  loc: number;
  max_nesting: number;
  name: string;
  render_complexity: number;
}

export interface FileMetrics {
  functions: FunctionMetrics[];
  path: string;
}

export interface MetricsReport {
  files: FileMetrics[];
}

export interface Finding extends FunctionMetrics {
  path: string;
  reasons: string[];
}

type ComponentMetric = keyof ComponentLimits;

export interface HotspotException {
  component: string;
  maximums: Partial<ComponentLimits>;
  path: string;
  reason: string;
}

export interface AuditResult {
  allowed: Finding[];
  staleExceptions: HotspotException[];
  violations: Finding[];
}

interface AnalysisResult {
  error?: Error;
  status: number | null;
  stderr: string;
  stdout: string;
}

type Analyze = () => AnalysisResult;

function componentReasons(
  metrics: FunctionMetrics,
  limits: ComponentLimits,
): string[] {
  return [
    metrics.loc >= limits.lines
      ? `${metrics.loc} lines (limit ${limits.lines})`
      : undefined,
    metrics.max_nesting >= limits.nesting
      ? `nesting ${metrics.max_nesting} (limit ${limits.nesting})`
      : undefined,
    metrics.component_responsibility >= limits.responsibility
      ? `responsibility ${metrics.component_responsibility} (limit ${limits.responsibility})`
      : undefined,
    metrics.render_complexity >= limits.renderComplexity
      ? `render complexity ${metrics.render_complexity} (limit ${limits.renderComplexity})`
      : undefined,
  ].filter((reason): reason is string => reason !== undefined);
}

export function findReactComponentHotspots(
  report: MetricsReport,
  limits: ComponentLimits = componentLimits,
): Finding[] {
  const findings: Finding[] = [];

  for (const file of report.files) {
    for (const metrics of file.functions) {
      if (
        metrics.component_responsibility <= 0 ||
        !/^[A-Z]/u.test(metrics.name)
      ) {
        continue;
      }

      const reasons = componentReasons(metrics, limits);

      if (reasons.length > 0) {
        findings.push({ ...metrics, path: file.path, reasons });
      }
    }
  }

  return findings.sort(
    (left, right) =>
      right.component_responsibility - left.component_responsibility ||
      right.render_complexity - left.render_complexity ||
      right.loc - left.loc,
  );
}

const metricAccessors: Record<
  ComponentMetric,
  (finding: Finding) => number
> = {
  lines: (finding) => finding.loc,
  nesting: (finding) => finding.max_nesting,
  renderComplexity: (finding) => finding.render_complexity,
  responsibility: (finding) => finding.component_responsibility,
};

function exceptionKey(path: string, component: string): string {
  return `${path}:${component}`;
}

function exceptionAllowsFinding(
  finding: Finding,
  exception: HotspotException,
): boolean {
  return (Object.keys(componentLimits) as ComponentMetric[]).every((metric) => {
    const value = metricAccessors[metric](finding);
    const limit = componentLimits[metric];

    if (value < limit) return true;

    const maximum = exception.maximums[metric];
    return maximum !== undefined && value <= maximum;
  });
}

export function auditHotspots(
  findings: Finding[],
  exceptions: readonly HotspotException[],
): AuditResult {
  const exceptionsByKey = new Map<string, HotspotException>();

  for (const exception of exceptions) {
    const key = exceptionKey(exception.path, exception.component);
    if (exceptionsByKey.has(key)) {
      throw new Error(`Duplicate React component hotspot exception: ${key}`);
    }
    exceptionsByKey.set(key, exception);
  }

  const allowed: Finding[] = [];
  const violations: Finding[] = [];
  const matchedKeys = new Set<string>();

  for (const finding of findings) {
    const key = exceptionKey(finding.path, finding.name);
    const exception = exceptionsByKey.get(key);

    if (exception) {
      matchedKeys.add(key);
      if (exceptionAllowsFinding(finding, exception)) {
        allowed.push(finding);
      } else {
        violations.push(finding);
      }
    } else {
      violations.push(finding);
    }
  }

  const staleExceptions = exceptions.filter(
    (exception) =>
      !matchedKeys.has(exceptionKey(exception.path, exception.component)),
  );

  return { allowed, staleExceptions, violations };
}

export function formatAuditReport(
  result: AuditResult,
  maximumFindings = 25,
): string[] {
  if (result.violations.length === 0 && result.staleExceptions.length === 0) {
    return [
      `tsmetrics passed with ${result.allowed.length} reviewed component-level exceptions.`,
    ];
  }

  const displayedFindings = result.violations.slice(0, maximumFindings);
  const lines = [
    `tsmetrics found ${result.violations.length} unapproved React component hotspots and ${result.staleExceptions.length} stale exceptions.`,
  ];

  for (const finding of displayedFindings) {
    lines.push(
      `${finding.path}:${finding.line} ${finding.name}: ${finding.reasons.join(", ")}`,
    );
  }

  for (const exception of result.staleExceptions.slice(0, maximumFindings)) {
    lines.push(
      `${exception.path} ${exception.component}: exception is stale or its metric ceilings are incomplete`,
    );
  }

  lines.push("Update the component or narrow baseline in the same change.");

  return lines;
}

function analyzeWithTsmetrics(): AnalysisResult {
  const analysis = spawnSync(
    process.execPath,
    [
      require.resolve("tsmetrics/bin/tsmetrics.js"),
      "analyze",
      "app",
      "components",
      "--format",
      "json",
      "--config",
      "tsmetrics.yaml",
    ],
    {
      cwd: process.cwd(),
      encoding: "utf8",
      maxBuffer: 32 * 1024 * 1024,
    },
  );

  return {
    error: analysis.error,
    status: analysis.status,
    stderr: analysis.stderr,
    stdout: analysis.stdout,
  };
}

export function runAudit(
  analyze: Analyze = analyzeWithTsmetrics,
  writeLine: (line: string) => void = console.log,
  writeError: (message: string) => void = (message) =>
    process.stderr.write(message),
  exceptions: readonly HotspotException[] = hotspotBaseline,
): number {
  const analysis = analyze();

  if (analysis.error) {
    throw analysis.error;
  }

  if (analysis.status !== 0) {
    writeError(analysis.stderr);
    return analysis.status ?? 1;
  }

  const report = JSON.parse(analysis.stdout) as MetricsReport;
  const findings = findReactComponentHotspots(report);
  const result = auditHotspots(findings, exceptions);

  for (const line of formatAuditReport(result)) {
    writeLine(line);
  }

  return result.violations.length === 0 && result.staleExceptions.length === 0
    ? 0
    : 1;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exitCode = runAudit();
}
