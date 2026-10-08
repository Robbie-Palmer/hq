import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { buildArtifacts, validateDataset } from "../src/build";
import { inflationDataset } from "../src/data";

const packageRoot = resolve(fileURLToPath(new URL("..", import.meta.url)));

describe("inflation dataset artifacts", () => {
  it("passes structural, registry, and coverage validation", () => {
    const dataset = validateDataset(inflationDataset);

    expect(dataset.datasetVersion).toBe("2026.10.0");
    expect(dataset.releases.map(({ index }) => index).sort()).toEqual([
      "CPI",
      "CPIH",
      "RPI",
    ]);
  });

  it("builds deterministic release, coverage, and manifest artifacts", () => {
    const first = buildArtifacts(packageRoot);
    const second = buildArtifacts(packageRoot);

    expect([...first]).toEqual([...second]);
    expect(first.get("artifacts/manifest.json")).toContain(
      '"sourceContentSha256"',
    );
    expect(
      first.get("artifacts/coverage-matrix/2026.10.0.json"),
    ).toContain('"indexSubstitution": "never"');
  });
});
