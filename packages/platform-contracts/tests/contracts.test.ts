import { readFile } from "node:fs/promises";
import { parse } from "yaml";
import { describe, expect, it } from "vitest";
import { z } from "zod";
import { parseNixFlakeContract } from "../src/nix-flake";
import { parseOpenTelemetryContract } from "../src/opentelemetry";
import { parseContract } from "../src/parse";
import { parsePlatformManifestSource } from "../src/platform-manifest";
import { parseRepositoryLayoutContract } from "../src/repository-layout";

const contractRoot = new URL(
  "../../../ui/content/projects/personal-engineering-platform/",
  import.meta.url,
);

async function load(name: string): Promise<unknown> {
  return parse(await readFile(new URL(name, contractRoot), "utf8"));
}

describe("shared platform contract parsers", () => {
  it("parses every current production contract", async () => {
    const [layout, platform, nix, opentelemetry] = await Promise.all([
      load("repository-layout.yaml"),
      load("platform.yaml"),
      load("nix-flake-contract.yaml"),
      load("opentelemetry-contract.yaml"),
    ]);

    expect(parseRepositoryLayoutContract(layout).schema_version).toBe(1);
    expect(parsePlatformManifestSource(platform).schema_version).toBe(1);
    expect(parseNixFlakeContract(nix).contract).toBe("nix-flake");
    expect(parseOpenTelemetryContract(opentelemetry).contract).toBe(
      "opentelemetry",
    );
  });

  it("normalizes technology identities at the source boundary", () => {
    const parsed = parsePlatformManifestSource({
      schema_version: 1,
      project: "platform",
      layers: [
        {
          slug: "typescript",
          activated_by: {
            slot: "project.primary-language",
            technology: "TypeScript",
          },
        },
      ],
      slots: [{ slug: "project.primary-language" }],
      policies: [],
      selections: [
        {
          id: "typescript-default",
          slot: "project.primary-language",
          technology: "TypeScript",
          status: "Accepted",
          decision: "platform:001-typescript",
          effective_from: "2026-01-01T00:00:00Z",
        },
      ],
    });

    expect(parsed.layers[0]?.activated_by?.technology).toBe("typescript");
    expect(parsed.selections[0]?.technology).toBe("typescript");
  });

  it.each([
    [parseRepositoryLayoutContract, {}],
    [parsePlatformManifestSource, {}],
    [parseNixFlakeContract, {}],
    [parseOpenTelemetryContract, {}],
  ])("reports invalid contract fields", (parser, value) => {
    expect(() => parser(value)).toThrow(/Invalid/);
  });

  it("labels a root-level parse failure", () => {
    expect(() => parseContract({}, z.never(), "example contract")).toThrow(
      "example contract: Invalid input",
    );
  });
});
