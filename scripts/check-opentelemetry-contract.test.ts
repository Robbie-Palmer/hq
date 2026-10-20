import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  loadOpenTelemetryContract,
  loadOpenTelemetryFixtures,
  parseOpenTelemetryContract,
  validateOpenTelemetryConformance,
} from "./check-opentelemetry-contract.js";

const repositoryRoot = path.resolve(import.meta.dirname, "..");

describe("OpenTelemetry contract", () => {
  it("accepts all runtime conformance fixtures", async () => {
    const [contract, fixtures] = await Promise.all([
      loadOpenTelemetryContract(repositoryRoot),
      loadOpenTelemetryFixtures(repositoryRoot),
    ]);

    expect(validateOpenTelemetryConformance(contract, fixtures)).toEqual([]);
  });

  it("rejects transport that bypasses the runtime default", async () => {
    const [contract, fixtures] = await Promise.all([
      loadOpenTelemetryContract(repositoryRoot),
      loadOpenTelemetryFixtures(repositoryRoot),
    ]);
    const kubernetes = fixtures.find(
      ({ runtime }) => runtime === "kubernetes-workload",
    );
    if (!kubernetes) throw new Error("Missing Kubernetes fixture");
    kubernetes.transport.route = "direct";

    expect(validateOpenTelemetryConformance(contract, fixtures)).toContain(
      "kubernetes-workload: transport does not match its runtime default",
    );
  });

  it("rejects duplicate and missing runtime fixtures", async () => {
    const [contract, fixtures] = await Promise.all([
      loadOpenTelemetryContract(repositoryRoot),
      loadOpenTelemetryFixtures(repositoryRoot),
    ]);
    fixtures.push(structuredClone(fixtures[0]));

    expect(validateOpenTelemetryConformance(contract, fixtures)).toContain(
      "Duplicate conformance fixture for 'agent-workspace'",
    );

    const withoutPython = fixtures.filter(
      ({ runtime }) => runtime !== "python-service",
    );
    expect(validateOpenTelemetryConformance(contract, withoutPython)).toContain(
      "Fixtures must cover each required runtime exactly once",
    );
  });

  it("requires workspace identity for agent telemetry", async () => {
    const [contract, fixtures] = await Promise.all([
      loadOpenTelemetryContract(repositoryRoot),
      loadOpenTelemetryFixtures(repositoryRoot),
    ]);
    const workspace = fixtures.find(
      ({ runtime }) => runtime === "agent-workspace",
    );
    if (!workspace) throw new Error("Missing agent workspace fixture");
    delete workspace.resource["me.robbiepalmer.workspace.id"];

    expect(validateOpenTelemetryConformance(contract, fixtures)).toContain(
      "agent-workspace: agent workspace needs 'me.robbiepalmer.workspace.id'",
    );
  });

  it("rejects high-cardinality metric dimensions", async () => {
    const [contract, fixtures] = await Promise.all([
      loadOpenTelemetryContract(repositoryRoot),
      loadOpenTelemetryFixtures(repositoryRoot),
    ]);
    const workspace = fixtures.find(
      ({ runtime }) => runtime === "agent-workspace",
    );
    if (!workspace) throw new Error("Missing agent workspace fixture");
    workspace.allowed_attributes.push("trace_id");

    expect(validateOpenTelemetryConformance(contract, fixtures)).toContain(
      "agent-workspace: allows prohibited metric dimension 'trace_id'",
    );
  });

  it("reports malformed contracts before conformance validation", () => {
    expect(() =>
      parseOpenTelemetryContract({
        schema_version: 1,
        contract: "opentelemetry",
        signals: { required: ["traces"] },
      }),
    ).toThrow(/signals\.deferred/);
  });
});
