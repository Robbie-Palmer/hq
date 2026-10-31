import { readFile } from "node:fs/promises";
import { parse } from "yaml";
import { describe, expect, it } from "vitest";
import {
  type DeploymentMaturityContract,
  parseDeploymentMaturityContract,
} from "../src/deployment-maturity";
import {
  compileDeploymentTarget,
  compileScoreWorkload,
  parseWorkloadDefinition,
  renderWorkloadDocumentation,
  type WorkloadDefinition,
  workloadCompatibilityFindings,
} from "../src/workload";

const fixtureRoot = new URL("./fixtures/workload/", import.meta.url);
const maturityUrl = new URL(
  "../../../ui/content/projects/personal-engineering-platform/deployment-maturity.yaml",
  import.meta.url,
);
const documentationUrl = new URL(
  "../../../docs/contracts/workload-definition.md",
  import.meta.url,
);

async function loadYaml(url: URL): Promise<unknown> {
  return parse(await readFile(url, "utf8"));
}

async function loadMaturity(): Promise<DeploymentMaturityContract> {
  return parseDeploymentMaturityContract(await loadYaml(maturityUrl));
}

async function loadDefinition(name: string): Promise<WorkloadDefinition> {
  return parseWorkloadDefinition(
    await loadYaml(new URL(name, fixtureRoot)),
    await loadMaturity(),
  );
}

describe("workload definition contract", () => {
  it("promotes the ADR 043 evidence fields into strict version 1", async () => {
    const [evidence, definition] = await Promise.all([
      loadYaml(new URL("portable-workload-v0.yaml", fixtureRoot)) as Promise<{
        workload: Record<string, unknown>;
      }>,
      loadDefinition("portable-workload-v1.yaml"),
    ]);

    expect(definition.contract_version).toBe(1);
    expect(definition.workload).toMatchObject({
      id: evidence.workload.id,
      ports: evidence.workload.ports,
      health: {
        liveness: { path: "/health/live", port: "http" },
        readiness: { path: "/health/ready", port: "http" },
      },
      resources: evidence.workload.resources,
      telemetry: {
        contract_version: 1,
        transport: "otlp-http-protobuf",
      },
    });
    expect(definition.release.artifact).toMatchObject({
      kind: "oci-image",
      digest:
        "sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      signature: { kind: "sigstore-bundle" },
    });
  });

  it("rejects unknown fields and mismatched artifact families", async () => {
    const value = structuredClone(
      await loadYaml(new URL("portable-workload-v1.yaml", fixtureRoot)),
    ) as Record<string, unknown>;
    value.undocumented_escape_hatch = true;
    expect(() => parseWorkloadDefinition(value)).toThrow(/Unrecognized key/);

    delete value.undocumented_escape_hatch;
    const release = value.release as Record<string, unknown>;
    const artifact = release.artifact as Record<string, unknown>;
    artifact.kind = "cloudflare-worker-bundle";
    expect(() => parseWorkloadDefinition(value)).toThrow(
      /container workloads require an OCI image/,
    );
  });

  it("rejects required behavior that an adapter drops", async () => {
    const value = structuredClone(
      await loadYaml(new URL("portable-workload-v1.yaml", fixtureRoot)),
    ) as Record<string, unknown>;
    const workload = value.workload as Record<string, unknown>;
    const requirements = workload.capability_requirements as Array<
      Record<string, unknown>
    >;
    const probes = requirements.find(
      ({ capability }) => capability === "http-health-checks",
    );
    if (!probes) throw new Error("fixture lacks probe requirement");
    probes.mode = "required";

    expect(() => parseWorkloadDefinition(value)).toThrow(
      /docker-compose does not preserve 'http-health-checks'/,
    );
  });

  it("uses the maturity contract to reject unsupported stage combinations", async () => {
    const value = structuredClone(
      await loadYaml(new URL("portable-workload-v1.yaml", fixtureRoot)),
    ) as Record<string, unknown>;
    const workload = value.workload as Record<string, unknown>;
    workload.shape = "static-site";
    const maturity = await loadMaturity();

    expect(() => parseWorkloadDefinition(value, maturity)).toThrow(
      /stage 'nixos-host' does not support 'static-site'/,
    );
  });

  it("reports preferred losses without accepting required losses", async () => {
    const definition = await loadDefinition("portable-workload-v1.yaml");
    const findings = workloadCompatibilityFindings(
      definition,
      await loadMaturity(),
    );

    expect(findings).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          targetId: "local-compose",
          capability: "http-health-checks",
          mode: "preferred",
        }),
        expect.objectContaining({
          targetId: "local-compose",
          capability: "resource-bounds",
          mode: "preferred",
        }),
      ]),
    );
    expect(findings).not.toContainEqual(
      expect.objectContaining({ mode: "required" }),
    );
  });
});

describe("workload target adapters", () => {
  it("emits deterministic Score v1b1 from the portable container source", async () => {
    const definition = await loadDefinition("portable-workload-v1.yaml");
    const maturity = await loadMaturity();
    const first = compileScoreWorkload(
      definition,
      "production-kubernetes",
      maturity,
    );
    const second = compileScoreWorkload(
      definition,
      "production-kubernetes",
      maturity,
    );

    expect(first).toEqual(second);
    expect(first.apiVersion).toBe("score.dev/v1b1");
    expect(first.metadata).toMatchObject({
      name: "representative-service",
      annotations: {
        "platform.robbiepalmer.me/project-id": "representative-service",
        "platform.robbiepalmer.me/artifact-digest":
          definition.release.artifact.digest,
      },
    });
    expect(first.containers.api?.image).toBe(
      `${definition.release.artifact.repository}@${definition.release.artifact.digest}`,
    );
    expect(first.containers["migration-database"]).toMatchObject({
      before: { api: { ready: "complete" } },
    });
  });

  it("preserves identity and signed release intent across adapters", async () => {
    const definition = await loadDefinition("portable-workload-v1.yaml");
    const maturity = await loadMaturity();
    const compiled = [
      "local-compose",
      "production-nixos",
      "production-kubernetes",
    ].map((target) => compileDeploymentTarget(definition, target, maturity));

    expect(new Set(compiled.map(({ invariants }) => JSON.stringify(invariants))).size).toBe(1);
    expect(compiled[0]?.invariants).toMatchObject({
      project: definition.project,
      release: definition.release,
      workload: {
        id: definition.workload.id,
        shape: definition.workload.shape,
      },
    });
    expect(compiled.every(({ output }) => output.provisioner_state === "external")).toBe(true);
    expect(compiled[0]?.output).toMatchObject({
      compose: {
        services: {
          reconcile: { "x-platform-schedule": "0 4 * * *" },
        },
        volumes: { cache: {} },
      },
    });
    expect(compiled[1]?.output).toMatchObject({
      migrations: [{ id: "database", order: 1 }],
      timers: [{ name: "reconcile", schedule: "0 4 * * *" }],
    });
  });

  it("renders ordinary Kubernetes resources before optional packaging", async () => {
    const definition = await loadDefinition("portable-workload-v1.yaml");
    const maturity = await loadMaturity();
    const compiled = compileDeploymentTarget(
      definition,
      "production-kubernetes",
      maturity,
    );
    const resources = compiled.output.resources as Array<{
      kind: string;
      metadata?: { name: string };
      spec?: {
        schedule?: string;
        template?: { spec?: { containers?: Array<{ image: string }> } };
      };
    }>;

    expect(resources.map(({ kind }) => kind)).toEqual([
      "PersistentVolumeClaim",
      "Job",
      "Deployment",
      "CronJob",
      "Service",
      "HTTPRoute",
    ]);
    const deployment = resources.find(({ kind }) => kind === "Deployment");
    const cronJob = resources.find(({ kind }) => kind === "CronJob");
    expect(
      deployment?.spec?.template?.spec?.containers?.[0]?.image,
    ).toContain(`@${definition.release.artifact.digest}`);
    expect(cronJob?.spec?.schedule).toBe("0 4 * * *");
    expect(compiled.output).toMatchObject({
      apply_order: [
        "representative-service-migration-database",
        "workload-resources",
      ],
      post_render: [
        { kind: "kustomize", path: "deploy/overlays/production" },
      ],
      packaging: { kind: "none" },
    });
  });

  it("adds Helm application packaging only when the target asks for it", async () => {
    const value = structuredClone(
      await loadYaml(new URL("portable-workload-v1.yaml", fixtureRoot)),
    ) as Record<string, unknown>;
    const targets = value.deployment_targets as Array<Record<string, unknown>>;
    const kubernetes = targets.find(
      ({ id }) => id === "production-kubernetes",
    );
    if (!kubernetes) throw new Error("fixture lacks Kubernetes target");
    const extensions = kubernetes.extensions as Record<string, unknown>;
    extensions.packaging = {
      kind: "helm-application",
      chart: "representative-service",
      release: "representative-service",
    };
    const maturity = await loadMaturity();
    const definition = parseWorkloadDefinition(value, maturity);

    expect(
      compileDeploymentTarget(
        definition,
        "production-kubernetes",
        maturity,
      ).output.packaging,
    ).toEqual({
      kind: "helm-application",
      chart: "representative-service",
      release: "representative-service",
    });
    expect(
      compileDeploymentTarget(definition, "local-compose", maturity).output,
    ).not.toHaveProperty("packaging");
  });

  it("compiles a serverless workload without Kubernetes concepts", async () => {
    const definition = await loadDefinition("cloudflare-worker-v1.yaml");
    const compiled = compileDeploymentTarget(
      definition,
      "production-cloudflare",
      await loadMaturity(),
    );

    expect(compiled).toMatchObject({
      adapter: "cloudflare-worker",
      invariants: {
        project: definition.project,
        release: definition.release,
      },
      output: {
        artifact: {
          reference: `${definition.release.artifact.repository}@${definition.release.artifact.digest}`,
          signature: definition.release.artifact.signature,
        },
        wrangler: {
          name: "edge-status-api",
          main: "dist/worker.mjs",
          routes: ["status.example.test/*"],
        },
      },
    });
    expect(compiled.output).not.toHaveProperty("resources");
    expect(compiled.output).not.toHaveProperty("post_render");
    expect(compiled.output).not.toHaveProperty("packaging");
  });

  it("rejects adapter calls for unknown or incompatible targets", async () => {
    const definition = await loadDefinition("cloudflare-worker-v1.yaml");
    expect(() => compileDeploymentTarget(definition, "missing")).toThrow(
      /Unknown deployment target/,
    );
    expect(() =>
      compileScoreWorkload(definition, "production-cloudflare"),
    ).toThrow(/does not use the Score adapter/);
  });
});

describe("workload contract documentation", () => {
  it("keeps generated documentation aligned with checked fixtures", async () => {
    const examples = await Promise.all([
      loadDefinition("portable-workload-v1.yaml"),
      loadDefinition("cloudflare-worker-v1.yaml"),
    ]);
    const generated = renderWorkloadDocumentation(examples);

    expect(generated).toBe(await readFile(documentationUrl, "utf8"));
    expect(generated).toContain("A required capability that an adapter cannot preserve fails validation.");
    expect(generated).toContain("| edge-status | edge-status-api | cloudflare-worker |");
  });
});
