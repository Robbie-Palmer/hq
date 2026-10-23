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
    workspace.attribute_allowlist.metric_dimensions.push("trace_id");

    expect(validateOpenTelemetryConformance(contract, fixtures)).toContain(
      "agent-workspace: allows forbidden metric attribute 'trace_id'",
    );
  });

  it("permits a high-cardinality attribute on spans and logs", async () => {
    const [contract, fixtures] = await Promise.all([
      loadOpenTelemetryContract(repositoryRoot),
      loadOpenTelemetryFixtures(repositoryRoot),
    ]);
    const workspace = fixtures.find(
      ({ runtime }) => runtime === "agent-workspace",
    );
    if (!workspace) throw new Error("Missing agent workspace fixture");
    workspace.attribute_allowlist.span_and_log_attributes.push("trace_id");

    expect(validateOpenTelemetryConformance(contract, fixtures)).toEqual([]);
  });

  it("rejects an explicitly prohibited attribute key", async () => {
    const [contract, fixtures] = await Promise.all([
      loadOpenTelemetryContract(repositoryRoot),
      loadOpenTelemetryFixtures(repositoryRoot),
    ]);
    const worker = fixtures.find(
      ({ runtime }) => runtime === "typescript-worker",
    );
    if (!worker) throw new Error("Missing TypeScript Worker fixture");
    worker.attribute_allowlist.span_and_log_attributes.push("url.query");

    expect(validateOpenTelemetryConformance(contract, fixtures)).toContain(
      "typescript-worker: span_and_log_attributes allowlist includes prohibited attribute 'url.query'",
    );
  });

  it("rejects an attribute covered by a prohibited prefix", async () => {
    const [contract, fixtures] = await Promise.all([
      loadOpenTelemetryContract(repositoryRoot),
      loadOpenTelemetryFixtures(repositoryRoot),
    ]);
    const python = fixtures.find(({ runtime }) => runtime === "python-service");
    if (!python) throw new Error("Missing Python fixture");
    python.attribute_allowlist.metric_dimensions.push(
      "db.query.parameter.customer_id",
    );

    expect(validateOpenTelemetryConformance(contract, fixtures)).toContain(
      "python-service: metric_dimensions allowlist includes prohibited attribute 'db.query.parameter.customer_id'",
    );
  });

  it("rejects an incomplete or ambiguous security policy", async () => {
    const [contract, fixtures] = await Promise.all([
      loadOpenTelemetryContract(repositoryRoot),
      loadOpenTelemetryFixtures(repositoryRoot),
    ]);
    contract.data_policy.prohibited_attribute_keys.exact.push("url.query");
    contract.data_policy.prohibited_attribute_keys.prefixes.push("env.", "unsafe");
    contract.data_policy.prohibited_content_classes.pop();
    contract.data_policy.prohibited_content_classes.push("credential");
    contract.data_policy.enforcement_surfaces.pop();
    contract.data_policy.enforcement_surfaces.push("log-body");
    contract.cardinality.forbidden_metric_attributes.push("trace_id");
    const workspace = fixtures.find(
      ({ runtime }) => runtime === "agent-workspace",
    );
    if (!workspace) throw new Error("Missing agent workspace fixture");
    workspace.attribute_allowlist.metric_dimensions.push("error.type");

    expect(validateOpenTelemetryConformance(contract, fixtures)).toEqual(
      expect.arrayContaining([
        "Data policy must prohibit every security content class",
        "Data policy must cover every security enforcement surface",
        "Duplicate forbidden metric attribute 'trace_id'",
        "Duplicate prohibited attribute key 'url.query'",
        "Duplicate prohibited attribute prefix 'env.'",
        "Duplicate prohibited content class 'credential'",
        "Duplicate security enforcement surface 'log-body'",
        "Prohibited attribute prefix 'unsafe' must end with '.'",
        "agent-workspace: duplicate metric_dimensions entry 'error.type'",
      ]),
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
