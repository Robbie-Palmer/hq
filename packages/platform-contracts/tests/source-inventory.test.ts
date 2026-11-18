import { describe, expect, it } from "vitest";
import { parseSourceInventory } from "../src/source-inventory";

const validInventory = {
  schema_version: 1,
  additional_roots: ["scripts"],
  components: [
    {
      id: "component:alpha/service",
      project: "project:alpha",
      paths: ["packages/alpha"],
      toolchains: ["typescript"],
      profile: {
        path: "ui/content/projects/alpha/project-profile.yaml",
        component_id: "service",
      },
      receipt: { path: ".copier/projects/alpha.yml" },
      adoption: { state: "managed", batch: null },
    },
  ],
  exclusions: [{ path: "scripts/vendor", reason: "Third-party fixture" }],
} as const;

describe("source inventory contract", () => {
  it("parses a versioned inventory", () => {
    expect(parseSourceInventory(validInventory).schema_version).toBe(1);
  });

  it("rejects non-normalized repository paths", () => {
    expect(() =>
      parseSourceInventory({
        ...validInventory,
        additional_roots: [
          "/scripts",
          "../packages",
          "packages//alpha",
          "packages\\alpha",
        ],
      }),
    ).toThrow(/normalized repository-relative path/);
  });

  it("requires planned work to name an adoption batch", () => {
    expect(() =>
      parseSourceInventory({
        ...validInventory,
        components: [
          {
            ...validInventory.components[0],
            receipt: null,
            adoption: { state: "planned", batch: null },
          },
        ],
      }),
    ).toThrow(/planned adoption requires a batch/);
  });

  it("requires deferred work to explain the deferral", () => {
    expect(() =>
      parseSourceInventory({
        ...validInventory,
        components: [
          {
            ...validInventory.components[0],
            receipt: null,
            adoption: { state: "deferred", batch: null },
          },
        ],
      }),
    ).toThrow(/deferred adoption requires a reason/);
  });
});
