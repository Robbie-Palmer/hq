import { readFile } from "node:fs/promises";
import { parse } from "yaml";
import { describe, expect, it } from "vitest";
import {
  type DeploymentMaturityContract,
  type PromotionEvidence,
  deploymentCapabilityIds,
  deploymentStageIds,
  parseDeploymentMaturityContract,
  parsePromotionEvidence,
  renderDeploymentMaturityDocumentation,
} from "../src/deployment-maturity";

const contractUrl = new URL(
  "../../../ui/content/projects/personal-engineering-platform/deployment-maturity.yaml",
  import.meta.url,
);
const exampleUrl = new URL(
  "./fixtures/deployment-maturity/representative-promotion-v1.yaml",
  import.meta.url,
);
const documentationUrl = new URL(
  "../../../docs/contracts/deployment-maturity.md",
  import.meta.url,
);

async function loadYaml(url: URL): Promise<unknown> {
  return parse(await readFile(url, "utf8"));
}

async function loadContract(): Promise<DeploymentMaturityContract> {
  return parseDeploymentMaturityContract(await loadYaml(contractUrl));
}

async function loadExample(
  contract: DeploymentMaturityContract,
): Promise<PromotionEvidence> {
  return parsePromotionEvidence(await loadYaml(exampleUrl), contract);
}

describe("deployment maturity contract", () => {
  it("parses all ordered stages and their required capabilities", async () => {
    const contract = await loadContract();

    expect(contract.stages.map(({ id }) => id)).toEqual(deploymentStageIds);
    expect(contract.stages.map(({ sequence }) => sequence)).toEqual([
      1, 2, 3, 4, 5, 6,
    ]);
    for (const stage of contract.stages) {
      expect(Object.keys(stage.capabilities)).toEqual(deploymentCapabilityIds);
      expect(stage.entry_criteria.length).toBeGreaterThan(0);
      expect(stage.exit_triggers.length).toBeGreaterThan(0);
      expect(stage.recovery.availability_claim).not.toBe("high-availability");
    }
  });

  it("rejects reordered or misnumbered stages", async () => {
    const value = structuredClone(await loadYaml(contractUrl)) as Record<
      string,
      unknown
    >;
    const stages = value.stages as Array<Record<string, unknown>>;
    stages[0] = { ...stages[0], id: "managed-application", sequence: 2 };

    expect(() => parseDeploymentMaturityContract(value)).toThrow(
      /expected stage 'serverless'.*expected sequence 1/,
    );
  });

  it("keeps invariant fields outside target adapter ownership", async () => {
    const value = structuredClone(await loadYaml(contractUrl)) as Record<
      string,
      unknown
    >;
    const targetFields = value.target_variant_fields as string[];
    targetFields.push("project.id");

    expect(() => parseDeploymentMaturityContract(value)).toThrow(
      /cannot be both invariant and target-owned/,
    );
  });

  it("rejects adapter changes outside the declared target fields", async () => {
    const value = structuredClone(await loadYaml(contractUrl)) as Record<
      string,
      unknown
    >;
    const stages = value.stages as Array<Record<string, unknown>>;
    const adapter = stages[0]?.adapter as Record<string, unknown>;
    (adapter.changes as string[]).push("workload.id");

    expect(() => parseDeploymentMaturityContract(value)).toThrow(
      /is not declared as target-owned/,
    );
  });

  it("rejects unproved availability claims", async () => {
    const value = structuredClone(await loadYaml(contractUrl)) as Record<
      string,
      unknown
    >;
    const stages = value.stages as Array<Record<string, unknown>>;
    const recovery = stages[5]?.recovery as Record<string, unknown>;
    recovery.availability_claim = "high-availability";
    recovery.failure_domains = ["one-domain"];

    expect(() => parseDeploymentMaturityContract(value)).toThrow(
      /at least two failure domains.*capacity-test, failover-test, recovery-test evidence/,
    );
  });

  it("accepts a high-availability claim only with complete proof", async () => {
    const value = structuredClone(await loadYaml(contractUrl)) as Record<
      string,
      unknown
    >;
    const stages = value.stages as Array<Record<string, unknown>>;
    const recovery = stages[5]?.recovery as Record<string, unknown>;
    recovery.availability_claim = "high-availability";
    recovery.failure_domains = ["zone-a", "zone-b"];
    recovery.proof = [
      { kind: "capacity-test", reference: "evidence/capacity.json" },
      { kind: "failover-test", reference: "evidence/failover.json" },
      { kind: "recovery-test", reference: "evidence/recovery.json" },
    ];

    expect(parseDeploymentMaturityContract(value).stages[5]?.recovery).toMatchObject(
      { availability_claim: "high-availability" },
    );
  });

  it("checks provider SLA and single-instance claims", async () => {
    const providerValue = structuredClone(await loadYaml(contractUrl)) as Record<
      string,
      unknown
    >;
    const providerStages = providerValue.stages as Array<Record<string, unknown>>;
    const providerRecovery = providerStages[0]?.recovery as Record<
      string,
      unknown
    >;
    providerRecovery.availability_claim = "provider-sla";
    expect(() => parseDeploymentMaturityContract(providerValue)).toThrow(
      /require provider SLA evidence/,
    );
    providerRecovery.proof = [
      { kind: "provider-sla", reference: "evidence/provider-sla.html" },
    ];
    expect(
      parseDeploymentMaturityContract(providerValue).stages[0]?.recovery
        .availability_claim,
    ).toBe("provider-sla");

    const hostValue = structuredClone(await loadYaml(contractUrl)) as Record<
      string,
      unknown
    >;
    const hostStages = hostValue.stages as Array<Record<string, unknown>>;
    const hostRecovery = hostStages[2]?.recovery as Record<string, unknown>;
    hostRecovery.failure_domains = ["host-a", "host-b"];
    expect(() => parseDeploymentMaturityContract(hostValue)).toThrow(
      /must name exactly one failure domain/,
    );
  });
});

describe("deployment promotion evidence", () => {
  it("checks one signed artifact through serverless, NixOS, and Kubernetes", async () => {
    const contract = await loadContract();
    const evidence = await loadExample(contract);

    expect(evidence.targets.map(({ stage }) => stage)).toEqual([
      "serverless",
      "nixos-host",
      "kubernetes",
    ]);
    expect(new Set(evidence.targets.map(({ artifact_digest }) => artifact_digest))).toEqual(
      new Set([evidence.release.artifact.digest]),
    );
    expect(
      evidence.targets.every(
        (target) =>
          target.public_urls[0] === evidence.invariants.public_urls[0] &&
          target.project.catalog_id === evidence.project.catalog_id &&
          target.workload.id === evidence.workload.id &&
          target.data.logical_id === evidence.invariants.data.logical_id &&
          target.observability.service_name ===
            evidence.invariants.observability.service_name &&
          target.rollback.result === "passed",
      ),
    ).toBe(true);
  });

  it("rejects changed release and workload invariants", async () => {
    const contract = await loadContract();
    const value = structuredClone(await loadYaml(exampleUrl)) as Record<
      string,
      unknown
    >;
    const targets = value.targets as Array<Record<string, unknown>>;
    const target = targets[0];
    if (!target) throw new Error("fixture must have a first target");
    target.project = {
      id: "changed-project",
      catalog_id: "project:changed",
      owner: "changed",
    };
    target.workload = {
      id: "changed-workload",
      runtime_family: "container",
      ports: [{ name: "http", port: 9090, protocol: "http" }],
      health: { liveness: "/changed", readiness: "/changed" },
      dependencies: [],
    };
    target.artifact_digest =
      "sha256:cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc";
    target.signature_verification = {
      subject_digest:
        "sha256:cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc",
      signer: "changed",
      bundle_ref: "changed",
      result: "passed",
    };
    target.public_urls = ["https://changed.example.test"];
    target.data = {
      logical_id: "database:changed",
      engine: "changed",
      schema: "changed",
      backup_evidence: "changed",
    };
    target.observability = {
      service_namespace: "changed",
      service_name: "changed",
      telemetry_contract_version: 2,
    };
    target.rollback = {
      mechanism: "changed",
      previous_artifact_digest:
        "sha256:dddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd",
      evidence: "changed",
      result: "passed",
    };

    expect(() => parsePromotionEvidence(value, contract)).toThrow(
      /preserve project identity.*preserve workload identity.*signed release artifact digest.*verify the release signature.*preserve the public URLs.*preserve the logical data store.*preserve the observability identity.*restore the declared previous artifact/,
    );
  });

  it("requires every promotion class and verification kind", async () => {
    const contract = await loadContract();
    const value = structuredClone(await loadYaml(exampleUrl)) as Record<
      string,
      unknown
    >;
    const targets = value.targets as Array<Record<string, unknown>>;
    for (const target of targets) target.stage = "single-node-k3s";
    const firstTarget = targets[0];
    if (!firstTarget) throw new Error("fixture must have a first target");
    firstTarget.verification = [
      { kind: "signature", evidence: "signature checked", result: "passed" },
    ];

    expect(() => parsePromotionEvidence(value, contract)).toThrow(
      /include a serverless target.*include a managed application or NixOS target.*include a Kubernetes target.*lacks data, rollback, route, telemetry verification evidence/,
    );
  });

  it("rejects target adapters that do not match their stage", async () => {
    const contract = await loadContract();
    const value = structuredClone(await loadYaml(exampleUrl)) as Record<
      string,
      unknown
    >;
    const targets = value.targets as Array<Record<string, unknown>>;
    const firstTarget = targets[0];
    if (!firstTarget) throw new Error("fixture must have a first target");
    firstTarget.adapter = { family: "kubernetes", kind: "wrong-adapter" };

    expect(() => parsePromotionEvidence(value, contract)).toThrow(
      /adapter.family must be 'serverless'/,
    );
  });

  it("rejects a promotion that moves backward through the stages", async () => {
    const contract = await loadContract();
    const value = structuredClone(await loadYaml(exampleUrl)) as Record<
      string,
      unknown
    >;
    const targets = value.targets as Array<Record<string, unknown>>;
    value.targets = [targets[1], targets[0], targets[2]];

    expect(() => parsePromotionEvidence(value, contract)).toThrow(
      /targets must follow maturity-stage order/,
    );
  });

  it("keeps generated documentation aligned with the executable contract", async () => {
    const contract = await loadContract();
    const example = await loadExample(contract);
    const generated = renderDeploymentMaturityDocumentation(contract, example);

    expect(generated).toBe(await readFile(documentationUrl, "utf8"));
    expect(generated).toContain("Version 1 makes no high-availability claim.");
    expect(generated).toContain("| kubernetes | kubernetes-deployment |");
  });
});
