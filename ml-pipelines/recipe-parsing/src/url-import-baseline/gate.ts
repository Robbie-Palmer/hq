import fs from "node:fs";
import type {
  BaselineReport,
  RegressionConfig,
  RegressionGateReport,
  RegressionViolation,
} from "./schema.js";
import {
  FAILURE_CATEGORIES,
  FIELD_NAMES,
  RegressionConfigSchema,
} from "./schema.js";

export function loadRegressionConfig(file: string): RegressionConfig {
  return RegressionConfigSchema.parse(JSON.parse(fs.readFileSync(file, "utf8")));
}

function recordDrop(
  violations: RegressionViolation[],
  metric: string,
  reference: number,
  actual: number,
  allowedRegression: number,
): void {
  if (reference - actual > allowedRegression) {
    violations.push({ metric, reference, actual, allowedRegression });
  }
}

function recordIncrease(
  violations: RegressionViolation[],
  metric: string,
  reference: number,
  actual: number,
  allowedRegression: number,
): void {
  if (actual - reference > allowedRegression) {
    violations.push({ metric, reference, actual, allowedRegression });
  }
}

export function evaluateRegressionGate(
  report: BaselineReport,
  config: RegressionConfig,
): RegressionGateReport {
  if (report.corpusVersion !== config.corpusVersion) {
    throw new Error(
      `Regression reference covers corpus ${config.corpusVersion}, not ${report.corpusVersion}`,
    );
  }
  if (JSON.stringify(report.partitions) !== JSON.stringify(config.partitions)) {
    throw new Error("Regression reference covers different corpus partitions");
  }

  const violations: RegressionViolation[] = [];
  recordDrop(
    violations,
    "summary.usableImportRate",
    config.reference.usableImportRate,
    report.summary.usableImportRate,
    config.budgets.usableImportRateDrop,
  );
  recordDrop(
    violations,
    "ontology.coverage",
    config.reference.ontologyCoverage,
    report.ontology.coverage,
    config.budgets.ontologyCoverageDrop,
  );
  for (const field of FIELD_NAMES) {
    const reference = config.reference.fieldMetrics[field];
    const actual = report.fieldMetrics[field];
    recordDrop(
      violations,
      `fieldMetrics.${field}.precision`,
      reference.precision,
      actual.precision,
      config.budgets.fieldPrecisionDrop,
    );
    recordDrop(
      violations,
      `fieldMetrics.${field}.recall`,
      reference.recall,
      actual.recall,
      config.budgets.fieldRecallDrop,
    );
  }
  for (const category of FAILURE_CATEGORIES) {
    recordIncrease(
      violations,
      `failureCounts.${category}`,
      config.reference.failureCounts[category],
      report.failureCounts[category],
      config.budgets.failureCountIncrease,
    );
  }

  return {
    schemaVersion: 1,
    recordType: "recipe-url-import-regression-gate",
    corpusVersion: report.corpusVersion,
    cacheKey: report.cacheKey,
    passed: violations.length === 0,
    budgets: config.budgets,
    violations,
  };
}
