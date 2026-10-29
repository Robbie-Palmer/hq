import { describe, expect, it } from "vitest";
import { RepositorySnapshotSchema } from "../src/repositories";
import {
  DerivedSeriesDefinitionSchema,
  MetricObservationSchema,
  projectMetricSeries,
} from "../src/telemetry";
import { period, provenance } from "./fixtures";

describe("repository snapshots", () => {
  const snapshot = {
    id: "snapshot:site:1",
    projectId: "project:site",
    repositoryId: "repository:personal-site",
    commitSha: "a".repeat(40),
    scopeId: "scope:site",
    observedAt: "2026-02-02T00:00:00.000Z",
    languageInventory: {
      includedBytes: 150,
      languages: [
        { language: "TypeScript", bytes: 100 },
        { language: "CSS", bytes: 50 },
      ],
      method: "project-path-scan",
    },
    sourceLineInventory: {
      sourceLines: [
        { language: "TypeScript", classification: "production", lines: 20 },
        { language: "TypeScript", classification: "test", lines: 10 },
      ],
      documentationLines: 12,
      counter: "tokei",
      counterVersion: "13.0.0",
      classificationRulesVersion: "1",
    },
    excludedPathRules: ["**/generated/**"],
    exceptions: [],
    provenance: provenance("snapshot:site:1"),
  } as const;

  it("binds language and source-line measurements to a commit", () => {
    const parsed = RepositorySnapshotSchema.parse(snapshot);

    expect(parsed.commitSha).toHaveLength(40);
    expect(parsed.sourceLineInventory.documentationLines).toBe(12);
  });

  it("rejects unpinned or unreconciled inventories", () => {
    expect(() =>
      RepositorySnapshotSchema.parse({ ...snapshot, commitSha: "main" }),
    ).toThrow();
    expect(() =>
      RepositorySnapshotSchema.parse({
        ...snapshot,
        languageInventory: { ...snapshot.languageInventory, includedBytes: 151 },
      }),
    ).toThrow(/reconcile/);
  });

  it("rejects duplicate language and source-line inventory keys", () => {
    expect(() =>
      RepositorySnapshotSchema.parse({
        ...snapshot,
        languageInventory: {
          ...snapshot.languageInventory,
          languages: [
            { language: "TypeScript", bytes: 100 },
            { language: "TypeScript", bytes: 50 },
          ],
        },
      }),
    ).toThrow(/repeat a language/);
    expect(() =>
      RepositorySnapshotSchema.parse({
        ...snapshot,
        sourceLineInventory: {
          ...snapshot.sourceLineInventory,
          sourceLines: [
            { language: "TypeScript", classification: "test", lines: 20 },
            { language: "TypeScript", classification: "test", lines: 10 },
          ],
        },
      }),
    ).toThrow(/repeat a language and classification/);
  });
});

describe("metric observations and derived series", () => {
  const available = MetricObservationSchema.parse({
    id: "observation:requests:1",
    projectId: "project:site",
    environmentId: "environment:production",
    metricDefinitionId: "metric:failure-rate",
    metricDefinitionVersion: "1",
    period,
    dimensions: { service: "api" },
    state: "available",
    value: 0.02,
    numerator: 2,
    denominator: 100,
    coverage: 1,
    limitation: null,
    provenance: provenance("metric:failure-rate:2026-01"),
  });

  it("keeps unavailable states non-numeric", () => {
    expect(
      MetricObservationSchema.parse({
        ...available,
        id: "observation:private",
        state: "withheld",
        value: null,
        numerator: null,
        denominator: null,
        coverage: null,
        limitation: "Below the publication threshold.",
        provenance: provenance("metric:private"),
      }).state,
    ).toBe("withheld");

    expect(() =>
      MetricObservationSchema.parse({
        ...available,
        state: "withheld",
      }),
    ).toThrow(/carry a value/);
    expect(() =>
      MetricObservationSchema.parse({
        ...available,
        value: 0,
        numerator: 0,
        denominator: 0,
      }),
    ).toThrow(/zero-denominator/);
  });

  it("requires partial observations and ratio parts to be complete", () => {
    expect(() =>
      MetricObservationSchema.parse({
        ...available,
        state: "partial",
        limitation: null,
      }),
    ).toThrow(/must state its limitation/);
    expect(
      MetricObservationSchema.parse({
        ...available,
        state: "partial",
        limitation: "The provider sampled requests.",
      }).state,
    ).toBe("partial");
    expect(() =>
      MetricObservationSchema.parse({
        ...available,
        numerator: 2,
        denominator: null,
      }),
    ).toThrow(/both numerator and denominator/);
    expect(() =>
      MetricObservationSchema.parse({
        ...available,
        numerator: null,
        denominator: 100,
      }),
    ).toThrow(/both numerator and denominator/);
  });

  it("projects ordered current observations and records derived inputs", () => {
    const later = MetricObservationSchema.parse({
      ...available,
      id: "observation:requests:2",
      period: {
        startsAt: "2026-02-01T00:00:00.000Z",
        endsAt: "2026-03-01T00:00:00.000Z",
      },
      provenance: provenance("metric:failure-rate:2026-02"),
    });
    const series = projectMetricSeries(
      [later, available],
      "metric:failure-rate",
      "project:site",
    );
    const derived = DerivedSeriesDefinitionSchema.parse({
      id: "series:availability",
      version: "1",
      outputMetricDefinitionId: "metric:availability",
      inputs: [
        {
          metricDefinitionId: "metric:successful-probes",
          metricDefinitionVersion: "1",
          alias: "successful",
        },
        {
          metricDefinitionId: "metric:completed-probes",
          metricDefinitionVersion: "1",
          alias: "completed",
        },
      ],
      expression: "successful / completed",
      provenance: provenance("series:availability"),
    });

    expect(series.map(({ id }) => id)).toEqual([
      "observation:requests:1",
      "observation:requests:2",
    ]);
    expect(derived.inputs).toHaveLength(2);
  });

  it("filters metric series by metric and project and breaks period ties by id", () => {
    const tied = MetricObservationSchema.parse({
      ...available,
      id: "observation:requests:0",
      provenance: provenance("metric:failure-rate:2026-01:tied"),
    });
    const otherMetric = MetricObservationSchema.parse({
      ...available,
      id: "observation:latency",
      metricDefinitionId: "metric:latency",
      provenance: provenance("metric:latency:2026-01"),
    });
    const otherProject = MetricObservationSchema.parse({
      ...available,
      id: "observation:other-project",
      projectId: "project:api",
      provenance: provenance("metric:failure-rate:api:2026-01"),
    });

    expect(
      projectMetricSeries(
        [available, otherMetric, otherProject, tied],
        "metric:failure-rate",
        "project:site",
      ).map(({ id }) => id),
    ).toEqual(["observation:requests:0", "observation:requests:1"]);
  });
});
