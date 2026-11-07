import { describe, expect, it } from "vitest";
import { deliveryEvidenceContractSchema } from "../src/delivery-evidence";

function contract() {
  return {
    contract: "project-delivery-evidence" as const,
    contract_version: 1 as const,
    repository: "Robbie-Palmer/hq",
    targets: [
      {
        id: "site-ui",
        subjects: ["component:recipe-site/web"],
        shared_host: "site-ui",
        source_paths: [
          { path: ".github/workflows/ui-cd.yml", mode: "shared" as const },
        ],
        github: {
          required_ci_names: ["UI CI"],
          production_environments: ["production-site-ui"],
        },
      },
    ],
  };
}

describe("project delivery evidence contract", () => {
  it("accepts stable subjects and explicit shared-host evidence", () => {
    expect(deliveryEvidenceContractSchema.parse(contract())).toEqual(
      contract(),
    );
  });

  it("rejects duplicate evidence names and conflicting path modes", () => {
    const value = structuredClone(contract()) as unknown as {
      targets: Array<{
        id: string;
        subjects: string[];
        shared_host: string;
        source_paths: Array<{
          path: string;
          mode: "exclusive" | "shared";
        }>;
        github: {
          required_ci_names: string[];
          production_environments: string[];
        };
      }>;
      contract: "project-delivery-evidence";
      contract_version: 1;
      repository: string;
    };
    const firstTarget = value.targets[0];
    if (!firstTarget) throw new Error("fixture target is missing");
    firstTarget.github.required_ci_names.push("UI CI");
    value.targets.push({
      ...firstTarget,
      id: "other",
      subjects: ["component:recipe-site/api"],
      source_paths: [
        {
          path: ".github/workflows/ui-cd.yml",
          mode: "exclusive",
        },
      ],
    });

    expect(() => deliveryEvidenceContractSchema.parse(value)).toThrow(
      /duplicate required CI name|cannot be both exclusive and shared/,
    );
  });

  it("rejects paths and subjects that cannot identify repository content", () => {
    const value = contract();
    const firstTarget = value.targets[0];
    if (!firstTarget) throw new Error("fixture target is missing");
    value.targets[0] = {
      ...firstTarget,
      subjects: ["recipe-site/web"],
      source_paths: [{ path: "../ui", mode: "shared" }],
    };

    expect(() => deliveryEvidenceContractSchema.parse(value)).toThrow(
      /Invalid input|normalized repository-relative path/,
    );
  });
});
