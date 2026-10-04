#!/usr/bin/env tsx

import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";

const require = createRequire(import.meta.url);

export const componentLimits = {
  lines: 60,
  nesting: 4,
  responsibility: 30,
  renderComplexity: 10,
} as const;

interface ComponentLimits {
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

export function formatHotspotReport(
  findings: Finding[],
  maximumFindings = 25,
): string[] {
  const displayedFindings = findings.slice(0, maximumFindings);
  const lines = [
    `tsmetrics found ${findings.length} React component hotspots; showing the highest ${maximumFindings}.`,
  ];

  for (const finding of displayedFindings) {
    lines.push(
      `${finding.path}:${finding.line} ${finding.name}: ${finding.reasons.join(", ")}`,
    );
  }

  lines.push(
    "This report is advisory while the existing hotspot backlog is reduced; new repeated JSX is enforced separately.",
  );

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

  for (const line of formatHotspotReport(findings)) {
    writeLine(line);
  }

  return 0;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exitCode = runAudit();
}
